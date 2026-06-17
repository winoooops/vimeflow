import type {
  TerminalDisposable,
  TerminalFitController,
  TerminalInstance,
  TerminalOutputWriter,
  TerminalParser,
  TerminalRendererAdapter,
  TerminalRendererHandle,
  TerminalViewportReader,
} from '../../types'
import { PLAIN_TEXT_TERMINAL_RENDERER_ID } from './plainTextRendererMetadata'
import { createControlSequenceTerminalParserEngine } from './terminalParserEngine'
import { PLAIN_TEXT_TERMINAL_CAPABILITIES } from './terminalRendererCapabilities'
import { TerminalTextSurface } from './terminalTextSurface'

export { PLAIN_TEXT_TERMINAL_RENDERER_ID } from './plainTextRendererMetadata'

class PlainTextTerminalModel {
  private readonly parserEngine = createControlSequenceTerminalParserEngine({
    capabilities: PLAIN_TEXT_TERMINAL_CAPABILITIES,
  })
  private readonly noOpParserDisposable: TerminalDisposable
  readonly terminal = new TerminalTextSurface({
    rendererId: PLAIN_TEXT_TERMINAL_RENDERER_ID,
    transformOutput: (data): string =>
      this.parserEngine.parseText(data, null).visibleText,
  })

  readonly parser: TerminalParser = this.parserEngine.parser

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

  constructor() {
    // The plain-text renderer relies on the parser stripping control sequences
    // (and replacing erase-line sequences with sentinels). Subscribing a no-op
    // handler keeps the parser in stripping mode even when no external consumer
    // is listening.
    this.noOpParserDisposable = this.parserEngine.parser.onEvent(() => {
      // Intentionally empty: visible-text transformation is handled by the
      // parser, and erase-line sentinels are interpreted by the surface.
    })
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
}

export const createPlainTextTerminal = (): TerminalInstance => {
  const model = new PlainTextTerminalModel()

  return {
    terminal: model.terminal,
    output: model.output,
    parser: model.parser,
    viewportReader: model.viewportReader,
    fitController: model.fitController,
    attachRenderer: (): TerminalRendererHandle => model.rendererHandle,
  }
}

export const plainTextTerminalRenderer: TerminalRendererAdapter = {
  id: PLAIN_TEXT_TERMINAL_RENDERER_ID,
  capabilities: PLAIN_TEXT_TERMINAL_CAPABILITIES,
  createInstance: createPlainTextTerminal,
}
