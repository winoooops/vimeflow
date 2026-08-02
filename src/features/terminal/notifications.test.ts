import { describe, expect, test, vi } from 'vitest'
import {
  emitTerminalAttention,
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
})
