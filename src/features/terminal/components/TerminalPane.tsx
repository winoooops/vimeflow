import type { ReactElement } from 'react'
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { catppuccinMocha, toXtermTheme } from '../theme/catppuccin-mocha'
import '@xterm/xterm/css/xterm.css'

export interface TerminalPaneProps {
  /**
   * Terminal session identifier
   */
  sessionId: string
}

/**
 * TerminalPane component - renders an xterm.js terminal
 *
 * Features:
 * - Catppuccin Mocha theme
 * - Responsive sizing with fit addon
 * - Hardware-accelerated rendering with WebGL addon
 * - Automatic cleanup on unmount
 */
export const TerminalPane = ({
  sessionId,
}: TerminalPaneProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    // Create terminal instance
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Courier New", Courier, monospace',
      theme: toXtermTheme(catppuccinMocha),
      scrollback: 10000,
      allowProposedApi: true,
    })

    // Create and load fit addon
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    // Try to load WebGL addon (graceful degradation if not supported)
    try {
      const webglAddon = new WebglAddon()
      terminal.loadAddon(webglAddon)
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
      })
    } catch (error) {
      // WebGL not supported - continue with canvas renderer
      // Error intentionally ignored for graceful degradation
      void error
    }

    // Open terminal in container
    terminal.open(containerRef.current)

    // Fit terminal to container
    fitAddon.fit()

    // Handle resize events
    const resizeDisposable = terminal.onResize(() => {
      // Resize handler - will be used for PTY resize in useTerminal hook
      // For now, just ensure terminal is fitted
      fitAddon.fit()
    })

    // Store terminal reference
    terminalRef.current = terminal

    // Cleanup on unmount
    return (): void => {
      resizeDisposable.dispose()
      terminal.dispose()
      terminalRef.current = null
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
