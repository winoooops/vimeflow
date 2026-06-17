// cspell:ignore ghostty
import type {
  TerminalInstance,
  TerminalRendererAdapter,
  TerminalRendererCapabilities,
  TerminalRendererHandle,
  TerminalOutputWriter,
} from '../../types'
import { createPlainTextTerminal } from './plainTextInstance'
import { GHOSTTY_TERMINAL_RENDERER_ID } from './ghosttyRendererMetadata'
import {
  createControlSequenceTerminalParserEngine,
  type TerminalParserEngine,
} from './terminalParserEngine'

export { GHOSTTY_TERMINAL_RENDERER_ID } from './ghosttyRendererMetadata'

const GHOSTTY_TERMINAL_CAPABILITIES: TerminalRendererCapabilities = {
  preferredOutputInputMode: 'bytes',
  acceptsText: true,
  acceptsBytes: true,
}

export interface GhosttyTerminalOptions {
  readonly createParserEngine?: (
    capabilities: TerminalRendererCapabilities
  ) => TerminalParserEngine
}

class GhosttyTerminalModel {
  private readonly base = createPlainTextTerminal()
  private readonly parserEngine: TerminalParserEngine

  constructor(options: GhosttyTerminalOptions = {}) {
    this.parserEngine =
      options.createParserEngine?.(GHOSTTY_TERMINAL_CAPABILITIES) ??
      createControlSequenceTerminalParserEngine({
        capabilities: GHOSTTY_TERMINAL_CAPABILITIES,
      })
  }

  readonly output: TerminalOutputWriter = {
    writeOutput: (chunk, callback): void => {
      const { visibleText } = this.parserEngine.parseOutput(chunk)

      this.base.terminal.write(visibleText, callback)
    },
  }

  createInstance(): TerminalInstance {
    if (this.base.terminal.element) {
      this.base.terminal.element.dataset.terminalRenderer =
        GHOSTTY_TERMINAL_RENDERER_ID
    }

    return {
      terminal: this.base.terminal,
      output: this.output,
      parser: this.parserEngine.parser,
      viewportReader: this.base.viewportReader,
      fitController: this.base.fitController,
      attachRenderer: (): TerminalRendererHandle => this.base.attachRenderer(),
    }
  }
}

export const createGhosttyTerminal = (
  options: GhosttyTerminalOptions = {}
): TerminalInstance => new GhosttyTerminalModel(options).createInstance()

export const ghosttyTerminalRenderer: TerminalRendererAdapter = {
  id: GHOSTTY_TERMINAL_RENDERER_ID,
  capabilities: GHOSTTY_TERMINAL_CAPABILITIES,
  createInstance: createGhosttyTerminal,
}
