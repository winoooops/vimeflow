// cspell:ignore ghostty libghostty
import type {
  GhosttyByteParserAdapter,
  GhosttyByteParserAdapterInput,
} from './ghosttyParserEngine'
import type { TerminalParserEngineOutput } from './terminalParserEngine'
import type { TerminalSize } from '../../types'

export interface GhosttyVtParserEffects {
  readonly onCwdChange: (uri: string) => void
}

export interface GhosttyVtParserDriver {
  /**
   * Consume raw PTY bytes. Feeds terminal state and fires effects synchronously;
   * the render output is produced by `flushOutput` so a burst of redraw chunks
   * coalesces into one render per animation frame.
   */
  writeBytes: (bytes: Uint8Array) => TerminalParserEngineOutput
  /**
   * Return the latest pending render output (the settled snapshot), or `null`
   * when nothing new should paint yet (no new bytes, or still inside an open
   * synchronized-output frame).
   */
  flushOutput?: () => TerminalParserEngineOutput | null
  reset?: () => void
  resize?: (size: TerminalSize) => void
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

  flushOutput(): TerminalParserEngineOutput | null {
    if (this.isDisposed) {
      return null
    }

    return this.driver.flushOutput?.() ?? null
  }

  reset(): void {
    if (this.isDisposed) {
      return
    }

    this.driver.reset?.()
  }

  resize(size: TerminalSize): void {
    if (this.isDisposed) {
      return
    }

    this.driver.resize?.(size)
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
