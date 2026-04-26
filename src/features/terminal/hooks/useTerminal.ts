import { useEffect, useState, useCallback, useRef } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { ITerminalService } from '../services/terminalService'
import type { TerminalSession } from '../types'

/**
 * Data required to restore a terminal session from snapshot + live events
 */
export interface RestoreData {
  sessionId: string
  cwd: string
  pid: number
  replayData: string
  replayEndOffset: number
  bufferedEvents: { data: string; offsetStart: number }[]
}

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

  /**
   * DEBUG: spawn lifecycle trace (remove before merge)
   */
  debugInfo: string
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
  const { terminal, service, cwd, shell, env, restoredFrom } = options

  const [session, setSession] = useState<TerminalSession | null>(null)

  const [status, setStatus] = useState<'idle' | 'running' | 'exited' | 'error'>(
    'idle'
  )
  const [error, setError] = useState<string | null>(null)

  // DEBUG: trace spawn lifecycle
  const [debugInfo, setDebugInfo] = useState('init')

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true)

  // Track whether this hook spawned the session
  const didSpawnSessionRef = useRef(false)

  // Track the replay end offset (cursor) for deduplication
  // Events with offsetStart < cursor are dropped
  const cursorRef = useRef<number>(restoredFrom?.replayEndOffset ?? 0)

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
      setDebugInfo('no-terminal')

      return
    }

    // Clear stale output from previous session (StrictMode cleanup writes
    // "[Process exited]" to the cached terminal before the new session starts)
    terminal.clear()

    let currentSession: TerminalSession | null = null

    const initializeSession = async (): Promise<void> => {
      // RESTORED MODE: Reattach to existing session
      const restore = restoredFromRef.current
      if (restore) {
        if (!isMountedRef.current) {
          return
        }

        didSpawnSessionRef.current = false // We did NOT spawn this session

        // Write replay data first
        terminal.write(restore.replayData)

        // Drain buffered events with cursor filter
        for (const event of restore.bufferedEvents) {
          if (event.offsetStart >= restore.replayEndOffset) {
            terminal.write(event.data)
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
        setDebugInfo(`restored pid=${String(restore.pid)}`)

        return
      }

      // NORMAL MODE: Spawn a new PTY process
      setDebugInfo('spawning...')

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
        // Use the resolved cwd from Rust (absolute path) if available,
        // otherwise fall back to the requested cwd.
        const newSession: TerminalSession = {
          id: result.sessionId,
          pid: result.pid,
          name: `Session ${result.sessionId}`,
          cwd: result.cwd ?? effectiveCwd,
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
        setDebugInfo(`running pid=${String(result.pid)}`)
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
        setDebugInfo(`error: ${errorMessage}`)
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
      offsetStart: number
    ): void => {
      if (eventSessionId === session.id && isMountedRef.current) {
        // Apply cursor filter: drop events below the replay end offset
        if (offsetStart >= cursorRef.current) {
          terminal.write(data)
        }
      }
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
    })()

    const unsubscribeExit = service.onExit(handleExit)
    const unsubscribeError = service.onError(handleError)

    return (): void => {
      dataSubscriptionCancelled = true
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
    debugInfo,
  }
}
