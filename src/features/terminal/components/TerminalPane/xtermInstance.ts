import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import { themeService } from '../../../../theme'
import type {
  TerminalInstance,
  TerminalOutputChunk,
  TerminalOutputWriter,
  TerminalParserEvent,
  TerminalParserEventHandler,
  TerminalParserOutputContext,
  TerminalParser,
  TerminalRendererHandle,
  TerminalRendererAdapter,
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
  const outputContext = createTerminalOutputContext()

  return {
    terminal: createTerminalSurface(terminal),
    output: createTerminalOutputWriter(terminal, outputContext),
    parser: createTerminalParser(terminal, outputContext),
    viewportReader: createTerminalViewportReader(terminal),
    fitController: fitAddon,
    attachRenderer: () => attachXtermRenderer(terminal),
  }
}

export const xtermTerminalRenderer: TerminalRendererAdapter = {
  id: 'xterm',
  capabilities: {
    preferredOutputInputMode: 'text',
    acceptsText: true,
    acceptsBytes: false,
  },
  createInstance: createXtermTerminal,
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

interface TerminalOutputContextTracker {
  readonly current: () => TerminalParserOutputContext | null
  readonly push: (chunk: TerminalOutputChunk) => void
  readonly finish: (chunk: TerminalOutputChunk) => void
}

const outputContextFromChunk = (
  chunk: TerminalOutputChunk
): TerminalParserOutputContext => ({
  offsetStart: chunk.offsetStart,
  byteLen: chunk.byteLen,
  phase: chunk.phase,
})

const createTerminalOutputContext = (): TerminalOutputContextTracker => {
  const pendingChunks: TerminalOutputChunk[] = []
  let activeChunk: TerminalOutputChunk | null = null

  const activateNext = (): void => {
    activeChunk = pendingChunks[0] ?? null
  }

  return {
    current: (): TerminalParserOutputContext | null =>
      activeChunk ? outputContextFromChunk(activeChunk) : null,
    push: (chunk): void => {
      pendingChunks.push(chunk)

      activeChunk ??= chunk
    },
    finish: (chunk): void => {
      const index = pendingChunks.indexOf(chunk)

      if (index !== -1) {
        pendingChunks.splice(index, 1)
      }

      if (activeChunk === chunk) {
        activateNext()
      }
    },
  }
}

const createTerminalOutputWriter = (
  terminal: Terminal,
  outputContext: TerminalOutputContextTracker
): TerminalOutputWriter => ({
  writeOutput: (chunk, callback): void => {
    outputContext.push(chunk)
    terminal.write(chunk.text, () => {
      outputContext.finish(chunk)
      callback?.()
    })
  },
})

const createTerminalParser = (
  terminal: Terminal,
  outputContext: TerminalOutputContextTracker
): TerminalParser => {
  const handlers = new Set<TerminalParserEventHandler>()
  let osc7Disposable: { dispose: () => void } | null = null

  const emit = (event: TerminalParserEvent): void => {
    handlers.forEach((handler) => {
      handler(event)
    })
  }

  const ensureOsc7Handler = (): void => {
    if (osc7Disposable) {
      return
    }

    osc7Disposable = terminal.parser.registerOscHandler(7, (data) => {
      emit({
        type: 'cwd',
        source: 'osc7',
        uri: data,
        output: outputContext.current(),
      })

      return true
    })
  }

  const removeOsc7HandlerIfIdle = (): void => {
    if (handlers.size > 0) {
      return
    }

    osc7Disposable?.dispose()
    osc7Disposable = null
  }

  return {
    onEvent: (handler): { dispose: () => void } => {
      handlers.add(handler)
      ensureOsc7Handler()

      return {
        dispose: (): void => {
          handlers.delete(handler)
          removeOsc7HandlerIfIdle()
        },
      }
    },
  }
}

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
