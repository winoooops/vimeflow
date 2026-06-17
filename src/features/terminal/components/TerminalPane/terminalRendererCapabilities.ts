// cspell:ignore ghostty
import type { TerminalRendererCapabilities } from '../../types'

export const XTERM_TERMINAL_CAPABILITIES = {
  preferredOutputInputMode: 'text',
  acceptsText: true,
  acceptsBytes: false,
} as const satisfies TerminalRendererCapabilities

export const PLAIN_TEXT_TERMINAL_CAPABILITIES = {
  preferredOutputInputMode: 'text',
  acceptsText: true,
  acceptsBytes: false,
} as const satisfies TerminalRendererCapabilities

export const GHOSTTY_TERMINAL_CAPABILITIES = {
  preferredOutputInputMode: 'bytes',
  acceptsText: true,
  acceptsBytes: true,
} as const satisfies TerminalRendererCapabilities
