import { useEffect, useState, useCallback, useRef } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { ITerminalService } from '../services/terminalService'
import type { TerminalSession } from '../types'

/**
 * Data required to restore a terminal session from snapshot + live events.
 *
 * `byteLen` on each buffered event is the producer's raw byte count for the
 * chunk (matches `RingBuffer.append` arithmetic in Rust). Subscribers MUST
 * advance their cursor with `offsetStart + byteLen`, NOT with the length of
 * `data` — the producer encodes invalid UTF-8 lossily, so `data.length` can
 * diverge from the producer's offset stream and cause silent dedupe drops.
 */
export interface RestoreData {
  sessionId: string
  cwd: string
  pid: number
  replayData: string
  replayEndOffset: number
  bufferedEvents: { data: string; offsetStart: number; byteLen: number }[]
}

/**
 * Callback invoked once the live data subscription is attached. Drives the
 * orchestrator's per-pane buffer drain (see useSessionManager.notifyPaneReady).
 *
 * The handler argument is the same function used for live events, so the
 * orchestrator can fire buffered events through the same cursor-dedupe path.
 */
export type NotifyPaneReady = (
  sessionId: string,
  handler: (data: string, offsetStart: number, byteLen: number) => void
) => () => void

/**
 * Lifecycle mode. Mirrors `TerminalPaneMode` — kept here separately so the
 * hook is consumable without dragging the component contract along.
 *
 * - `attach` — A PTY already exists; reattach without spawning. Requires
 *   `restoredFrom` so the hook knows the session id and pid (and replay
 *   data, if any). Used for both restored sessions AND newly-created
 *   sessions where the parent already called spawn_pty.
 * - `spawn` — Call `service.spawn()` to create a new PTY. Legacy default
 *   path; existing call sites that don't set `mode` continue to work.
 * - `awaiting-restart` — Do NOT touch the PTY. Caller renders a Restart UI.
 *   Per spec, exited sessions wait for explicit user opt-in to restart.
 */
export type UseTerminalMode = 'attach' | 'spawn' | 'awaiting-restart'

export interface UseTerminalOptions {
  /**
   * xterm.js Terminal instance
   */
  terminal: Terminal | null

  /**
   * Terminal service (MockTerminalService or TauriTerminalService)
   */
  service: ITerminalService

  /**
   * Current working directory for the shell
   */
  cwd?: string

  /**
   * Optional shell path (defaults to system shell)
   */
  shell?: string

  /**
   * Optional environment variables
   */
  env?: Record<string, string>

  /**
   * Optional restore data for reconnecting to an existing session
   */
  restoredFrom?: RestoreData

  /**
   * Optional callback exposed by `useSessionManager` for the mount-time
   * buffer drain. When provided, the data-subscription effect calls this
   * once its live listener is attached so the orchestrator can flush
   * any pty-data buffered between snapshot and live subscription.
   */
  onPaneReady?: NotifyPaneReady

  /**
   * Explicit lifecycle mode. When omitted, falls back to legacy inference
   * (`attach` if `restoredFrom` is set, else `spawn`) so existing call
   * sites that haven't migrated to the explicit prop continue to work.
   *
   * New code should always pass an explicit mode; the inference path stays
   * for backwards compatibility but is the source of the bug Codex flagged
   * (Exited sessions resurrected as fresh PTYs because `restoredFrom ===
   * undefined` was treated as a spawn signal).
   */
  mode?: UseTerminalMode
}

export interface UseTerminalReturn {
  /**
   * Current terminal session (null if not spawned)
   */
  session: TerminalSession | null

  /**
   * Terminal status
   */
  status: 'idle' | 'running' | 'exited' | 'error'

  /**
   * Error message (if status === 'error')
   */
  error: string | null

  /**
   * Resize the PTY
   */
  resize: (cols: number, rows: number) => void
}

/**
 * useTerminal hook - manages PTY lifecycle and xterm integration
 *
 * Features:
 * - Spawns PTY on mount (or restores from snapshot)
 * - Listens to PTY data events and writes to xterm
 * - Handles keyboard input from xterm
 * - Handles PTY exit and error events
 * - Cleans up on unmount
 * - Supports replay + cursor dedupe for session restoration
 */
