// cspell:ignore ghostty
import type {
  TerminalParserEvent,
  TerminalParserOutputContext,
  TerminalSize,
} from '../../types'
import { GHOSTTY_TERMINAL_CAPABILITIES } from './terminalRendererCapabilities'
import {
  TerminalControlSequenceParserEngine,
  type TerminalParserEngine,
  type TerminalParserEngineInput,
  type TerminalParserEngineOutput,
} from './terminalParserEngine'
import { createGhosttyVtRenderSnapshotOutput } from './ghosttyVtRenderSnapshot'
import type { TerminalOutputChunk } from '../../types'

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
  resize?: (size: TerminalSize) => void
  dispose?: () => void
}

export interface GhosttyParserEngineOptions {
  readonly byteParserAdapter?: GhosttyByteParserAdapter
  readonly byteOnly?: boolean
}

export interface GhosttyParserEngine extends TerminalParserEngine {
  readonly id: typeof GHOSTTY_PARSER_ENGINE_ID
}

const outputContextFromChunk = (
  chunk: TerminalOutputChunk
): TerminalParserOutputContext => ({
  offsetStart: chunk.offsetStart,
  byteLen: chunk.byteLen,
  phase: chunk.phase,
})

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
  readonly acceptsTextInput: boolean
  private readonly byteParserAdapter: GhosttyByteParserAdapter
  private readonly byteOnly: boolean
  private isDisposed = false

  constructor(options: GhosttyParserEngineOptions = {}) {
    super({
      capabilities: GHOSTTY_TERMINAL_CAPABILITIES,
      consumeControlsWithoutSubscribers: true,
      preserveSgrStyles: true,
    })

    this.byteOnly = options.byteOnly ?? false
    this.acceptsTextInput = !this.byteOnly

    if (this.byteOnly && !options.byteParserAdapter) {
      throw new Error(
        'Ghostty parser engine byteOnly mode requires a byteParserAdapter'
      )
    }

    this.byteParserAdapter =
      options.byteParserAdapter ??
      new ControlSequenceGhosttyByteParserAdapter((text, output) =>
        this.parseText(text, output)
      )
  }

  parseText(
    text: string,
    output: TerminalParserOutputContext | null
  ): TerminalParserEngineOutput {
    if (this.byteOnly) {
      throw new Error(
        'Ghostty VT render-state parser engine does not accept text input; use byte output chunks'
      )
    }

    return super.parseText(text, output)
  }

  parseInput(input: TerminalParserEngineInput): TerminalParserEngineOutput {
    if (input.inputMode === 'bytes') {
      return this.byteParserAdapter.parseBytes({
        bytes: input.bytes,
        decodedText: input.text,
        output: input.output,
        emitEvent: (event) => {
          this.emitParserEvent(event)
        },
      })
    }

    if (this.byteOnly) {
      throw new Error(
        'Ghostty VT render-state parser engine does not accept text input; use byte output chunks'
      )
    }

    this.byteParserAdapter.reset?.()

    return super.parseInput(input)
  }

  parseOutput(chunk: TerminalOutputChunk): TerminalParserEngineOutput {
    if (chunk.ghosttySnapshot !== undefined) {
      if (chunk.ghosttyCwdUri !== undefined) {
        this.emitParserEvent({
          type: 'cwd',
          source: 'osc7',
          uri: chunk.ghosttyCwdUri,
          output: outputContextFromChunk(chunk),
        })
      }

      return createGhosttyVtRenderSnapshotOutput(chunk.ghosttySnapshot)
    }

    return super.parseOutput(chunk)
  }

  reset(): void {
    if (this.isDisposed) {
      return
    }

    super.reset()
    this.byteParserAdapter.reset?.()
  }

  resize(size: TerminalSize): void {
    if (this.isDisposed) {
      return
    }

    this.byteParserAdapter.resize?.(size)
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
