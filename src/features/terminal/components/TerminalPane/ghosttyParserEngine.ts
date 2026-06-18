// cspell:ignore ghostty
import { GHOSTTY_TERMINAL_CAPABILITIES } from './terminalRendererCapabilities'
import {
  TerminalControlSequenceParserEngine,
  type TerminalParserEngine,
} from './terminalParserEngine'

export const GHOSTTY_PARSER_ENGINE_ID = 'ghostty-control-sequence-spike'

export interface GhosttyParserEngine extends TerminalParserEngine {
  readonly id: typeof GHOSTTY_PARSER_ENGINE_ID
}

export class GhosttyControlSequenceParserEngine
  extends TerminalControlSequenceParserEngine
  implements GhosttyParserEngine
{
  readonly id: typeof GHOSTTY_PARSER_ENGINE_ID = GHOSTTY_PARSER_ENGINE_ID

  constructor() {
    super({
      capabilities: GHOSTTY_TERMINAL_CAPABILITIES,
      consumeControlsWithoutSubscribers: true,
      preserveSgrStyles: true,
    })
  }
}

export const createGhosttyParserEngine = (): GhosttyParserEngine =>
  new GhosttyControlSequenceParserEngine()
