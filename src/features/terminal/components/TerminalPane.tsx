import type { ReactElement } from 'react'
import { useEffect, useRef, useState, useMemo } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { catppuccinMocha, toXtermTheme } from '../theme/catppuccin-mocha'
import { useTerminal } from '../hooks/useTerminal'
import {
  MockTerminalService,
  type ITerminalService,
} from '../services/terminalService'
import '@xterm/xterm/css/xterm.css'

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

  // P2 Fix: Memoize default service instance to prevent recreation on every render
  const stableService = useMemo(
    () => service ?? new MockTerminalService(),
    [service]
  )

  // Use terminal hook for PTY lifecycle management
  const { resize } = useTerminal({
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

  // Send initial resize once terminal is fitted and session is spawned
  // This ensures the PTY starts with the correct dimensions even if the user never resizes
  useEffect(() => {
    if (terminal) {
      resize(terminal.cols, terminal.rows)
    }
  }, [terminal, resize])

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    // Create terminal instance
    const newTerminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Courier New", Courier, monospace',
      theme: toXtermTheme(catppuccinMocha),
      scrollback: 10000,
      allowProposedApi: true,
    })

    // Create and load fit addon
    const fitAddon = new FitAddon()
    newTerminal.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    // Try to load WebGL addon (graceful degradation if not supported)
    try {
      const webglAddon = new WebglAddon()
      newTerminal.loadAddon(webglAddon)
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
      })
    } catch (error) {
      // WebGL not supported - continue with canvas renderer
      // Error intentionally ignored for graceful degradation
      void error
    }

    // Open terminal in container
    newTerminal.open(containerRef.current)

    // Fit terminal to container
    fitAddon.fit()

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

    // Store terminal in state to trigger useTerminal hook
    setTerminal(newTerminal)

    // Cleanup on unmount
    return (): void => {
      resizeDisposable.dispose()
      newTerminal.dispose()
      setTerminal(null)
      fitAddonRef.current = null
    }
  }, [sessionId])

  return (
    <div
      ref={containerRef}
      data-testid="terminal-pane"
      data-session-id={sessionId}
      className="w-full h-full overflow-hidden"
    />
  )
}
