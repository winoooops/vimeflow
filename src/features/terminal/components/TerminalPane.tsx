import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
// WebGL addon disabled — causes blank terminal in Tauri's webview (WebView2/WebKit)
// due to broken WebGL2 context. Canvas2D renderer works fine. See PR #33.
import { catppuccinMocha, toXtermTheme } from '../theme/catppuccin-mocha'
import {
  useTerminal,
  type RestoreData,
  type NotifyPaneReady,
} from '../hooks/useTerminal'
import { type ITerminalService } from '../services/terminalService'
import { registerPtySession, unregisterPtySession } from '../ptySessionMap'
import '@xterm/xterm/css/xterm.css'

// P2 Fix: Global cache of terminal instances per sessionId
// This allows terminals to persist when switching between sessions
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

/**
 * Terminal pane lifecycle mode — explicit instead of inferred from
 * `restoredFrom`. Inference was the source of two Codex P1 bugs:
 *
 *   - Newly-created sessions (createSession spawned, then TerminalPane
 *     mounted with restoredFrom undefined) hit the spawn branch a second
 *     time and created hidden duplicate PTYs.
 *   - Cached Exited sessions (no restoredFrom) were resurrected as fresh
 *     PTYs on reload instead of waiting for the user to opt in to restart.
 */
export type TerminalPaneMode = 'attach' | 'spawn' | 'awaiting-restart'

export interface TerminalPaneProps {
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
   * Explicit lifecycle mode — see {@link TerminalPaneMode}.
   * @default 'spawn'
   */
  mode?: TerminalPaneMode

  /**
   * Called when the user clicks Restart in `awaiting-restart` mode. No-op
   * if not provided.
   */
  onRestart?: (sessionId: string) => void
}

/**
 * TerminalPane component - renders an xterm.js terminal with PTY integration
 *
 * Features:
 * - Catppuccin Mocha theme
 * - Responsive sizing with fit addon
 * - Canvas2D renderer (WebGL disabled — broken in Tauri webview)
 * - PTY process spawning and lifecycle management
 * - Bidirectional data flow (xterm ↔ PTY)
 * - Automatic cleanup on unmount
 */
export const TerminalPane = ({
  sessionId,
  cwd,
  service,
  shell = undefined,
  env = undefined,
  restoredFrom = undefined,
  onCwdChange = undefined,
  onPaneReady = undefined,
  mode = 'spawn',
  onRestart = undefined,
}: TerminalPaneProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [terminal, setTerminal] = useState<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // awaiting-restart mode: render a Restart affordance and skip ALL PTY
  // interaction (no spawn, no attach, no xterm). Per spec, exited sessions
  // wait for explicit user action — auto-respawn would mask intentional
  // exits and silently re-execute commands in stale cwds.
  const isAwaitingRestart = mode === 'awaiting-restart'

  // Use terminal hook for PTY lifecycle management
  const {
    session: ptySession,
    resize,
    status,
  } = useTerminal({
    // Pass null terminal in awaiting-restart so useTerminal short-circuits.
    terminal: isAwaitingRestart ? null : terminal,
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
  // Skip xterm setup entirely in awaiting-restart mode — there's no PTY to
  // attach to and we render a Restart button instead of a terminal.
  useEffect(() => {
    if (!containerRef.current || isAwaitingRestart) {
      return
    }

    // Check if we already have a terminal for this session
    const cached = terminalCache.get(sessionId)
    let newTerminal: Terminal
    let fitAddon: FitAddon

    if (cached) {
      // Reuse existing terminal from cache
      newTerminal = cached.terminal
      fitAddon = cached.fitAddon
      fitAddonRef.current = fitAddon

      // Re-open terminal in the new container
      newTerminal.open(containerRef.current)

      // Re-fit to new container — guard against hidden (display:none) containers
      // where offsetWidth is 0. Fitting at zero width tells xterm cols≈1,
      // which causes the PTY to re-wrap scrollback into a narrow column.
      const width = containerRef.current.offsetWidth
      if (width > 0) {
        fitAddon.fit()
      }
    } else {
      // Create new terminal instance
      newTerminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: '"JetBrains Mono", "Courier New", Courier, monospace',
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
      newTerminal.open(containerRef.current)

      // Fit terminal to container — guard against hidden (display:none) containers
      const width = containerRef.current.offsetWidth
      if (width > 0) {
        fitAddon.fit()
      }

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

    // Send initial terminal size to PTY (avoids default 80×24 when terminal is actually larger)
    // This will be a no-op on first render but ensures PTY gets correct size on subsequent recreations
    resizeRef.current(newTerminal.cols, newTerminal.rows)

    // Handle resize events - notify PTY of terminal size changes
    const resizeDisposable = newTerminal.onResize(({ cols, rows }) => {
      // Guard: don't forward resize when container is hidden (display:none).
      // Otherwise the PTY receives cols≈1 and re-wraps scrollback.
      const width = containerRef.current?.offsetWidth ?? 0
      if (width > 0) {
        // Fit terminal to container
        fitAddon.fit()

        // Notify PTY service of size change using ref (stable across renders)
        resizeRef.current(cols, rows)
      }
    })

    // P2 Fix: Add ResizeObserver to detect container size changes
    // When the container resizes (e.g., window resize, panel collapse),
    // fit the terminal which will trigger the onResize event above.
    // Guard: skip fit when container is hidden (display:none → width=0)
    // to avoid PTY scrollback re-wrapping at a narrow column count.
    const resizeObserver = new ResizeObserver(() => {
      const width = containerRef.current?.offsetWidth ?? 0
      if (width > 0) {
        fitAddon.fit()
      }
    })
    resizeObserver.observe(containerRef.current)

    // Store terminal in state to trigger useTerminal hook
    setTerminal(newTerminal)

    // Cleanup: disconnect observers and dispose terminal from cache
    // When TerminalPane unmounts, the session is closed — free resources
    return (): void => {
      resizeObserver.disconnect()
      resizeDisposable.dispose()
      const entry = terminalCache.get(sessionId)
      if (entry) {
        entry.terminal.dispose()
        terminalCache.delete(sessionId)
      }
      setTerminal(null)
      fitAddonRef.current = null
    }
  }, [sessionId, isAwaitingRestart])

  // Awaiting-restart: render a Restart affordance instead of an xterm.
  // Per the design spec ("no auto-respawn for Exited" IDEA), the user must
  // explicitly opt in to restarting an Exited session.
  if (isAwaitingRestart) {
    return (
      <div
        data-testid="terminal-pane-wrapper"
        data-session-id={sessionId}
        data-mode="awaiting-restart"
        className="relative flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden bg-surface text-on-surface/70"
      >
        <p className="font-mono text-sm">Session exited.</p>
        <button
          type="button"
          aria-label={`Restart session ${sessionId}`}
          onClick={() => onRestart?.(sessionId)}
          className="rounded bg-surface-container px-3 py-1.5 font-label text-sm text-on-surface hover:bg-surface-container/80"
        >
          Restart
        </button>
      </div>
    )
  }

  return (
    <div
      data-testid="terminal-pane-wrapper"
      className="relative w-full h-full overflow-hidden"
    >
      <div
        ref={containerRef}
        data-testid="terminal-pane"
        data-session-id={sessionId}
        className="w-full h-full"
      />
    </div>
  )
}
