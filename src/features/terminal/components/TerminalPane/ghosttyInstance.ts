// cspell:ignore ghostty
import type {
  TerminalInstance,
  TerminalOutputChunk,
  TerminalParserOutputContext,
  TerminalRendererAdapter,
  TerminalRendererHandle,
  TerminalOutputWriter,
} from '../../types'
import { createPlainTextTerminal } from './plainTextInstance'
import { GHOSTTY_TERMINAL_RENDERER_ID } from './ghosttyRendererMetadata'
import { TerminalControlSequenceParser } from './terminalControlParser'
import { TerminalOutputPayloadDecoder } from './terminalOutputPayload'

export { GHOSTTY_TERMINAL_RENDERER_ID } from './ghosttyRendererMetadata'

const outputContextFromChunk = (
  chunk: TerminalOutputChunk
): TerminalParserOutputContext => ({
  offsetStart: chunk.offsetStart,
  byteLen: chunk.byteLen,
  phase: chunk.phase,
})

class GhosttyTerminalModel {
  private readonly base = createPlainTextTerminal()
  private readonly parser = new TerminalControlSequenceParser()
  private readonly decoder = new TerminalOutputPayloadDecoder()

  readonly output: TerminalOutputWriter = {
    writeOutput: (chunk, callback): void => {
      const text = this.decoder.decode(chunk)

      const visibleText = this.parser.transformOutput(
        text,
        outputContextFromChunk(chunk)
      )

      this.base.terminal.write(visibleText, callback)
    },
  }

  createInstance(): TerminalInstance {
    if (this.base.terminal.element) {
      this.base.terminal.element.dataset.terminalRenderer =
        GHOSTTY_TERMINAL_RENDERER_ID
    }

    return {
      terminal: this.base.terminal,
      output: this.output,
      parser: this.parser,
      viewportReader: this.base.viewportReader,
      fitController: this.base.fitController,
      attachRenderer: (): TerminalRendererHandle => this.base.attachRenderer(),
    }
  }
}

export const createGhosttyTerminal = (): TerminalInstance =>
  new GhosttyTerminalModel().createInstance()

export const ghosttyTerminalRenderer: TerminalRendererAdapter = {
  id: GHOSTTY_TERMINAL_RENDERER_ID,
  createInstance: createGhosttyTerminal,
}
