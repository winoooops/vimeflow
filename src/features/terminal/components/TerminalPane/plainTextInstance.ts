import type {
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
    consumeControlsWithoutSubscribers: true,
  })
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
      // The plain-text surface has no renderer addon lifecycle.
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
