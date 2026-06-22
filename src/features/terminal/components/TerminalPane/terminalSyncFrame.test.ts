import { describe, expect, test } from 'vitest'
import {
  createSyncFrameParserState,
  readSyncFrameState,
  type SyncFrameParserState,
} from './terminalSyncFrame'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

const BEGIN = '\x1b[?2026h'
const END = '\x1b[?2026l'

describe('readSyncFrameState', () => {
  const readInsideFrame = (
    text: string,
    previousInsideFrame: boolean
  ): boolean =>
    readSyncFrameState(bytes(text), {
      insideFrame: previousInsideFrame,
      carryBytes: new Uint8Array(),
    }).insideFrame

  test('a complete frame in one chunk ends outside', () => {
    expect(readInsideFrame(`${BEGIN}cleared redraw${END}`, false)).toBe(false)
  })

  test('a chunk ending after begin (before end) stays inside', () => {
    expect(readInsideFrame(`${BEGIN}\x1b[2J partial`, false)).toBe(true)
  })

  test('a chunk closing a previously-open frame ends outside', () => {
    expect(readInsideFrame(`redraw rest${END}`, true)).toBe(false)
  })

  test('carries the previous state when no markers are present', () => {
    expect(readInsideFrame('just normal output', true)).toBe(true)
    expect(readInsideFrame('just normal output', false)).toBe(false)
  })

  test('uses the last marker when several appear in one chunk', () => {
    // begin, end, begin again -> still inside
    expect(readInsideFrame(`${BEGIN}a${END}b${BEGIN}c`, false)).toBe(true)
    // end, begin, end -> outside
    expect(readInsideFrame(`${END}${BEGIN}${END}`, true)).toBe(false)
  })

  test('ignores unrelated CSI sequences', () => {
    expect(readInsideFrame('\x1b[?25h\x1b[2J\x1b[1;1H', false)).toBe(false)
  })

  test('detects a begin marker at the very end of a chunk', () => {
    expect(readInsideFrame(`output${BEGIN}`, false)).toBe(true)
  })

  test('detects a begin marker split across chunks', () => {
    let state: SyncFrameParserState = createSyncFrameParserState()

    state = readSyncFrameState(bytes('output\x1b[?20'), state)
    expect(state.insideFrame).toBe(false)

    state = readSyncFrameState(bytes('26h\x1b[2J partial'), state)
    expect(state.insideFrame).toBe(true)
  })

  test('detects an end marker split across chunks', () => {
    let state: SyncFrameParserState = {
      insideFrame: true,
      carryBytes: new Uint8Array(),
    }

    state = readSyncFrameState(bytes('redraw\x1b[?202'), state)
    expect(state.insideFrame).toBe(true)

    state = readSyncFrameState(bytes('6l after'), state)
    expect(state.insideFrame).toBe(false)
  })
})
