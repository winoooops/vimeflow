// cspell:ignore ghostty
import type {
  TerminalOutputInputMode,
  TerminalOutputChunk,
  TerminalParser,
  TerminalParserEvent,
  TerminalParserOutputContext,
  TerminalRendererCapabilities,
  TerminalSize,
} from '../../types'
import { TerminalControlSequenceParser } from './terminalControlParser'
import {
  TerminalOutputPayloadRouter,
  type TerminalOutputPayloadSelection,
} from './terminalOutputPayload'
import type { TerminalDisplayDelta } from './terminalDisplayBuffer'

// Active terminal input modes that decide how a mouse wheel tick is forwarded
// to the PTY (VIM-223). Rides the render snapshot — no extra IPC. When the app
// tracks the mouse the surface forwards the wheel as encoded mouse-event bytes
// (SGR or X10); otherwise the wheel drives an engine-driven scroll.
export interface WheelForwardMode {
  readonly mouseTracking: boolean
  readonly sgrMouse: boolean
}

export interface TerminalParserEngineOutput {
  readonly visibleText: string
  readonly displayText?: string
  readonly displayDelta?: TerminalDisplayDelta
  // Styled scrollback for the surface's separate, STATIC history region. The
  // surface renders this once into its own buffer and leaves it alone, so the
  // per-frame viewport render never rebuilds history. Tri-state:
  //   undefined = unchanged (keep the current region)
  //   object    = replace the region with this history
  //   null      = clear the region (alt screen / no history)
  readonly scrollback?: { readonly displayText: string } | null
  // Active mouse/cursor input modes for wheel forwarding (VIM-223). The surface
  // caches this and consults it on every wheel event. See WheelForwardMode.
  readonly wheelForwardMode?: WheelForwardMode
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
  /**
   * Coalesced render flush. Engines that defer rendering (e.g. the native
   * render-state byte path, which feeds bytes per chunk but reads the snapshot
   * once per animation frame) return the latest pending render output here, or
   * `null` when there is nothing new to paint. Engines that render
   * synchronously from `parseOutput` return `null` (or omit this).
   */
  flushOutput?: () => TerminalParserEngineOutput | null
  hasPendingOutput?: () => boolean
  reset?: () => void
  resize?: (size: TerminalSize) => void
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

  reset(): void {
    this.parser.reset()
  }

  protected emitParserEvent(event: TerminalParserEvent): void {
    this.emittableParser.emitParserEvent(event)
  }
}

export const createControlSequenceTerminalParserEngine = (
  options: TerminalParserEngineOptions
): TerminalParserEngine => new TerminalControlSequenceParserEngine(options)
