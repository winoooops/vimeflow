import { describe, expect, test, vi } from 'vitest'
import {
  TerminalControlSequenceParser,
  getClearScreenSentinel,
  getCursorLeftSentinel,
  getCursorRightSentinel,
  getSgrStyleSentinel,
} from './terminalControlParser'

const ESC = '\x1b'
const SGR_FINAL = 'm'

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

  test('strips non-cwd OSC sequences from visible output', () => {
    const parser = new TerminalControlSequenceParser()
    const handler = vi.fn()

    parser.onEvent(handler)

    const visible = parser.transformOutput('a\x1b]0;title\x07b', null)

    expect(visible).toBe('ab')
    expect(handler).not.toHaveBeenCalled()
  })

  test('strips control sequences without subscribers when configured', () => {
    const parser = new TerminalControlSequenceParser({
      consumeControlsWithoutSubscribers: true,
    })

    const visible = parser.transformOutput(
      `a${ESC}]2;title\x07${ESC}[38;2;243;139;168${SGR_FINAL}b${ESC}=c`,
      null
    )

    expect(visible).toBe('abc')
  })

  test('strips CSI style sequences from visible output', () => {
    const parser = new TerminalControlSequenceParser()
    const handler = vi.fn()

    parser.onEvent(handler)

    const visible = parser.transformOutput(
      `prompt ${ESC}[38;2;243;139;168${SGR_FINAL}` +
        `branch${ESC}[0${SGR_FINAL} done`,
      null
    )

    expect(visible).toBe('prompt branch done')
    expect(handler).not.toHaveBeenCalled()
  })

  test('preserves CSI style sequences as display-only sentinels when configured', () => {
    const parser = new TerminalControlSequenceParser({
      consumeControlsWithoutSubscribers: true,
      preserveSgrStyles: true,
    })

    const output = parser.transformDisplayOutput(
      `prompt ${ESC}[38;2;243;139;168${SGR_FINAL}` +
        `branch${ESC}[1;4${SGR_FINAL}!${ESC}[0${SGR_FINAL} done`,
      null
    )

    expect(output.visibleText).toBe('prompt branch! done')
    expect(output.displayText).toBe(
      `prompt ${getSgrStyleSentinel([38, 2, 243, 139, 168])}` +
        `branch${getSgrStyleSentinel([1, 4])}!` +
        `${getSgrStyleSentinel([0])} done`
    )
  })

  test('strips short ESC mode controls from visible output', () => {
    const parser = new TerminalControlSequenceParser()
    const handler = vi.fn()

    parser.onEvent(handler)

    const visible = parser.transformOutput(
      `prompt ${ESC}=application ${ESC}>normal`,
      null
    )

    expect(visible).toBe('prompt application normal')
    expect(handler).not.toHaveBeenCalled()
  })

  test('strips ESC charset designation controls from visible output', () => {
    const parser = new TerminalControlSequenceParser()
    const handler = vi.fn()

    parser.onEvent(handler)

    const charsetControl = `${ESC}(B`

    const visible = parser.transformOutput(
      `before ${charsetControl}after`,
      null
    )

    expect(visible).toBe('before after')
    expect(handler).not.toHaveBeenCalled()
  })

  test('preserves clear-screen and cursor movement controls as display sentinels', () => {
    const parser = new TerminalControlSequenceParser()
    const handler = vi.fn()

    parser.onEvent(handler)

    const visible = parser.transformOutput(
      `old${ESC}[2J` + `abc${ESC}[2DXY${ESC}[Cz${ESC}[3G!`,
      null
    )

    expect(visible).toBe(
      `old${getClearScreenSentinel()}abc` +
        `${getCursorLeftSentinel()}${getCursorLeftSentinel()}` +
        `XY${getCursorRightSentinel()}z` +
        `\r${getCursorRightSentinel()}${getCursorRightSentinel()}!`
    )
    expect(handler).not.toHaveBeenCalled()
  })

  test('treats explicit zero cursor movement counts as the default of one', () => {
    const parser = new TerminalControlSequenceParser()
    const handler = vi.fn()

    parser.onEvent(handler)

    const visible = parser.transformOutput(
      `abc${ESC}[0DXY${ESC}[0Cz${ESC}[0G!`,
      null
    )

    expect(visible).toBe(
      `abc${getCursorLeftSentinel()}` + `XY${getCursorRightSentinel()}z` + `\r!`
    )
    expect(handler).not.toHaveBeenCalled()
  })

  test('reassembles short ESC controls split across output chunks', () => {
    const parser = new TerminalControlSequenceParser()
    const handler = vi.fn()

    parser.onEvent(handler)

    expect(parser.transformOutput('before \x1b', null)).toBe('before ')
    expect(parser.transformOutput('=after', null)).toBe('after')
    expect(handler).not.toHaveBeenCalled()
  })

  test('reassembles CSI sequences split across output chunks', () => {
    const parser = new TerminalControlSequenceParser()
    const handler = vi.fn()

    parser.onEvent(handler)

    expect(parser.transformOutput('before \x1b[38;2;', null)).toBe('before ')
    expect(parser.transformOutput('243;139;168m' + 'color', null)).toBe('color')
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

  test('keeps a trailing ESC pending until the next chunk completes the sequence', () => {
    const parser = new TerminalControlSequenceParser()
    const handler = vi.fn()

    parser.onEvent(handler)

    expect(parser.transformOutput('before \x1b', null)).toBe('before ')
    // cspell:disable-next-line
    expect(parser.transformOutput('[38;2;243;139;168mcolor', null)).toBe(
      'color'
    )
    expect(handler).not.toHaveBeenCalled()
  })
})
