import type {
  TerminalOutputInputMode,
  TerminalOutputChunk,
  TerminalParser,
  TerminalParserEvent,
  TerminalParserOutputContext,
  TerminalRendererCapabilities,
} from '../../types'
import { TerminalControlSequenceParser } from './terminalControlParser'
import {
  TerminalOutputPayloadRouter,
  type TerminalOutputPayloadSelection,
} from './terminalOutputPayload'
import type { TerminalDisplayDelta } from './terminalDisplayBuffer'

export interface TerminalParserEngineOutput {
  readonly visibleText: string
  readonly displayText?: string
  readonly displayDelta?: TerminalDisplayDelta
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
  readonly acceptsTextInput?: boolean
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

class EngineTerminalControlSequenceParser extends TerminalControlSequenceParser {
  emitParserEvent(event: TerminalParserEvent): void {
    this.emit(event)
  }
}

export class TerminalControlSequenceParserEngine implements TerminalParserEngine {
  readonly acceptsTextInput: boolean = true
  readonly capabilities: TerminalRendererCapabilities
  readonly parser: TerminalControlSequenceParser
  private readonly emittableParser: EngineTerminalControlSequenceParser
  private readonly outputRouter: TerminalOutputPayloadRouter

  constructor(options: TerminalParserEngineOptions) {
    this.capabilities = options.capabilities
    this.emittableParser = new EngineTerminalControlSequenceParser({
      consumeControlsWithoutSubscribers:
        options.consumeControlsWithoutSubscribers,
      preserveSgrStyles: options.preserveSgrStyles,
    })
    this.parser = this.emittableParser
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

  protected emitParserEvent(event: TerminalParserEvent): void {
    this.emittableParser.emitParserEvent(event)
  }
}

export const createControlSequenceTerminalParserEngine = (
  options: TerminalParserEngineOptions
): TerminalParserEngine => new TerminalControlSequenceParserEngine(options)
