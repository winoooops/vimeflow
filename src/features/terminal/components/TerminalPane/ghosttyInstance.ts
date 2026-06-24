// cspell:ignore ghostty
import type { GhosttyVtScrollback } from '../../../../bindings'
import type {
  TerminalFitController,
  TerminalInstance,
  TerminalRendererAdapter,
  TerminalRendererHandle,
  TerminalOutputWriter,
  TerminalParser,
  TerminalSize,
  TerminalViewportReader,
} from '../../types'
import { GHOSTTY_TERMINAL_RENDERER_ID } from './ghosttyRendererMetadata'
import { createGhosttyParserEngine } from './ghosttyParserEngine'
import { encodeScrollback } from './ghosttyVtRenderSnapshot'
import type { TerminalParserEngine } from './terminalParserEngine'
import { GHOSTTY_TERMINAL_CAPABILITIES } from './terminalRendererCapabilities'
import {
  TerminalTextSurface,
  type TerminalTextSurfaceOutput,
} from './terminalTextSurface'
import {
  createGhosttyVtRenderStateParserEngine,
  type GhosttyVtRenderStateDriverFactory,
} from './ghosttyVtRenderStateDriver'

export { GHOSTTY_TERMINAL_RENDERER_ID } from './ghosttyRendererMetadata'

export interface GhosttyTerminalOptions {
  readonly createParserEngine?: () => TerminalParserEngine
  readonly createVtRenderStateDriver?: GhosttyVtRenderStateDriverFactory
}

const createParserEngineForGhosttyTerminal = (
  options: GhosttyTerminalOptions
): TerminalParserEngine => {
  if (options.createParserEngine) {
    return options.createParserEngine()
  }

  if (options.createVtRenderStateDriver) {
    return createGhosttyVtRenderStateParserEngine(
      options.createVtRenderStateDriver
    )
  }

  return createGhosttyParserEngine()
}

class GhosttyTerminalModel {
  private readonly parserEngine: TerminalParserEngine
  private isDisposed = false
  private isRendererDisposed = false
  private syncedParserEngineSize: TerminalSize | null = null
  readonly terminal: TerminalTextSurface
  readonly parser: TerminalParser

  constructor(options: GhosttyTerminalOptions = {}) {
    this.parserEngine = createParserEngineForGhosttyTerminal(options)
    this.parser = this.parserEngine.parser

    this.terminal = new TerminalTextSurface({
      rendererId: GHOSTTY_TERMINAL_RENDERER_ID,
      transformOutput: (data): TerminalTextSurfaceOutput =>
        this.parserEngine.acceptsTextInput === false
          ? { visibleText: data }
          : this.parserEngine.parseText(data, null),
    })

    const originalTerminalOpen = this.terminal.open.bind(this.terminal)
    this.terminal.open = (container): void => {
      originalTerminalOpen(container)
      this.syncParserEngineSize()
    }

    const originalTerminalClear = this.terminal.clear.bind(this.terminal)
    this.terminal.clear = (): void => {
      originalTerminalClear()
      this.parserEngine.reset?.()
      this.syncParserEngineSize({ force: true })
    }

    const originalTerminalDispose = this.terminal.dispose.bind(this.terminal)
    this.terminal.dispose = (): void => {
      if (this.isDisposed) {
        return
      }

      this.isDisposed = true
      originalTerminalDispose()
      this.parserEngine.dispose?.()
    }

    this.syncParserEngineSize()
  }

  readonly output: TerminalOutputWriter = {
    writeOutput: (chunk, callback): void => {
      if (this.terminal.isDisposed()) {
        callback?.()

        return
      }

      const output = this.parserEngine.parseOutput(chunk)

      this.terminal.writeParsedOutput(output, callback)
    },
  }

  readonly viewportReader: TerminalViewportReader = {
    readVisibleText: (): string => this.terminal.readVisibleText(),
  }

  readonly fitController: TerminalFitController = {
    fit: (): void => {
      this.terminal.fit()
      this.syncParserEngineSize()
    },
  }

  readonly rendererHandle: TerminalRendererHandle = {
    dispose: (): void => {
      if (this.isRendererDisposed) {
        return
      }

      this.isRendererDisposed = true
    },
  }

  // Bridge the raw scrollback fetcher into the surface, encoding each fetched
  // window (cells → SGR-sentinel displayText) so the surface stays agnostic of
  // the snapshot cell shape. Returns null when the backend has no rows, which
  // the surface treats as "nothing to prepend".
  setScrollbackFetcher(
    rawFetch: (start: number, count: number) => Promise<GhosttyVtScrollback>
  ): void {
    this.terminal.setScrollbackFetcher(async (start, count) => {
      const scrollback = await rawFetch(start, count)

      return scrollback.rows.length > 0
        ? {
            displayText: encodeScrollback({
              rows: scrollback.rows,
              cells: scrollback.cells,
            }).displayText,
          }
        : null
    })
  }

  createInstance(): TerminalInstance {
    return {
      terminal: this.terminal,
      output: this.output,
      parser: this.parser,
      viewportReader: this.viewportReader,
      fitController: this.fitController,
      attachRenderer: (): TerminalRendererHandle => this.rendererHandle,
      setScrollbackFetcher: (
        fetch: (start: number, count: number) => Promise<GhosttyVtScrollback>
      ): void => this.setScrollbackFetcher(fetch),
    }
  }

  private syncParserEngineSize(options: { force?: boolean } = {}): void {
    const size = {
      cols: this.terminal.cols,
      rows: this.terminal.rows,
    }

    if (
      !options.force &&
      this.syncedParserEngineSize?.cols === size.cols &&
      this.syncedParserEngineSize.rows === size.rows
    ) {
      return
    }

    this.syncedParserEngineSize = size
    this.parserEngine.resize?.(size)
  }
}

export const createGhosttyTerminal = (
  options: GhosttyTerminalOptions = {}
): TerminalInstance => new GhosttyTerminalModel(options).createInstance()

export const createGhosttyTerminalRenderer = (
  options: GhosttyTerminalOptions = {}
): TerminalRendererAdapter => ({
  id: GHOSTTY_TERMINAL_RENDERER_ID,
  capabilities: GHOSTTY_TERMINAL_CAPABILITIES,
  createInstance: (): TerminalInstance => createGhosttyTerminal(options),
})

export const ghosttyTerminalRenderer: TerminalRendererAdapter = {
  id: GHOSTTY_TERMINAL_RENDERER_ID,
  capabilities: GHOSTTY_TERMINAL_CAPABILITIES,
  createInstance: createGhosttyTerminal,
}
