/* eslint-disable react/require-default-props */
import type { ReactElement } from 'react'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
// WebGL addon disabled — causes blank terminal in Tauri's webview (WebView2/WebKit)
// due to broken WebGL2 context. Canvas2D renderer works fine. See PR #33.
import { catppuccinMocha, toXtermTheme } from '../../theme/catppuccin-mocha'
import {
  useTerminal,
  type RestoreData,
  type NotifyPaneReady,
} from '../../hooks/useTerminal'
import { type ITerminalService } from '../../services/terminalService'
import { registerPtySession, unregisterPtySession } from '../../ptySessionMap'
import '@xterm/xterm/css/xterm.css'

// Module-level cache of terminal instances per sessionId.
//
// HISTORICAL NOTE (corrected 2026-05-09): the original comment claimed
// this cache "allows terminals to persist when switching between
// sessions". That's not what makes tab switching work today —
// `TerminalZone` always-renders inactive panes and hides them via
// CSS `display: none` rather than unmount/remount, so Body never
// unmounts on a tab switch and the cache hit/miss branch in the mount
// effect is not the persistence mechanism. Body's stable mount is.
//
// What the cache actually serves:
//   - the imperative `focusTerminal()` handle, which reads
//     `terminalCache.get(sessionId)?.terminal.focus()` to focus xterm
//     without reaching into Body's internals;
//   - tests + the existing public `clearTerminalCache` /
//     `disposeTerminalSession` API surface (preserved per the step-4
//     migration spec — external imports would break otherwise).
//
// New internal code should NOT add to the cache for "tab persistence"
// reasons; xterm lifetime is scoped to Body's mount.
export const terminalCache = new Map<
  string,
  { terminal: Terminal; fitAddon: FitAddon }
>()

/**
 * Clear terminal cache (for testing only)
 */
export const clearTerminalCache = (): void => {
  terminalCache.forEach(({ terminal }) => terminal.dispose())
  terminalCache.clear()
}

/**
 * Dispose and remove a single session's terminal from cache.
 * Call when a session is permanently closed (not just hidden).
 */
export const disposeTerminalSession = (sessionId: string): void => {
  const cached = terminalCache.get(sessionId)
  if (cached) {
    cached.terminal.dispose()
    terminalCache.delete(sessionId)
  }
}

export type BodyMode = 'attach' | 'spawn'

export interface BodyProps {
  /**
   * Terminal session identifier
   */
  sessionId: string

  /**
   * Current working directory for the shell
   */
  cwd: string

  /**
   * Terminal service used for PTY operations.
   *
   * Round 4, Finding 1 (codex P1): REQUIRED — must be the same instance the
   * `useSessionManager` hook receives. Previously this defaulted to a
   * `useMemo(() => createTerminalService(), ...)` per-pane fallback, which
   * worked under Tauri (singleton) but produced disjoint `MockTerminalService`
   * instances in the browser/Vite/test workflow — sessions spawned by the
   * manager never attached in the pane and close/restart calls talked to a
   * different empty service. Removing the fallback forces callers to share
   * one service via prop drilling (TerminalZone forwards it from
   * WorkspaceView).
   */
  service: ITerminalService

  /**
   * Optional shell path (defaults to system shell)
   * @default undefined
   */
  shell?: string

  /**
   * Optional environment variables
   * @default undefined
   */
  env?: Record<string, string>

  /**
   * Optional restore data for reconnecting to an existing session
   */
  restoredFrom?: RestoreData

  /**
   * Called when the shell reports a working directory change (via OSC 7)
   */
  onCwdChange?: (cwd: string) => void

  /**
   * Bridge to `useSessionManager.notifyPaneReady`. Forwarded to
   * `useTerminal`; called once the pane's live data subscription is attached
   * so the orchestrator can drain its mount-time buffer for this session.
   */
  onPaneReady?: NotifyPaneReady

  /**
   * Explicit lifecycle mode — see {@link BodyMode}.
   * @default 'spawn'
   */
  mode?: BodyMode

  /**
   * Called whenever the underlying PTY hook reports a status transition.
   */
  onPtyStatusChange?: (status: 'idle' | 'running' | 'exited' | 'error') => void

  /**
   * Called when xterm gains or loses focus.
   */
  onFocusChange?: (focused: boolean) => void

  /**
   * Defer expensive xterm fitting while surrounding layout is actively being
   * dragged. The final size is fitted when this flips back to false.
   */
  deferFit?: boolean
}

export interface BodyHandle {
  focusTerminal: () => void
}

