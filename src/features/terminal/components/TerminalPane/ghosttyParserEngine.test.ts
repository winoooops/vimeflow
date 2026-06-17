// cspell:ignore ghostty
import { describe, expect, test, vi } from 'vitest'
import type { TerminalOutputChunk } from '../../types'
import {
  GHOSTTY_PARSER_ENGINE_ID,
  createGhosttyParserEngine,
} from './ghosttyParserEngine'
import { GHOSTTY_TERMINAL_CAPABILITIES } from './terminalRendererCapabilities'

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return globalThis.btoa(binary)
}

const encodeText = (text: string): string =>
  encodeBase64(new TextEncoder().encode(text))

const ESC = '\x1b'
const SGR_FINAL = 'm'

const createByteChunk = (
  text: string,
  offsetStart: number,
  phase: TerminalOutputChunk['phase']
): TerminalOutputChunk => ({
  text: 'lossy fallback',
  bytesBase64: encodeText(text),
  offsetStart,
  byteLen: new TextEncoder().encode(text).length,
  phase,
})

describe('ghosttyParserEngine', () => {
  test('exposes the Ghostty spike identity and byte-preferring capabilities', () => {
    const engine = createGhosttyParserEngine()

    expect(engine.id).toBe(GHOSTTY_PARSER_ENGINE_ID)
    expect(engine.inputMode).toBe('bytes')
    expect(engine.capabilities).toBe(GHOSTTY_TERMINAL_CAPABILITIES)
  })

  test('parses visible output from bytes before text fallback', () => {
    const engine = createGhosttyParserEngine()

    expect(engine.parseOutput(createByteChunk('bytes win', 0, 'live'))).toEqual(
      {
        visibleText: 'bytes win',
      }
    )
  })

  test('falls back to text when byte payloads are unreadable', () => {
    const engine = createGhosttyParserEngine()

    expect(
      engine.parseOutput({
        text: 'text fallback',
        bytesBase64: 'not base64?',
        offsetStart: 0,
        byteLen: 13,
        phase: 'live',
      })
    ).toEqual({
      visibleText: 'text fallback',
    })
  })

  test('emits OSC 7 cwd events from byte payloads with output context', () => {
    const engine = createGhosttyParserEngine()
    const handler = vi.fn()

    const chunk = createByteChunk(
      'before \x1b]7;file://localhost/tmp/ghostty-spike\x07 after',
      32,
      'live'
    )

    engine.parser.onEvent(handler)

    expect(engine.parseOutput(chunk)).toEqual({ visibleText: 'before  after' })
    expect(handler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/ghostty-spike',
      output: {
        offsetStart: chunk.offsetStart,
        byteLen: chunk.byteLen,
        phase: chunk.phase,
      },
    })
  })

  test('hides zsh color and title controls from byte payload visible text', () => {
    const engine = createGhosttyParserEngine()
    const handler = vi.fn()

    const output =
      `${ESC}]2;user@host:~/project\x07` +
      `${ESC}[38;2;243;139;168${SGR_FINAL}` +
      `feat/ghostty-spike${ESC}[0${SGR_FINAL} % `

    engine.parser.onEvent(handler)

    expect(engine.parseOutput(createByteChunk(output, 0, 'live'))).toEqual({
      visibleText: 'feat/ghostty-spike % ',
    })
    expect(handler).not.toHaveBeenCalled()
  })

  test('keeps restore OSC 7 events tagged as restore when split across chunks', () => {
    const engine = createGhosttyParserEngine()
    const handler = vi.fn()

    const first = createByteChunk('before \x1b]7;file://local', 0, 'restore')

    const second = createByteChunk(
      'host/tmp/ghostty-restore\x07 after',
      first.byteLen ?? 0,
      'restore'
    )

    engine.parser.onEvent(handler)

    expect(engine.parseOutput(first)).toEqual({ visibleText: 'before ' })
    expect(engine.parseOutput(second)).toEqual({ visibleText: ' after' })
    expect(handler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/ghostty-restore',
      output: {
        offsetStart: second.offsetStart,
        byteLen: second.byteLen,
        phase: 'restore',
      },
    })
  })

  test('retains text fallback while the spike shares the existing transport', () => {
    const engine = createGhosttyParserEngine()

    expect(
      engine.parseOutput({
        text: 'text fallback',
        offsetStart: 0,
        byteLen: 13,
        phase: 'live',
      })
    ).toEqual({
      visibleText: 'text fallback',
    })
  })
})
