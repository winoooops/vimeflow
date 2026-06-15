import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import { themeService } from '../../../../theme'
import type {
  TerminalInstance,
  TerminalParser,
  TerminalRendererHandle,
  TerminalSurface,
  TerminalTheme,
  TerminalViewportReader,
} from '../../types'
import { toXtermTheme } from '../../theme/toXtermTheme'
import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE } from './terminalFont'
import '@xterm/xterm/css/xterm.css'

export const createXtermTerminal = (): TerminalInstance => {
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: TERMINAL_FONT_SIZE,
    fontFamily: TERMINAL_FONT_FAMILY,
    theme: toXtermTheme(themeService.current().terminal),
    scrollback: 10000,
    allowProposedApi: true,
  })

  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  return {
    terminal: createTerminalSurface(terminal),
    parser: createTerminalParser(terminal),
    viewportReader: createTerminalViewportReader(terminal),
    fitController: fitAddon,
    attachRenderer: () => attachXtermRenderer(terminal),
  }
}

const createTerminalSurface = (terminal: Terminal): TerminalSurface => ({
  get cols(): number {
    return terminal.cols
  },
  get rows(): number {
    return terminal.rows
  },
  get element(): HTMLElement | undefined {
    return terminal.element ?? undefined
  },
  open: (container: HTMLElement): void => {
    terminal.open(container)
  },
  focus: (): void => {
    terminal.focus()
  },
  dispose: (): void => {
    terminal.dispose()
  },
  clear: (): void => {
    terminal.clear()
  },
  write: (data: string, callback?: () => void): void => {
    terminal.write(data, callback)
  },
  refresh: (start: number, end: number): void => {
    terminal.refresh(start, end)
  },
  onData: (handler: (data: string) => void) => terminal.onData(handler),
  onResize: (handler: (size: { cols: number; rows: number }) => void) =>
    terminal.onResize(handler),
  hasSelection: (): boolean => terminal.hasSelection(),
  getSelection: (): string => terminal.getSelection(),
  paste: (text: string): void => {
    terminal.paste(text)
  },
  selectAll: (): void => {
    terminal.selectAll()
  },
  onSelectionChange: (listener: () => void) =>
    terminal.onSelectionChange(listener),
  attachKeyEventHandler: (handler): void => {
    terminal.attachCustomKeyEventHandler(handler)
  },
  applyTheme: (theme: TerminalTheme): void => {
    terminal.options.theme = toXtermTheme(theme)
  },
})

const createTerminalParser = (terminal: Terminal): TerminalParser => ({
  registerOscHandler: (
    identifier: number,
    handler: (data: string) => boolean
  ) => terminal.parser.registerOscHandler(identifier, handler),
})

const createTerminalViewportReader = (
  terminal: Terminal
): TerminalViewportReader => ({
  readVisibleText: (): string => {
    const buffer = terminal.buffer.active
    const start = buffer.viewportY
    const end = start + terminal.rows
    const lines: string[] = []

    for (let i = start; i < end; i += 1) {
      const line = buffer.getLine(i)
      if (line) {
        lines.push(line.translateToString(true))
      }
    }

    return lines.join('\n').replace(/\n+$/, '')
  },
})

const loadCanvasRenderer = (terminal: Terminal): CanvasAddon | null => {
  try {
    const addon = new CanvasAddon()
    terminal.loadAddon(addon)

    return addon
  } catch {
    // Canvas2D unavailable: xterm keeps its DOM renderer.
    return null
  }
}

/**
 * Attach the preferred xterm renderer after `terminal.open(...)`.
 *
 * WebGL remains the primary renderer for large agent output throughput. Canvas2D
 * is a fallback that keeps custom glyph rendering active; if both fail, xterm's
 * built-in DOM renderer remains.
 */
const attachXtermRenderer = (terminal: Terminal): TerminalRendererHandle => {
  let webglAddon: WebglAddon | null = null
  let webglContextLossDisposable: { dispose: () => void } | null = null
  let canvasAddon: CanvasAddon | null = null

  try {
    const addon = new WebglAddon()
    webglContextLossDisposable = addon.onContextLoss(() => {
      addon.dispose()
      webglAddon = null
      webglContextLossDisposable = null
      canvasAddon = loadCanvasRenderer(terminal)
    })
    terminal.loadAddon(addon)
    webglAddon = addon
  } catch {
    canvasAddon = loadCanvasRenderer(terminal)
  }

  return {
    dispose: (): void => {
      webglContextLossDisposable?.dispose()
      webglContextLossDisposable = null
      webglAddon?.dispose()
      webglAddon = null
      canvasAddon?.dispose()
      canvasAddon = null
    },
  }
}