export const Body = forwardRef<BodyHandle, BodyProps>(function Body(
  {
    sessionId,
    cwd,
    service,
    shell = undefined,
    env = undefined,
    restoredFrom = undefined,
    onCwdChange = undefined,
    onPaneReady = undefined,
    mode = 'spawn',
    onPtyStatusChange = undefined,
    onFocusChange = undefined,
    deferFit = false,
  },
  ref
): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const [terminal, setTerminal] = useState<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const deferFitRef = useRef(deferFit)
  const previousDeferFitRef = useRef(deferFit)
  const cancelScheduledFitRef = useRef<(() => void) | null>(null)
  const flushFitRef = useRef<(() => void) | null>(null)

  // Use terminal hook for PTY lifecycle management
  const {
    session: ptySession,
    resize,
    status,
  } = useTerminal({
    terminal,
    service,
    cwd,
    shell,
    env,
    restoredFrom,
    onPaneReady,
    mode,
  })

  // Bridge workspace sessionId ↔ PTY sessionId for agent detection.
  // Use the PTY session's resolved cwd (absolute path from Rust),
  // not the prop cwd which may be "~".
  useEffect(() => {
    if (ptySession?.id) {
      registerPtySession(sessionId, ptySession.id, ptySession.cwd)
    }

    return (): void => {
      unregisterPtySession(sessionId)
    }
  }, [sessionId, ptySession?.id, ptySession?.cwd])

  // Store callbacks in refs to avoid terminal recreation when they change
  const onCwdChangeRef = useRef(onCwdChange)
  useEffect(() => {
    onCwdChangeRef.current = onCwdChange
  }, [onCwdChange])

  // P1 Fix: Store resize callback in ref to avoid terminal recreation when it changes
  const resizeRef = useRef(resize)

  // Keep ref up to date
  useEffect(() => {
    resizeRef.current = resize
  }, [resize])

  const onPtyStatusChangeRef = useRef(onPtyStatusChange)
  const onFocusChangeRef = useRef(onFocusChange)

  useEffect(() => {
    onPtyStatusChangeRef.current = onPtyStatusChange
  }, [onPtyStatusChange])

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange
  }, [onFocusChange])

  useEffect(() => {
    onPtyStatusChangeRef.current?.(status)
  }, [status])

  useLayoutEffect(() => {
    const wasDeferred = previousDeferFitRef.current

    deferFitRef.current = deferFit

    if (!wasDeferred && deferFit) {
      cancelScheduledFitRef.current?.()
    } else if (wasDeferred && !deferFit) {
      flushFitRef.current?.()
    }

    previousDeferFitRef.current = deferFit
  }, [deferFit])

  useImperativeHandle(
    ref,
    () => ({
      focusTerminal: (): void => {
        const cached = terminalCache.get(sessionId)
        cached?.terminal.focus()
      },
    }),
    [sessionId]
  )

  // P2 Fix: Send resize when terminal is created AND when session becomes running
  // The initial resize effect runs immediately when terminal is created, but resize()
  // is a no-op until the session is actually spawned and status becomes 'running'.
  // By including status in dependencies, we re-trigger resize when the session transitions.
  useEffect(() => {
    if (terminal && status === 'running') {
      resize(terminal.cols, terminal.rows)
    }
  }, [terminal, resize, status])

  // P2 Fix: Terminal instance management with caching.
  // Terminals persist when switching sessions to avoid killing PTY processes.
  useEffect(() => {
    const node = containerRef.current
    if (!node) {
      return
    }

    // Check if we already have a terminal for this session
    const cached = terminalCache.get(sessionId)
    let newTerminal: Terminal
    let fitAddon: FitAddon
    let fitFrameId: number | null = null
    let lastFitSize: { width: number; height: number } | null = null

    const cancelScheduledFit = (): void => {
      if (fitFrameId !== null) {
        window.cancelAnimationFrame(fitFrameId)
        fitFrameId = null
      }
    }

    const fitIfNeeded = (targetFitAddon: FitAddon, force = false): void => {
      const width = node.offsetWidth
      const height = node.offsetHeight

      if (width <= 0) {
        return
      }

      if (
        !force &&
        lastFitSize !== null &&
        lastFitSize.width === width &&
        lastFitSize.height === height
      ) {
        return
      }

      lastFitSize = { width, height }
      targetFitAddon.fit()
    }

    const scheduleFit = (targetFitAddon: FitAddon): void => {
      if (deferFitRef.current) {
        return
      }

      if (fitFrameId !== null) {
        return
      }

      fitFrameId = window.requestAnimationFrame(() => {
        fitFrameId = null
        if (deferFitRef.current) {
          return
        }
        fitIfNeeded(targetFitAddon)
      })
    }

    const flushFit = (targetFitAddon: FitAddon): void => {
      cancelScheduledFit()

      fitFrameId = window.requestAnimationFrame(() => {
        fitFrameId = null
        if (deferFitRef.current) {
          return
        }
        fitIfNeeded(targetFitAddon)
      })
    }

    const fitInitialWhenReady = (targetFitAddon: FitAddon): void => {
      if (deferFitRef.current) {
        return
      }

      fitIfNeeded(targetFitAddon, true)
    }

    if (cached) {
      // Reuse existing terminal from cache
      newTerminal = cached.terminal
      fitAddon = cached.fitAddon
      fitAddonRef.current = fitAddon

      // Re-open terminal in the new container
      newTerminal.open(node)

      // Re-fit to new container — guard against hidden (display:none) containers
      // where offsetWidth is 0. Fitting at zero width tells xterm cols≈1,
      // which causes the PTY to re-wrap scrollback into a narrow column.
      fitInitialWhenReady(fitAddon)
    } else {
      // Create new terminal instance
      newTerminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily:
          '"JetBrains Mono", "Pure Nerd Font", "Courier New", Courier, monospace',
        theme: toXtermTheme(catppuccinMocha),
        scrollback: 10000,
        allowProposedApi: true,
      })

      // Create and load fit addon
      fitAddon = new FitAddon()
      newTerminal.loadAddon(fitAddon)
      fitAddonRef.current = fitAddon

      // WebGL addon intentionally disabled — see comment at top of file.
      // Open terminal in container
      newTerminal.open(node)

      // Fit terminal to container — guard against hidden (display:none) containers
      fitInitialWhenReady(fitAddon)

      // Register OSC 7 handler for cwd tracking
      // Shells emit: \e]7;file://hostname/path\a on every cd
      newTerminal.parser.registerOscHandler(7, (data) => {
        try {
          const url = new URL(data)
          let path = decodeURIComponent(url.pathname)
          // Windows: new URL("file://host/C:/Users/...").pathname → "/C:/Users/..."
          // Strip the leading slash before a drive letter so Rust canonicalize works
          if (/^\/[A-Za-z]:/.test(path)) {
            path = path.slice(1)
          }
          if (path) {
            onCwdChangeRef.current?.(path)
          }
        } catch {
          // Not a valid URL — some shells emit plain paths
          if (data.startsWith('/')) {
            onCwdChangeRef.current?.(data)
          }
        }

        return true
      })

      // Cache the terminal instance for this session
      terminalCache.set(sessionId, { terminal: newTerminal, fitAddon })
    }

    cancelScheduledFitRef.current = cancelScheduledFit
    flushFitRef.current = (): void => {
      flushFit(fitAddon)
    }

    // Send initial terminal size to PTY (avoids default 80×24 when terminal is actually larger)
    // This will be a no-op on first render but ensures PTY gets correct size on subsequent recreations
    resizeRef.current(newTerminal.cols, newTerminal.rows)

    // Handle resize events - notify PTY of terminal size changes.
    // The cols/rows from xterm's onResize event are already correct because
    // fitAddon.fit() (the trigger upstream) has already computed and applied
    // them. Calling fit() again here would re-measure the container — pure
    // overhead during rapid sidebar drag / window resize. Just forward to PTY.
    let lastForwardedResize: { cols: number; rows: number } | null = null

    const resizeDisposable = newTerminal.onResize(({ cols, rows }) => {
      // Guard: don't forward resize when container is hidden (display:none).
      // Otherwise the PTY receives cols≈1 and re-wraps scrollback.
      const width = containerRef.current?.offsetWidth ?? 0
      if (width <= 0) {
        return
      }

      if (
        lastForwardedResize?.cols === cols &&
        lastForwardedResize.rows === rows
      ) {
        return
      }

      lastForwardedResize = { cols, rows }

      // Notify PTY service of size change using ref (stable across renders)
      resizeRef.current(cols, rows)
    })

    const handleFocusIn = (): void => {
      onFocusChangeRef.current?.(true)
    }

    const handleFocusOut = (): void => {
      onFocusChangeRef.current?.(false)
    }

    node.addEventListener('focusin', handleFocusIn)
    node.addEventListener('focusout', handleFocusOut)

    // P2 Fix: Add ResizeObserver to detect container size changes
    // When the container resizes (e.g., window resize, panel collapse),
    // fit the terminal which will trigger the onResize event above.
    // Guard: skip fit when container is hidden (display:none → width=0)
    // to avoid PTY scrollback re-wrapping at a narrow column count.
    const resizeObserver = new ResizeObserver(() => {
      scheduleFit(fitAddon)
    })
    resizeObserver.observe(node)

    // Store terminal in state to trigger useTerminal hook
    setTerminal(newTerminal)

    // Cleanup: disconnect observers and dispose terminal from cache
    // When Body unmounts, the session is closed — free resources
    return (): void => {
      cancelScheduledFit()
      cancelScheduledFitRef.current = null
      flushFitRef.current = null
      resizeObserver.disconnect()
      resizeDisposable.dispose()
      node.removeEventListener('focusin', handleFocusIn)
      node.removeEventListener('focusout', handleFocusOut)
      const entry = terminalCache.get(sessionId)
      if (entry) {
        entry.terminal.dispose()
        terminalCache.delete(sessionId)
      }
      setTerminal(null)
      fitAddonRef.current = null
    }
  }, [sessionId])

  return (
    <div
      data-testid="terminal-pane-body-wrapper"
      className="terminal-pane-body relative h-full w-full overflow-hidden"
    >
      <div
        ref={containerRef}
        data-testid="terminal-pane"
        data-session-id={sessionId}
        className="h-full w-full"
      />
    </div>
  )
})
