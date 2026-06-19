// cspell:ignore ghostty
import type {
  TerminalParserEvent,
  TerminalParserOutputContext,
} from '../../types'
import { GHOSTTY_TERMINAL_CAPABILITIES } from './terminalRendererCapabilities'
import {
  TerminalControlSequenceParserEngine,
  type TerminalParserEngine,
  type TerminalParserEngineInput,
  type TerminalParserEngineOutput,
} from './terminalParserEngine'

export const GHOSTTY_PARSER_ENGINE_ID = 'ghostty-control-sequence-spike'

export interface GhosttyByteParserAdapterInput {
  readonly bytes: Uint8Array
  readonly decodedText: string
  readonly output: TerminalParserOutputContext | null
  readonly emitEvent: (event: TerminalParserEvent) => void
}

export interface GhosttyByteParserAdapter {
  parseBytes: (
    input: GhosttyByteParserAdapterInput
  ) => TerminalParserEngineOutput
  reset?: () => void
  dispose?: () => void
}

export interface GhosttyParserEngineOptions {
  readonly byteParserAdapter?: GhosttyByteParserAdapter
}

export interface GhosttyParserEngine extends TerminalParserEngine {
  readonly id: typeof GHOSTTY_PARSER_ENGINE_ID
}

class ControlSequenceGhosttyByteParserAdapter implements GhosttyByteParserAdapter {
  private readonly decoder = new TextDecoder()

  constructor(
    private readonly parseText: (
      text: string,
      output: TerminalParserOutputContext | null
    ) => TerminalParserEngineOutput
  ) {}

  parseBytes(input: GhosttyByteParserAdapterInput): TerminalParserEngineOutput {
    return this.parseText(
      this.decoder.decode(input.bytes, { stream: true }),
      input.output
    )
  }

  reset(): void {
    this.decoder.decode()
  }
}

export class GhosttyControlSequenceParserEngine
  extends TerminalControlSequenceParserEngine
  implements GhosttyParserEngine
{
  readonly id: typeof GHOSTTY_PARSER_ENGINE_ID = GHOSTTY_PARSER_ENGINE_ID
  private readonly byteParserAdapter: GhosttyByteParserAdapter
  private isDisposed = false

  constructor(options: GhosttyParserEngineOptions = {}) {
    super({
      capabilities: GHOSTTY_TERMINAL_CAPABILITIES,
      consumeControlsWithoutSubscribers: true,
      preserveSgrStyles: true,
    })

    this.byteParserAdapter =
      options.byteParserAdapter ??
      new ControlSequenceGhosttyByteParserAdapter((text, output) =>
        this.parseText(text, output)
      )
  }

  parseInput(input: TerminalParserEngineInput): TerminalParserEngineOutput {
    if (input.inputMode === 'bytes') {
      return this.byteParserAdapter.parseBytes({
        bytes: input.bytes,
        decodedText: input.text,
        output: input.output,
        emitEvent: (event) => {
          this.parser.emitEvent(event)
        },
      })
    }

    this.byteParserAdapter.reset?.()

    return super.parseInput(input)
  }

  dispose(): void {
    if (this.isDisposed) {
      return
    }

    this.isDisposed = true
    this.byteParserAdapter.dispose?.()
  }
}

export const createGhosttyParserEngine = (
  options?: GhosttyParserEngineOptions
): GhosttyParserEngine => new GhosttyControlSequenceParserEngine(options)
