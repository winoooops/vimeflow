import type {
  TerminalOutputInputMode,
  TerminalOutputChunk,
  TerminalParser,
  TerminalParserOutputContext,
  TerminalRendererCapabilities,
} from '../../types'
import { TerminalControlSequenceParser } from './terminalControlParser'
import {
  TerminalOutputPayloadRouter,
  type TerminalOutputPayloadSelection,
} from './terminalOutputPayload'

export interface TerminalParserEngineOutput {
  readonly visibleText: string
  readonly displayText?: string
}

export type TerminalParserEngineInputMode = TerminalOutputInputMode

export type TerminalParserEngineInput = TerminalOutputPayloadSelection & {
  readonly output: TerminalParserOutputContext | null
}

export interface TerminalParserEngineOptions {
  readonly capabilities: TerminalRendererCapabilities
  readonly consumeControlsWithoutSubscribers?: boolean
  readonly preserveSgrStyles?: boolean
}

export interface TerminalParserEngine {
  readonly inputMode: TerminalParserEngineInputMode
  readonly capabilities: TerminalRendererCapabilities
  readonly parser: TerminalParser
  parseText: (
    text: string,
    output: TerminalParserOutputContext | null
  ) => TerminalParserEngineOutput
  parseInput: (input: TerminalParserEngineInput) => TerminalParserEngineOutput
  parseOutput: (chunk: TerminalOutputChunk) => TerminalParserEngineOutput
  dispose?: () => void
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
  readonly parser: TerminalControlSequenceParser
  private readonly outputRouter: TerminalOutputPayloadRouter

  constructor(options: TerminalParserEngineOptions) {
    this.capabilities = options.capabilities
    this.parser = new TerminalControlSequenceParser({
      consumeControlsWithoutSubscribers:
        options.consumeControlsWithoutSubscribers,
      preserveSgrStyles: options.preserveSgrStyles,
    })
    this.outputRouter = new TerminalOutputPayloadRouter(options.capabilities)
  }

  get inputMode(): TerminalParserEngineInputMode {
    return this.capabilities.preferredOutputInputMode
  }

  parseText(
    text: string,
    output: TerminalParserOutputContext | null
  ): TerminalParserEngineOutput {
    return this.parser.transformDisplayOutput(text, output)
  }

  parseInput(input: TerminalParserEngineInput): TerminalParserEngineOutput {
    return this.parseText(input.text, input.output)
  }

  parseOutput(chunk: TerminalOutputChunk): TerminalParserEngineOutput {
    const selection = this.outputRouter.read(chunk)

    return this.parseInput({
      ...selection,
      output: outputContextFromChunk(chunk),
    })
  }
}

export const createControlSequenceTerminalParserEngine = (
  options: TerminalParserEngineOptions
): TerminalParserEngine => new TerminalControlSequenceParserEngine(options)
