import { describe, expect, test, vi } from 'vitest'
import { TerminalControlSequenceParser } from './terminalControlParser'

describe('TerminalControlSequenceParser', () => {
  test('emits OSC 7 cwd events and strips them from visible output', () => {
    const parser = new TerminalControlSequenceParser()
    const handler = vi.fn()
    const output = { offsetStart: 12, byteLen: 48, phase: 'live' as const }

    parser.onEvent(handler)

    const visible = parser.transformOutput(
      'before \x1b]7;file://localhost/tmp/project\x07 after',
      output
    )

    expect(visible).toBe('before  after')
    expect(handler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/project',
      output,
    })
  })

  test('reassembles OSC 7 sequences split across output chunks', () => {
    const parser = new TerminalControlSequenceParser()
    const handler = vi.fn()
    const firstOutput = { offsetStart: 0, byteLen: 24, phase: 'live' as const }

    const secondOutput = {
      offsetStart: 24,
      byteLen: 20,
      phase: 'live' as const,
    }

    parser.onEvent(handler)

    expect(
      parser.transformOutput('before \x1b]7;file://local', firstOutput)
    ).toBe('before ')

    expect(
      parser.transformOutput('host/tmp/project\x07 after', secondOutput)
    ).toBe(' after')

    expect(handler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/project',
      output: secondOutput,
    })
  })

  test('passes through non-cwd OSC sequences', () => {
    const parser = new TerminalControlSequenceParser()
    const handler = vi.fn()

    parser.onEvent(handler)

    const visible = parser.transformOutput('a\x1b]0;title\x07b', null)

    expect(visible).toBe('a\x1b]0;title\x07b')
    expect(handler).not.toHaveBeenCalled()
  })

  test('passes through control sequences when there are no subscribers', () => {
    const parser = new TerminalControlSequenceParser()

    const visible = parser.transformOutput(
      '\x1b]7;file://localhost/tmp/project\x07',
      null
    )

    expect(visible).toBe('\x1b]7;file://localhost/tmp/project\x07')
  })
})
