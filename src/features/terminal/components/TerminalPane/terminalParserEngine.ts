import type {
  TerminalOutputChunk,
  TerminalParser,
  TerminalParserOutputContext,
} from '../../types'
import { TerminalControlSequenceParser } from './terminalControlParser'
import { TerminalOutputPayloadDecoder } from './terminalOutputPayload'

export interface TerminalParserEngineOutput {
  readonly visibleText: string
}

export interface TerminalParserEngine {
  readonly parser: TerminalParser
  parseOutput: (chunk: TerminalOutputChunk) => TerminalParserEngineOutput
}

const outputContextFromChunk = (
  chunk: TerminalOutputChunk
): TerminalParserOutputContext => ({
  offsetStart: chunk.offsetStart,
  byteLen: chunk.byteLen,
  phase: chunk.phase,
})

export const createControlSequenceTerminalParserEngine =
  (): TerminalParserEngine => {
    const parser = new TerminalControlSequenceParser()
    const decoder = new TerminalOutputPayloadDecoder()

    return {
      parser,
      parseOutput: (chunk): TerminalParserEngineOutput => {
        const text = decoder.decode(chunk)

        return {
          visibleText: parser.transformOutput(
            text,
            outputContextFromChunk(chunk)
          ),
        }
      },
    }
  }
