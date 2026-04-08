import type { ReactElement } from 'react'
import { useEffect, useRef, useState, useMemo } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { catppuccinMocha, toXtermTheme } from '../theme/catppuccin-mocha'
import { useTerminal } from '../hooks/useTerminal'
import {
  createTerminalService,
  type ITerminalService,
} from '../services/terminalService'
import { isTauri } from '../../../lib/environment'
import '@xterm/xterm/css/xterm.css'

// P2 Fix: Global cache of terminal instances per sessionId
// This allows terminals to persist when switching between sessions
const terminalCache = new Map<
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
   * Optional terminal service (defaults to MockTerminalService in dev)
   */
  service?: ITerminalService

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
}

/**
 * TerminalPane component - renders an xterm.js terminal with PTY integration
 *
 * Features:
 * - Catppuccin Mocha theme
 * - Responsive sizing with fit addon
 * - Hardware-accelerated rendering with WebGL addon
 * - PTY process spawning and lifecycle management
 * - Bidirectional data flow (xterm ↔ PTY)
 * - Automatic cleanup on unmount
 */
export const TerminalPane = ({
  sessionId,
  cwd,
  service = undefined,
  shell = undefined,
  env = undefined,
}: TerminalPaneProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [terminal, setTerminal] = useState<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // Memoize service: use injected service (tests) or factory (Tauri/browser auto-detect)
  const stableService = useMemo(
    () => service ?? createTerminalService(),
    [service]
  )

  // Use terminal hook for PTY lifecycle management
  const { resize, status, debugInfo } = useTerminal({
    terminal,
    service: stableService,
    cwd,
    shell,
    env,
  })

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

  // P2 Fix: Terminal instance management with caching
  // Terminals persist when switching sessions to avoid killing PTY processes
  useEffect(() => {
    if (!containerRef.current) {
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

      // Re-fit to new container
      fitAddon.fit()
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

      // WebGL addon intentionally disabled — Tauri's webview (WebView2/WebKit)
      // has a silently broken WebGL2 context that causes a blank terminal.
      // Canvas2D fallback works correctly. See PR #33 for details.

      // Open terminal in container
      newTerminal.open(containerRef.current)

      // Fit terminal to container
      fitAddon.fit()

      // Cache the terminal instance for this session
      terminalCache.set(sessionId, { terminal: newTerminal, fitAddon })
    }

    // Send initial terminal size to PTY (avoids default 80×24 when terminal is actually larger)
    // This will be a no-op on first render but ensures PTY gets correct size on subsequent recreations
    resizeRef.current(newTerminal.cols, newTerminal.rows)

    // Handle resize events - notify PTY of terminal size changes
    const resizeDisposable = newTerminal.onResize(({ cols, rows }) => {
      // Fit terminal to container
      fitAddon.fit()

      // Notify PTY service of size change using ref (stable across renders)
      resizeRef.current(cols, rows)
    })

    // P2 Fix: Add ResizeObserver to detect container size changes
    // When the container resizes (e.g., window resize, panel collapse),
    // fit the terminal which will trigger the onResize event above
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
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
  }, [sessionId])

  return (
    <div
      data-testid="terminal-pane-wrapper"
      className="relative flex w-full h-full flex-col overflow-hidden"
    >
      <div
        ref={containerRef}
        data-testid="terminal-pane"
        data-session-id={sessionId}
        className="w-full flex-1 min-h-0"
      />
      {/* DEBUG: status bar (bottom of terminal area) */}
      <div className="shrink-0 bg-black/80 px-2 py-0.5 text-xs font-mono text-green-400 border-t border-green-900/40">
        env={isTauri() ? 'tauri' : 'browser'} | status={status} | debug=
        {debugInfo}
      </div>
    </div>
  )
}
