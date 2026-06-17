import type {
  TerminalOutputInputMode,
  TerminalOutputChunk,
  TerminalParser,
  TerminalParserOutputContext,
  TerminalRendererCapabilities,
} from '../../types'
import { TerminalControlSequenceParser } from './terminalControlParser'
import { TerminalOutputPayloadRouter } from './terminalOutputPayload'

export interface TerminalParserEngineOutput {
  readonly visibleText: string
}

export type TerminalParserEngineInputMode = TerminalOutputInputMode

export interface TerminalParserEngineOptions {
  readonly capabilities: TerminalRendererCapabilities
}

export interface TerminalParserEngine {
  readonly inputMode: TerminalParserEngineInputMode
  readonly capabilities: TerminalRendererCapabilities
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

export class TerminalControlSequenceParserEngine implements TerminalParserEngine {
  readonly capabilities: TerminalRendererCapabilities
  readonly parser = new TerminalControlSequenceParser()
  private readonly outputRouter: TerminalOutputPayloadRouter

  constructor(options: TerminalParserEngineOptions) {
    this.capabilities = options.capabilities
    this.outputRouter = new TerminalOutputPayloadRouter(options.capabilities)
  }

  get inputMode(): TerminalParserEngineInputMode {
    return this.capabilities.preferredOutputInputMode
  }

  parseText(
    text: string,
    output: TerminalParserOutputContext | null
  ): TerminalParserEngineOutput {
    return {
      visibleText: this.parser.transformOutput(text, output),
    }
  }

  parseOutput(chunk: TerminalOutputChunk): TerminalParserEngineOutput {
    const selection = this.outputRouter.read(chunk)

    return this.parseText(selection.text, outputContextFromChunk(chunk))
  }
}

export const createControlSequenceTerminalParserEngine = (
  options: TerminalParserEngineOptions
): TerminalParserEngine => new TerminalControlSequenceParserEngine(options)
