import { describe, expect, test, vi } from 'vitest'
import {
  emitTerminalAttention,
  isProgressOsc9Payload,
  subscribeTerminalAttention,
  TerminalAttentionScanner,
} from './notifications'

describe('terminal notifications', () => {
  test('normalizes the same signal for both terminal providers', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeTerminalAttention(listener)

    emitTerminalAttention({ ptyId: 'pty-1', body: 'done' })
    unsubscribe()
    emitTerminalAttention({ ptyId: 'pty-2' })

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith({ ptyId: 'pty-1', body: 'done' })
  })

  test('bounds and strips control characters from terminal payloads', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeTerminalAttention(listener)

    emitTerminalAttention({
      ptyId: 'pty-1',
      body: `\x00 ready\n${'x'.repeat(600)}`,
    })
    unsubscribe()

    expect(listener).toHaveBeenCalledWith({
      ptyId: 'pty-1',
      body: `ready${'x'.repeat(495)}`,
    })
  })

  test('finds bell and split OSC 9/777 while ignoring OSC 7', () => {
    const scanner = new TerminalAttentionScanner()

    expect(scanner.push('before\x07after')).toEqual([''])
    expect(scanner.push('\x1b]9;build ')).toEqual([])
    expect(scanner.push('done\x07')).toEqual(['build done'])
    expect(scanner.push('\x1b]777;notify;title;body\x1b\\')).toEqual([
      'notify;title;body',
    ])
    expect(scanner.push('\x1b]7;file:///tmp\x07')).toEqual([])
  })

  test('reserves only the exact OSC 9 progress namespace', () => {
    expect(isProgressOsc9Payload('4;3')).toBe(true)
    expect(isProgressOsc9Payload('4;1;42')).toBe(true)
    expect(isProgressOsc9Payload('4;9;garbage')).toBe(true)
    expect(isProgressOsc9Payload('4')).toBe(false)
    expect(isProgressOsc9Payload('40;3')).toBe(false)
  })

  test('suppresses reserved progress with BEL or ST at every split boundary', () => {
    for (const frame of ['\x1b]9;4;1;42\x07', '\x1b]9;4;3\x1b\\']) {
      for (let split = 0; split <= frame.length; split += 1) {
        const scanner = new TerminalAttentionScanner()
        expect([
          ...scanner.push(frame.slice(0, split)),
          ...scanner.push(frame.slice(split)),
        ]).toEqual([])
      }
    }
  })

  test('suppresses malformed reserved progress but preserves ordinary attention', () => {
    const scanner = new TerminalAttentionScanner()

    expect(scanner.push('\x1b]9;4;9;garbage\x07')).toEqual([])
    expect(scanner.push('\x1b]9;4\x07')).toEqual(['4'])
    expect(scanner.push('\x1b]9;build done\x07')).toEqual(['build done'])
    expect(scanner.push('\x1b]777;notify\x1b\\')).toEqual(['notify'])
    expect(scanner.push('\x07')).toEqual([''])
  })

  test('recovers from an unterminated OSC at the next escape sequence', () => {
    const scanner = new TerminalAttentionScanner()

    expect(scanner.push('\x1b]9;lost\x1b')).toEqual([])
    expect(scanner.push(']9;build done\x07')).toEqual(['build done'])
    expect(scanner.push('\x1b]9;lost\x1b')).toEqual([])
    expect(scanner.push('[31m\x1b]777;notify\x1b\\')).toEqual(['notify'])
  })

  test('oversized non-progress OSC consumes its later terminator', () => {
    for (const [suffix, terminator] of [
      ['', '\x07'],
      ['\x1b', '\\'],
    ]) {
      const scanner = new TerminalAttentionScanner()

      expect(scanner.push(`\x1b]777;${'x'.repeat(5000)}${suffix}`)).toEqual([])
      expect(scanner.push(terminator)).toEqual([])
      expect(scanner.push('\x07')).toEqual([''])
    }
  })

  test('oversized reserved progress discards through its later terminator', () => {
    const stScanner = new TerminalAttentionScanner()

    expect(stScanner.push(`\x1b]9;4;1;${'7'.repeat(5000)}\x1b`)).toEqual([])
    expect(stScanner.push('\\')).toEqual([])
    expect(stScanner.push('\x07')).toEqual([''])

    const bellScanner = new TerminalAttentionScanner()
    expect(bellScanner.push(`\x1b]9;4;1;${'7'.repeat(5000)}`)).toEqual([])
    expect(bellScanner.push('\x07')).toEqual([])
    expect(bellScanner.push('\x07')).toEqual([''])
  })

  test('recovers attention after an oversized unterminated OSC', () => {
    const osc9Scanner = new TerminalAttentionScanner()

    expect(osc9Scanner.push(`\x1b]777;${'x'.repeat(5000)}\x1b`)).toEqual([])
    expect(osc9Scanner.push(']9;build done\x07')).toEqual(['build done'])

    const osc777Scanner = new TerminalAttentionScanner()

    expect(osc777Scanner.push(`\x1b]9;${'x'.repeat(5000)}`)).toEqual([])
    expect(osc777Scanner.push('\x1b]777;notify\x1b\\')).toEqual(['notify'])
  })

  test('recovers when oversized reserved progress ends ESC then BEL', () => {
    const scanner = new TerminalAttentionScanner()

    expect(scanner.push(`\x1b]9;4;1;${'7'.repeat(5000)}\x1b`)).toEqual([])
    expect(scanner.push('\x07')).toEqual([])
    expect(scanner.push('\x1b]9;build done\x07')).toEqual(['build done'])
    expect(scanner.push('\x1b]777;notify\x1b\\')).toEqual(['notify'])
  })
})
