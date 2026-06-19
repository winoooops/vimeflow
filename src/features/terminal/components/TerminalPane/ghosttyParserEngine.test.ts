// cspell:ignore ghostty
import { describe, expect, test, vi } from 'vitest'
import type { TerminalOutputChunk } from '../../types'
import {
  GHOSTTY_PARSER_ENGINE_ID,
  createGhosttyParserEngine,
  type GhosttyByteParserAdapter,
  type GhosttyByteParserAdapterInput,
} from './ghosttyParserEngine'
import { getSgrStyleSentinel } from './terminalControlParser'
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

const createRawByteChunk = (
  bytes: Uint8Array,
  offsetStart: number,
  phase: TerminalOutputChunk['phase']
): TerminalOutputChunk => ({
  text: 'lossy fallback',
  bytesBase64: encodeBase64(bytes),
  offsetStart,
  byteLen: bytes.length,
  phase,
})

describe('ghosttyParserEngine', () => {
  test('exposes the Ghostty spike identity and byte-preferring capabilities', () => {
    const engine = createGhosttyParserEngine()

    expect(engine.id).toBe(GHOSTTY_PARSER_ENGINE_ID)
    expect(engine.inputMode).toBe('bytes')
    expect(engine.capabilities).toBe(GHOSTTY_TERMINAL_CAPABILITIES)
  })

  test('rejects byteOnly mode without an explicit byte parser adapter', () => {
    expect(() => createGhosttyParserEngine({ byteOnly: true })).toThrow(
      'byteOnly mode requires a byteParserAdapter'
    )
  })

  test('parses visible output from bytes before text fallback', () => {
    const engine = createGhosttyParserEngine()

    expect(engine.parseOutput(createByteChunk('bytes win', 0, 'live'))).toEqual(
      {
        visibleText: 'bytes win',
      }
    )
  })

  test('receives raw byte payloads at the Ghostty parser boundary', () => {
    const engine = createGhosttyParserEngine()
    const parseInput = vi.spyOn(engine, 'parseInput')
    const bytes = new Uint8Array([0xff, 0xfe])

    expect(engine.parseOutput(createRawByteChunk(bytes, 2, 'live'))).toEqual({
      visibleText: '��',
    })

    expect(parseInput).toHaveBeenCalledWith({
      inputMode: 'bytes',
      text: '��',
      bytes,
      output: {
        offsetStart: 2,
        byteLen: 2,
        phase: 'live',
      },
    })
  })

  test('routes byte payloads through the Ghostty byte parser adapter', () => {
    const parseBytes = vi.fn((input: GhosttyByteParserAdapterInput) => ({
      visibleText: `${Array.from(input.bytes).join(',')}:${input.decodedText}:${
        input.output?.offsetStart ?? 'missing'
      }`,
    }))

    const reset = vi.fn()
    const adapter: GhosttyByteParserAdapter = { parseBytes, reset }
    const engine = createGhosttyParserEngine({ byteParserAdapter: adapter })
    const bytes = new Uint8Array([0xff, 0xfe])

    expect(engine.parseOutput(createRawByteChunk(bytes, 7, 'live'))).toEqual({
      visibleText: '255,254:��:7',
    })

    expect(parseBytes).toHaveBeenCalledWith({
      bytes,
      decodedText: '��',
      output: {
        offsetStart: 7,
        byteLen: 2,
        phase: 'live',
      },
      emitEvent: expect.any(Function),
    })
    expect(reset).not.toHaveBeenCalled()
  })

  test('forwards resize and reset to the Ghostty byte parser adapter', () => {
    const reset = vi.fn()
    const resize = vi.fn()

    const adapter: GhosttyByteParserAdapter = {
      parseBytes: vi.fn(() => ({ visibleText: '' })),
      reset,
      resize,
    }

    const engine = createGhosttyParserEngine({ byteParserAdapter: adapter })

    engine.resize?.({ cols: 120, rows: 30 })
    engine.reset?.()

    expect(resize).toHaveBeenCalledWith({ cols: 120, rows: 30 })
    expect(reset).toHaveBeenCalledOnce()
  })

  test('ignores resize and reset after disposal', () => {
    const reset = vi.fn()
    const resize = vi.fn()

    const adapter: GhosttyByteParserAdapter = {
      parseBytes: vi.fn(() => ({ visibleText: '' })),
      reset,
      resize,
    }

    const engine = createGhosttyParserEngine({ byteParserAdapter: adapter })

    engine.dispose?.()
    engine.resize?.({ cols: 120, rows: 30 })
    engine.reset?.()

    expect(resize).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
  })

  test('routes adapter parser events through the existing parser surface', () => {
    const parseBytes = vi.fn((input: GhosttyByteParserAdapterInput) => {
      input.emitEvent({
        type: 'cwd',
        source: 'osc7',
        uri: 'file://localhost/tmp/ghostty-vt',
        output: input.output,
      })

      return { visibleText: 'from-adapter' }
    })

    const engine = createGhosttyParserEngine({
      byteParserAdapter: { parseBytes },
    })

    const handler = vi.fn()
    engine.parser.onEvent(handler)

    expect(
      engine.parseOutput(createRawByteChunk(new Uint8Array([0x47]), 11, 'live'))
    ).toEqual({
      visibleText: 'from-adapter',
    })

    expect(handler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/ghostty-vt',
      output: {
        offsetStart: 11,
        byteLen: 1,
        phase: 'live',
      },
    })
  })

  test('disposes the Ghostty byte parser adapter once', () => {
    const dispose = vi.fn()

    const engine = createGhosttyParserEngine({
      byteParserAdapter: {
        parseBytes: vi.fn(() => ({ visibleText: '' })),
        dispose,
      },
    })

    engine.dispose?.()
    engine.dispose?.()

    expect(dispose).toHaveBeenCalledOnce()
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

  test('resets the Ghostty byte parser adapter on text fallback', () => {
    const parseBytes = vi.fn(() => ({ visibleText: 'bytes' }))
    const reset = vi.fn()
    const adapter: GhosttyByteParserAdapter = { parseBytes, reset }
    const engine = createGhosttyParserEngine({ byteParserAdapter: adapter })

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

    expect(parseBytes).not.toHaveBeenCalled()
    expect(reset).toHaveBeenCalledTimes(1)
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
      `feat/ghostty-spike${ESC}[0${SGR_FINAL} % ${ESC}=`

    engine.parser.onEvent(handler)

    expect(engine.parseOutput(createByteChunk(output, 0, 'live'))).toEqual({
      visibleText: 'feat/ghostty-spike % ',
      displayText:
        `${getSgrStyleSentinel([38, 2, 243, 139, 168])}` +
        `feat/ghostty-spike${getSgrStyleSentinel([0])} % `,
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
