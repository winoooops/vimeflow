// cspell:ignore ghostty
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
  private renderFlushScheduled = false
  private renderFlushHandle: number | null = null
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
      this.cancelRenderFlush()
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
      this.cancelRenderFlush()
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

      // Feed bytes synchronously — OSC7 effects + 2026 tracking happen here.
      // Synchronous parsers return their render delta now; the render-state
      // byte path returns empty and renders later via flushOutput.
      const output = this.parserEngine.parseOutput(chunk)
      this.terminal.writeParsedOutput(output, callback)

      // Coalesce the render-state snapshot read + render to one per animation
      // frame so transient mid-redraw frames are never painted. A no-op for the
      // synchronous path (its flushOutput returns null).
      if (this.parserEngine.flushOutput) {
        this.scheduleRenderFlush()
      }
    },
  }

  private scheduleRenderFlush(): void {
    if (this.renderFlushScheduled) {
      return
    }

    this.renderFlushScheduled = true

    const flush = (): void => {
      this.renderFlushScheduled = false
      this.renderFlushHandle = null
      this.flushRender()
    }

    if (typeof requestAnimationFrame === 'function') {
      this.renderFlushHandle = requestAnimationFrame(flush)
    } else {
      // Non-browser (tests): fall back to a microtask.
      queueMicrotask(flush)
    }
  }

  private cancelRenderFlush(): void {
    if (
      this.renderFlushHandle !== null &&
      typeof cancelAnimationFrame === 'function'
    ) {
      cancelAnimationFrame(this.renderFlushHandle)
    }

    this.renderFlushScheduled = false
    this.renderFlushHandle = null
  }

  private flushRender(): void {
    if (this.terminal.isDisposed()) {
      return
    }

    const output = this.parserEngine.flushOutput?.()

    if (output) {
      this.terminal.writeParsedOutput(output)
    }
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

  createInstance(): TerminalInstance {
    return {
      terminal: this.terminal,
      output: this.output,
      parser: this.parser,
      viewportReader: this.viewportReader,
      fitController: this.fitController,
      attachRenderer: (): TerminalRendererHandle => this.rendererHandle,
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
