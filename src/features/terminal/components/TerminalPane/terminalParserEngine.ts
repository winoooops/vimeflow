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

export type TerminalParserEngineInputMode = 'text' | 'bytes'

export interface TerminalParserEngineOptions {
  readonly inputMode: TerminalParserEngineInputMode
}

export interface TerminalParserEngine {
  readonly inputMode: TerminalParserEngineInputMode
  readonly parser: TerminalParser
  parseText: (
    text: string,
    output: TerminalParserOutputContext | null
  ) => TerminalParserEngineOutput
  parseOutput: (chunk: TerminalOutputChunk) => TerminalParserEngineOutput
}

const outputContextFromChunk = (
  chunk: TerminalOutputChunk
): TerminalParserOutputContext => ({
  offsetStart: chunk.offsetStart,
  byteLen: chunk.byteLen,
  phase: chunk.phase,
})

const createOutputTextReader = (
  inputMode: TerminalParserEngineInputMode
): ((chunk: TerminalOutputChunk) => string) => {
  if (inputMode === 'text') {
    return (chunk): string => chunk.text
  }

  const decoder = new TerminalOutputPayloadDecoder()

  return (chunk): string => decoder.decode(chunk)
}

export const createControlSequenceTerminalParserEngine = (
  options: TerminalParserEngineOptions
): TerminalParserEngine => {
  const parser = new TerminalControlSequenceParser()
  const readOutputText = createOutputTextReader(options.inputMode)

  const parseText = (
    text: string,
    output: TerminalParserOutputContext | null
  ): TerminalParserEngineOutput => ({
    visibleText: parser.transformOutput(text, output),
  })

  return {
    inputMode: options.inputMode,
    parser,
    parseText,
    parseOutput: (chunk): TerminalParserEngineOutput =>
      parseText(readOutputText(chunk), outputContextFromChunk(chunk)),
  }
}

export const createTextControlSequenceTerminalParserEngine =
  (): TerminalParserEngine =>
    createControlSequenceTerminalParserEngine({ inputMode: 'text' })

export const createByteControlSequenceTerminalParserEngine =
  (): TerminalParserEngine =>
    createControlSequenceTerminalParserEngine({ inputMode: 'bytes' })
