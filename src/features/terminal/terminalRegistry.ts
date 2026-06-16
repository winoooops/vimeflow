import type {
  TerminalFitController,
  TerminalOutputWriter,
  TerminalSurface,
  TerminalViewportReader,
} from './types'

export interface TerminalRegistryEntry {
  terminal: TerminalSurface
  output: TerminalOutputWriter
  fitController: TerminalFitController
  viewportReader: TerminalViewportReader
}

// Registry of live terminal renderer instances keyed by pane PTY id.
//
// This is intentionally renderer-neutral: app code can focus, theme, resize, or
// read visible text from a terminal without knowing which adapter backs it.
export const terminalCache = new Map<string, TerminalRegistryEntry>()

export const clearTerminalCache = (): void => {
  terminalCache.forEach(({ terminal }) => terminal.dispose())
  terminalCache.clear()
}

export const disposeTerminalSession = (sessionId: string): void => {
  const cached = terminalCache.get(sessionId)
  if (cached) {
    cached.terminal.dispose()
    terminalCache.delete(sessionId)
  }
}
