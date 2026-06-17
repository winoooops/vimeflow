// cspell:ignore ghostty
import type {
  TerminalDisposable,
  TerminalFitController,
  TerminalInstance,
  TerminalRendererAdapter,
  TerminalRendererHandle,
  TerminalOutputWriter,
  TerminalParser,
  TerminalViewportReader,
} from '../../types'
import { GHOSTTY_TERMINAL_RENDERER_ID } from './ghosttyRendererMetadata'
import { createGhosttyParserEngine } from './ghosttyParserEngine'
import type { TerminalParserEngine } from './terminalParserEngine'
import { GHOSTTY_TERMINAL_CAPABILITIES } from './terminalRendererCapabilities'
import { TerminalTextSurface } from './terminalTextSurface'

export { GHOSTTY_TERMINAL_RENDERER_ID } from './ghosttyRendererMetadata'

export interface GhosttyTerminalOptions {
  readonly createParserEngine?: () => TerminalParserEngine
}

class GhosttyTerminalModel {
  private readonly parserEngine: TerminalParserEngine
  private readonly noOpParserDisposable: TerminalDisposable
  readonly terminal: TerminalTextSurface
  readonly parser: TerminalParser

  constructor(options: GhosttyTerminalOptions = {}) {
    this.parserEngine =
      options.createParserEngine?.() ?? createGhosttyParserEngine()
    this.parser = this.parserEngine.parser

    this.terminal = new TerminalTextSurface({
      rendererId: GHOSTTY_TERMINAL_RENDERER_ID,
      transformOutput: (data): string =>
        this.parserEngine.parseText(data, null).visibleText,
    })

    // The Ghostty spike relies on the adapter parser stripping control
    // sequences from the viewport even before app code subscribes to events.
    this.noOpParserDisposable = this.parserEngine.parser.onEvent(() => {
      // Intentionally empty: app-facing consumers subscribe separately through
      // the exposed parser, while the surface consumes parsed visible text.
    })
  }

  readonly output: TerminalOutputWriter = {
    writeOutput: (chunk, callback): void => {
      if (this.terminal.isDisposed()) {
        callback?.()

        return
      }

      const { visibleText } = this.parserEngine.parseOutput(chunk)

      this.terminal.writeVisible(visibleText, callback)
    },
  }

  readonly viewportReader: TerminalViewportReader = {
    readVisibleText: (): string => this.terminal.readVisibleText(),
  }

  readonly fitController: TerminalFitController = {
    fit: (): void => {
      this.terminal.fit()
    },
  }

  readonly rendererHandle: TerminalRendererHandle = {
    dispose: (): void => {
      this.noOpParserDisposable.dispose()
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
}

export const createGhosttyTerminal = (
  options: GhosttyTerminalOptions = {}
): TerminalInstance => new GhosttyTerminalModel(options).createInstance()

export const ghosttyTerminalRenderer: TerminalRendererAdapter = {
  id: GHOSTTY_TERMINAL_RENDERER_ID,
  capabilities: GHOSTTY_TERMINAL_CAPABILITIES,
  createInstance: createGhosttyTerminal,
}
