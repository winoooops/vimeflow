// cspell:ignore ghostty
import { describe, expect, test, vi } from 'vitest'
import type { TerminalOutputChunk, TerminalOutputPhase } from '../../types'
import {
  createByteControlSequenceTerminalParserEngine,
  createTextControlSequenceTerminalParserEngine,
} from './terminalParserEngine'

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return globalThis.btoa(binary)
}

const createByteChunk = (
  text: string,
  offsetStart: number,
  phase: TerminalOutputPhase
): TerminalOutputChunk => {
  const bytes = new TextEncoder().encode(text)

  return {
    text: 'fallback',
    bytesBase64: encodeBase64(bytes),
    offsetStart,
    byteLen: bytes.length,
    phase,
  }
}

describe('terminal parser engine input modes', () => {
  test('text mode records its input mode and ignores byte payloads', () => {
    const engine = createTextControlSequenceTerminalParserEngine()
    const chunk = createByteChunk('bytes lose', 0, 'live')

    expect(engine.inputMode).toBe('text')
    expect(engine.parseOutput({ ...chunk, text: 'text wins' })).toEqual({
      visibleText: 'text wins',
    })
  })

  test('byte mode records its input mode and prefers byte payloads', () => {
    const engine = createByteControlSequenceTerminalParserEngine()

    expect(engine.inputMode).toBe('bytes')
    expect(engine.parseOutput(createByteChunk('bytes win', 0, 'live'))).toEqual(
      {
        visibleText: 'bytes win',
      }
    )
  })
})

describe('createByteControlSequenceTerminalParserEngine', () => {
  test('emits OSC 7 cwd events from byte payloads', () => {
    const engine = createByteControlSequenceTerminalParserEngine()
    const handler = vi.fn()

    const chunk = createByteChunk(
      'before \x1b]7;file://localhost/tmp/ghostty-project\x07 after',
      40,
      'live'
    )

    engine.parser.onEvent(handler)

    expect(engine.parseOutput(chunk)).toEqual({ visibleText: 'before  after' })
    expect(handler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/ghostty-project',
      output: {
        offsetStart: chunk.offsetStart,
        byteLen: chunk.byteLen,
        phase: chunk.phase,
      },
    })
  })

  test('reassembles split OSC 7 byte payloads with completion context', () => {
    const engine = createByteControlSequenceTerminalParserEngine()
    const handler = vi.fn()

    const firstChunk = createByteChunk(
      'before \x1b]7;file://local',
      0,
      'restore'
    )

    const secondChunk = createByteChunk(
      'host/tmp/ghostty\x07 after',
      firstChunk.byteLen ?? 0,
      'restore'
    )

    engine.parser.onEvent(handler)

    expect(engine.parseOutput(firstChunk)).toEqual({ visibleText: 'before ' })
    expect(engine.parseOutput(secondChunk)).toEqual({ visibleText: ' after' })
    expect(handler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/ghostty',
      output: {
        offsetStart: secondChunk.offsetStart,
        byteLen: secondChunk.byteLen,
        phase: secondChunk.phase,
      },
    })
  })

  test('supports OSC 7 sequences terminated with string terminator', () => {
    const engine = createByteControlSequenceTerminalParserEngine()
    const handler = vi.fn()

    const chunk = createByteChunk(
      'before \x1b]7;file://localhost/tmp/st\x1b\\ after',
      8,
      'live'
    )

    engine.parser.onEvent(handler)

    expect(engine.parseOutput(chunk)).toEqual({ visibleText: 'before  after' })
    expect(handler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/st',
      output: {
        offsetStart: chunk.offsetStart,
        byteLen: chunk.byteLen,
        phase: chunk.phase,
      },
    })
  })

  test('preserves raw non-file OSC 7 payloads for consumer validation', () => {
    const engine = createByteControlSequenceTerminalParserEngine()
    const handler = vi.fn()

    const chunk = createByteChunk(
      'before \x1b]7;javascript:alert(1)\x07 after',
      4,
      'live'
    )

    engine.parser.onEvent(handler)

    expect(engine.parseOutput(chunk)).toEqual({ visibleText: 'before  after' })
    expect(handler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'javascript:alert(1)',
      output: {
        offsetStart: chunk.offsetStart,
        byteLen: chunk.byteLen,
        phase: chunk.phase,
      },
    })
  })
})