export const useTerminal = (options: UseTerminalOptions): UseTerminalReturn => {
  const {
    terminal,
    service,
    cwd,
    shell,
    env,
    restoredFrom,
    onPaneReady,
    mode,
  } = options

  // Resolve effective mode. Explicit wins; otherwise infer from restoredFrom
  // for backwards compatibility (legacy "spawn unless restoredFrom is set").
  const effectiveMode: UseTerminalMode =
    mode ?? (restoredFrom ? 'attach' : 'spawn')

  // Mirror in a ref so the spawn effect (which intentionally excludes mode
  // from its deps) can read the latest value at init without re-running.
  const effectiveModeRef = useRef(effectiveMode)
  effectiveModeRef.current = effectiveMode

  const [session, setSession] = useState<TerminalSession | null>(null)

  const [status, setStatus] = useState<'idle' | 'running' | 'exited' | 'error'>(
    'idle'
  )
  const [error, setError] = useState<string | null>(null)

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true)

  // Track whether this hook spawned the session
  const didSpawnSessionRef = useRef(false)

  // Track the replay end offset (cursor) for deduplication.
  // Events with offsetStart < cursor are dropped. Advances on every write
  // so a buffered drain that overlaps a live event is filtered (no doubled bytes).
  const cursorRef = useRef<number>(restoredFrom?.replayEndOffset ?? 0)

  // Latest onPaneReady, kept in a ref so the data-subscribe effect can call
  // it without depending on the function identity (which would re-run the
  // effect and re-subscribe).
  const onPaneReadyRef = useRef(onPaneReady)
  useEffect(() => {
    onPaneReadyRef.current = onPaneReady
  }, [onPaneReady])

  // Store restoredFrom in a ref to prevent effect dependency cycles
  const restoredFromRef = useRef(restoredFrom)

  // Store cwd in a ref — used only at spawn time, not as an effect dependency.
  // OSC 7 updates session.workingDirectory which flows here as `cwd`, but we
  // must NOT respawn the PTY when the shell changes directory.
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd

  // Track unmount only (not dependency changes)
  useEffect(
    () => (): void => {
      isMountedRef.current = false
    },
    []
  )

  // Spawn PTY on mount (or restore from snapshot)
  useEffect(() => {
    // Reset mounted ref on each effect run (fixes StrictMode double-mount where
    // the first fake unmount sets this to false and it never resets)
    isMountedRef.current = true

    if (!terminal) {
      return
    }

    // Clear stale output from previous session (StrictMode cleanup writes
    // "[Process exited]" to the cached terminal before the new session starts)
    terminal.clear()

    let currentSession: TerminalSession | null = null

    const initializeSession = async (): Promise<void> => {
      const currentMode = effectiveModeRef.current

      // AWAITING-RESTART: per spec, do NOT touch the PTY. The component
      // renders a Restart button instead of a terminal, so this hook just
      // sits in idle state.
      if (currentMode === 'awaiting-restart') {
        return
      }

      // ATTACH: A PTY already exists in Rust state. Do NOT call spawn.
      if (currentMode === 'attach') {
        const restore = restoredFromRef.current
        if (!restore) {
          // Defensive: caller must always provide restoredFrom in attach mode
          // (need the session id and pid to subscribe). Surface as error so
          // misuse is loud rather than producing a silent zombie pane.
          setStatus('error')
          setError('attach mode requires restoredFrom')

          return
        }

        if (!isMountedRef.current) {
          return
        }

        didSpawnSessionRef.current = false // We did NOT spawn this session

        // Write replay data first; the cursor is already initialized to
        // restore.replayEndOffset (set when the ref was created).
        terminal.write(restore.replayData)

        // Drain buffered events captured at restore-time, advancing the
        // cursor with each write. The orchestrator's notifyPaneReady drain
        // (in the data-subscribe effect) may re-deliver the same events
        // along with any that arrived later — cursor dedupe filters them.
        // Cursor advances by `event.byteLen` (the producer's raw byte count),
        // NOT by `encoder.encode(event.data).length` — see RestoreData jsdoc.
        for (const event of restore.bufferedEvents) {
          if (event.offsetStart >= cursorRef.current) {
            terminal.write(event.data)

            const writtenEnd = event.offsetStart + event.byteLen
            if (writtenEnd > cursorRef.current) {
              cursorRef.current = writtenEnd
            }
          }
        }

        // Create session object from restore data
        const restoredSession: TerminalSession = {
          id: restore.sessionId,
          pid: restore.pid,
          name: `Session ${restore.sessionId}`,
          cwd: restore.cwd,
          shell: shell ?? 'default',
          status: 'running',
          createdAt: new Date(),
          env: {},
          lastActivityAt: new Date(),
        }

        currentSession = restoredSession
        setSession(restoredSession)
        setStatus('running')
        setError(null)

        return
      }

      // SPAWN: Create a new PTY process via service.spawn.
      try {
        const effectiveCwd = cwdRef.current ?? '~'

        const result = await service.spawn({
          shell:
            shell ??
            (typeof process !== 'undefined' ? process.env.SHELL : undefined),
          cwd: effectiveCwd,
          env: env ?? {},
        })

        if (!isMountedRef.current) {
          // Component unmounted during spawn — kill session, skip state updates
          await service.kill({ sessionId: result.sessionId })

          return
        }

        didSpawnSessionRef.current = true // We spawned this session

        // Convert result to TerminalSession
        // result.cwd is the resolved absolute path from Rust (PTYSpawnResult
        // requires it). Round 5: previously fell back to effectiveCwd ('~'
        // pre-resolution), but Rust always returns a real path so the
        // fallback was misleading and lint flagged the conditional.
        const newSession: TerminalSession = {
          id: result.sessionId,
          pid: result.pid,
          name: `Session ${result.sessionId}`,
          cwd: result.cwd,
          shell:
            shell ??
            (typeof process !== 'undefined' ? process.env.SHELL : undefined) ??
            'default',
          status: 'running',
          createdAt: new Date(),
          env: {},
          lastActivityAt: new Date(),
        }

        currentSession = newSession
        setSession(newSession)
        setStatus('running')
        setError(null)
      } catch (err: unknown) {
        if (!isMountedRef.current) {
          return
        }

        // Tauri invoke() throws strings, not Error objects
        const errorMessage =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : 'Failed to spawn PTY'
        setStatus('error')
        setError(errorMessage)
      }
    }

    void initializeSession()

    // Cleanup session when dependencies change or on unmount
    return (): void => {
      const cleanupSession = async (): Promise<void> => {
        // Only kill sessions we spawned, not restored sessions
        if (currentSession && didSpawnSessionRef.current) {
          try {
            await service.kill({ sessionId: currentSession.id })
          } catch {
            // Ignore errors on cleanup - session may already be killed
          }
        }
      }
      void cleanupSession()
    }
    // cwd intentionally excluded — it's read from cwdRef at spawn time.
    // OSC 7 updates cwd continuously; including it here would kill the PTY on every cd.
    // restoredFrom intentionally excluded — it's read from restoredFromRef at init time.
    // Including it would cause infinite loops as object identity changes.
  }, [terminal, service, shell, env])

  // Listen to PTY data events
  useEffect(() => {
    if (!terminal || !session) {
      return
    }

    const handleData = (
      eventSessionId: string,
      data: string,
      offsetStart: number,
      byteLen: number
    ): void => {
      if (eventSessionId === session.id && isMountedRef.current) {
        // Cursor dedupe: drop events whose offset predates what we've
        // already written (replay or earlier live/buffered event).
        if (offsetStart >= cursorRef.current) {
          terminal.write(data)
          // Advance the cursor by the producer's raw byte count, not by the
          // length of `data`. Lossy UTF-8 in the producer (invalid bytes →
          // U+FFFD = 3 bytes when re-encoded) would otherwise drift the
          // cursor past legitimate offsets and silently drop subsequent
          // chunks whose offsetStart falls in the inflated gap.
          const writtenEnd = offsetStart + byteLen
          if (writtenEnd > cursorRef.current) {
            cursorRef.current = writtenEnd
          }
        }
      }
    }

    // Drain-tolerant variant for orchestrator buffer flush. Same as handleData
    // but doesn't filter by sessionId since the orchestrator always passes
    // events for the session we registered for.
    const handleDataForDrain = (
      data: string,
      offsetStart: number,
      byteLen: number
    ): void => {
      handleData(session.id, data, offsetStart, byteLen)
    }

    const handleExit = (eventSessionId: string, code: number | null): void => {
      if (eventSessionId === session.id && isMountedRef.current) {
        setStatus('exited')

        const exitMessage =
          code !== null
            ? `\r\n[Process exited with code ${code}]\r\n`
            : '\r\n[Process exited]\r\n'
        terminal.write(exitMessage)
      }
    }

    const handleError = (eventSessionId: string, message: string): void => {
      if (eventSessionId === session.id && isMountedRef.current) {
        setStatus('error')
        setError(message)
        terminal.write(`\r\n[Error: ${message}]\r\n`)
      }
    }

    // service.onData now returns a Promise<() => void> that resolves once the
    // underlying transport listener is attached. Track the resolved unsubscribe
    // function and a cancellation flag so the cleanup path correctly tears down
    // even if the effect cleanup runs before the promise resolves.
    let unsubscribeData: (() => void) | null = null
    let dataSubscriptionCancelled = false
    let releasePaneReady: (() => void) | null = null

    void (async (): Promise<void> => {
      const unsubscribe = await service.onData(handleData)
      // The cleanup runs synchronously and can flip dataSubscriptionCancelled
      // before this microtask resumes, so the guard is necessary even though
      // ESLint can't prove the awaited function returned to a different scope.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (dataSubscriptionCancelled) {
        unsubscribe()

        return
      }
      unsubscribeData = unsubscribe

      // Tell the orchestrator we're attached. It drains any pty-data events
      // it buffered for our session id between snapshot and now into our
      // handler — same function as the live path, so cursor dedupe filters
      // any overlap with live events that arrived during the window between
      // service.onData() resolving and notifyPaneReady firing.
      const notify = onPaneReadyRef.current
      if (notify) {
        const release = notify(session.id, handleDataForDrain)
        // Stash for cleanup so the orchestrator can release any per-pane
        // tracking even if the buffered drain has already happened.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (dataSubscriptionCancelled) {
          release()

          return
        }
        releasePaneReady = release
      }
    })()

    const unsubscribeExit = service.onExit(handleExit)
    const unsubscribeError = service.onError(handleError)

    return (): void => {
      dataSubscriptionCancelled = true
      releasePaneReady?.()
      unsubscribeData?.()
      unsubscribeExit()
      unsubscribeError()
    }
  }, [terminal, session, service])

  // Handle keyboard input from xterm
  useEffect(() => {
    if (!terminal || !session) {
      return
    }

    const handleInput = (data: string): void => {
      // Guard writes after PTY exit to avoid rejected writes
      if (isMountedRef.current && status === 'running') {
        const writeAsync = async (): Promise<void> => {
          try {
            await service.write({ sessionId: session.id, data })
          } catch {
            // Ignore rejected writes (session may have exited between status check and write)
          }
        }
        void writeAsync()
      }
    }

    const disposable = terminal.onData(handleInput)

    return (): void => {
      disposable.dispose()
    }
  }, [terminal, session, service, status])

  // Resize function
  const resize = useCallback(
    (cols: number, rows: number): void => {
      // Guard resize after PTY exit to avoid rejected calls
      if (session && status === 'running') {
        const resizeAsync = async (): Promise<void> => {
          try {
            await service.resize({ sessionId: session.id, cols, rows })
          } catch {
            // Ignore rejected resizes (session may have exited between status check and resize)
          }
        }
        void resizeAsync()
      }
    },
    [session, service, status]
  )

  return {
    session,
    status,
    error,
    resize,
  }
}
