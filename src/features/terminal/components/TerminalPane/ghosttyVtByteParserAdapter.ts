// cspell:ignore ghostty libghostty
import type {
  GhosttyByteParserAdapter,
  GhosttyByteParserAdapterInput,
} from './ghosttyParserEngine'
import type { TerminalParserEngineOutput } from './terminalParserEngine'

export interface GhosttyVtParserEffects {
  readonly onCwdChange: (uri: string) => void
}

export interface GhosttyVtParserDriver {
  /**
   * Consume raw PTY bytes and return renderer-delta output for the text surface.
   *
   * A full libghostty-vt terminal bridge should diff terminal/render state before
   * returning so callers do not append a whole-screen snapshot per chunk.
   */
  writeBytes: (bytes: Uint8Array) => TerminalParserEngineOutput
  reset?: () => void
  dispose?: () => void
}

export type GhosttyVtParserDriverFactory = (
  effects: GhosttyVtParserEffects
) => GhosttyVtParserDriver

export class GhosttyVtByteParserAdapter implements GhosttyByteParserAdapter {
  private readonly driver: GhosttyVtParserDriver
  private activeInput: GhosttyByteParserAdapterInput | null = null
  private isDisposed = false

  constructor(createDriver: GhosttyVtParserDriverFactory) {
    this.driver = createDriver({
      onCwdChange: (uri) => {
        this.emitCwdChange(uri)
      },
    })
  }

  parseBytes(input: GhosttyByteParserAdapterInput): TerminalParserEngineOutput {
    this.activeInput = input

    try {
      return this.driver.writeBytes(input.bytes)
    } finally {
      this.activeInput = null
    }
  }

  reset(): void {
    this.driver.reset?.()
  }

  dispose(): void {
    if (this.isDisposed) {
      return
    }

    this.isDisposed = true
    this.driver.dispose?.()
  }

  private emitCwdChange(uri: string): void {
    const input = this.activeInput

    if (!input) {
      return
    }

    input.emitEvent({
      type: 'cwd',
      source: 'osc7',
      uri,
      output: input.output,
    })
  }
}

export const createGhosttyVtByteParserAdapter = (
  createDriver: GhosttyVtParserDriverFactory
): GhosttyByteParserAdapter => new GhosttyVtByteParserAdapter(createDriver)
