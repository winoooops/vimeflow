import { describe, expect, test } from 'vitest'
import { readSyncFrameState } from './terminalSyncFrame'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

const BEGIN = '\x1b[?2026h'
const END = '\x1b[?2026l'

describe('readSyncFrameState', () => {
  test('a complete frame in one chunk ends outside', () => {
    expect(
      readSyncFrameState(bytes(`${BEGIN}cleared redraw${END}`), false)
    ).toBe(false)
  })

  test('a chunk ending after begin (before end) stays inside', () => {
    expect(readSyncFrameState(bytes(`${BEGIN}\x1b[2J partial`), false)).toBe(
      true
    )
  })

  test('a chunk closing a previously-open frame ends outside', () => {
    expect(readSyncFrameState(bytes(`redraw rest${END}`), true)).toBe(false)
  })

  test('carries the previous state when no markers are present', () => {
    expect(readSyncFrameState(bytes('just normal output'), true)).toBe(true)
    expect(readSyncFrameState(bytes('just normal output'), false)).toBe(false)
  })

  test('uses the last marker when several appear in one chunk', () => {
    // begin, end, begin again -> still inside
    expect(readSyncFrameState(bytes(`${BEGIN}a${END}b${BEGIN}c`), false)).toBe(
      true
    )
    // end, begin, end -> outside
    expect(readSyncFrameState(bytes(`${END}${BEGIN}${END}`), true)).toBe(false)
  })

  test('ignores unrelated CSI sequences', () => {
    expect(readSyncFrameState(bytes('\x1b[?25h\x1b[2J\x1b[1;1H'), false)).toBe(
      false
    )
  })

  test('detects a begin marker at the very end of a chunk', () => {
    expect(readSyncFrameState(bytes(`output${BEGIN}`), false)).toBe(true)
  })
})
