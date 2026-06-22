/* eslint-disable vimeflow/no-hardcoded-colors -- this suite exercises hex→OSC color conversion, so literal colors are the inputs/outputs under test */
// cspell:ignore cdcd
import { describe, expect, test } from 'vitest'
import {
  formatTerminalColorResponse,
  hexToOscColor,
  scanTerminalColorQueries,
  scanTerminalColorQueriesWithCarry,
} from './terminalColorQuery'

describe('scanTerminalColorQueries', () => {
  test('detects OSC 11 (background) and OSC 10 (foreground) with ST terminator', () => {
    // exactly what Codex emits at startup (see capture)
    const data = '\x1b]10;?\x1b\\\x1b]11;?\x1b\\'

    expect(scanTerminalColorQueries(data)).toEqual(['foreground', 'background'])
  })

  test('detects queries terminated by BEL', () => {
    expect(scanTerminalColorQueries('\x1b]11;?\x07')).toEqual(['background'])
  })

  test('ignores OSC color SET sequences (only answers queries)', () => {
    // setting a color (not a "?" query) must not trigger a response
    expect(
      scanTerminalColorQueries('\x1b]11;rgb:1e1e/1e1e/2e2e\x1b\\')
    ).toEqual([])
  })

  test('returns nothing for unrelated output', () => {
    expect(
      scanTerminalColorQueries('regular output, no osc query here')
    ).toEqual([])
  })

  test('detects a query split before the ST terminator', () => {
    const first = scanTerminalColorQueriesWithCarry('\x1b]11;?', '')
    expect(first.targets).toEqual([])

    const second = scanTerminalColorQueriesWithCarry('\x1b\\', first.carry)
    expect(second.targets).toEqual(['background'])
  })

  test('detects a query split before the BEL terminator', () => {
    const first = scanTerminalColorQueriesWithCarry('\x1b]10;?', '')
    expect(first.targets).toEqual([])

    const second = scanTerminalColorQueriesWithCarry('\x07', first.carry)
    expect(second.targets).toEqual(['foreground'])
  })

  test('does not repeat a completed trailing query on the next scan', () => {
    const first = scanTerminalColorQueriesWithCarry('\x1b]11;?\x07', '')
    expect(first.targets).toEqual(['background'])

    const second = scanTerminalColorQueriesWithCarry(
      'regular output',
      first.carry
    )
    expect(second.targets).toEqual([])
  })
})

describe('hexToOscColor', () => {
  test('expands 8-bit hex channels to the 16-bit OSC color form', () => {
    expect(hexToOscColor('#1e1e2e')).toBe('rgb:1e1e/1e1e/2e2e')
    expect(hexToOscColor('cdd6f4')).toBe('rgb:cdcd/d6d6/f4f4')
  })

  test('rejects non-hex / partial colors', () => {
    expect(hexToOscColor('rgb(30,30,46)')).toBeNull()
    expect(hexToOscColor('#fff')).toBeNull()
    expect(hexToOscColor('')).toBeNull()
  })
})

describe('formatTerminalColorResponse', () => {
  test('builds the OSC 11 background report Codex needs to draw its composer bar', () => {
    expect(formatTerminalColorResponse('background', '#1e1e2e')).toBe(
      '\x1b]11;rgb:1e1e/1e1e/2e2e\x1b\\'
    )
  })

  test('builds the OSC 10 foreground report', () => {
    expect(formatTerminalColorResponse('foreground', '#cdd6f4')).toBe(
      '\x1b]10;rgb:cdcd/d6d6/f4f4\x1b\\'
    )
  })

  test('returns null when the color is unusable', () => {
    expect(formatTerminalColorResponse('background', 'transparent')).toBeNull()
  })
})
