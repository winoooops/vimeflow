// cspell:ignore ghostty
import { describe, expect, test } from 'vitest'
import {
  GHOSTTY_TERMINAL_CAPABILITIES,
  PLAIN_TEXT_TERMINAL_CAPABILITIES,
  XTERM_TERMINAL_CAPABILITIES,
} from './terminalRendererCapabilities'

describe('terminalRendererCapabilities', () => {
  test('keeps xterm and plain text on the text output path', () => {
    expect(XTERM_TERMINAL_CAPABILITIES).toEqual({
      preferredOutputInputMode: 'text',
      acceptsText: true,
      acceptsBytes: false,
    })

    expect(PLAIN_TEXT_TERMINAL_CAPABILITIES).toEqual({
      preferredOutputInputMode: 'text',
      acceptsText: true,
      acceptsBytes: false,
    })
  })

  test('keeps the Ghostty spike on the byte-preferring output path', () => {
    expect(GHOSTTY_TERMINAL_CAPABILITIES).toEqual({
      preferredOutputInputMode: 'bytes',
      acceptsText: true,
      acceptsBytes: true,
    })
  })
})
