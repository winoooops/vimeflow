// cspell:ignore ghostty
import { describe, expect, test, vi } from 'vitest'
import type {
  TerminalOutputChunk,
  TerminalOutputPhase,
  TerminalRendererCapabilities,
} from '../../types'
import {
  TerminalControlSequenceParserEngine,
  createControlSequenceTerminalParserEngine,
  type TerminalParserEngineInput,
  type TerminalParserEngineOutput,
} from './terminalParserEngine'

const textOnlyCapabilities: TerminalRendererCapabilities = {
  preferredOutputInputMode: 'text',
  acceptsText: true,
  acceptsBytes: false,
}

const bytePreferredCapabilities: TerminalRendererCapabilities = {
  preferredOutputInputMode: 'bytes',
  acceptsText: true,
  acceptsBytes: true,
}

const byteOnlyCapabilities: TerminalRendererCapabilities = {
  preferredOutputInputMode: 'bytes',
  acceptsText: false,
  acceptsBytes: true,
}

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

const createTextChunk = (
  text: string,
  offsetStart: number,
  phase: TerminalOutputPhase
): TerminalOutputChunk => ({
  text,
  offsetStart,
  byteLen: new TextEncoder().encode(text).length,
  phase,
})

const createTextEngine = (): TerminalControlSequenceParserEngine =>
  new TerminalControlSequenceParserEngine({
    capabilities: textOnlyCapabilities,
  })

const createByteEngine = (): TerminalControlSequenceParserEngine =>
  new TerminalControlSequenceParserEngine({
    capabilities: bytePreferredCapabilities,
  })

class RecordingParserEngine extends TerminalControlSequenceParserEngine {
  readonly inputs: TerminalParserEngineInput[] = []

  parseInput(input: TerminalParserEngineInput): TerminalParserEngineOutput {
    this.inputs.push(input)

    return super.parseInput(input)
  }
}

describe('terminal parser engine input modes', () => {
  test('text mode records its input mode and ignores byte payloads', () => {
    const engine = createTextEngine()
    const chunk = createByteChunk('bytes lose', 0, 'live')

    expect(engine.inputMode).toBe('text')
    expect(engine.parseOutput({ ...chunk, text: 'text wins' })).toEqual({
      visibleText: 'text wins',
    })
  })

  test('byte mode records its input mode and prefers byte payloads', () => {
    const engine = createByteEngine()

    expect(engine.inputMode).toBe('bytes')
    expect(engine.parseOutput(createByteChunk('bytes win', 0, 'live'))).toEqual(
      {
        visibleText: 'bytes win',
      }
    )
  })

  test('byte mode passes raw bytes to parser input before decoding fallback text', () => {
    const engine = new RecordingParserEngine({
      capabilities: bytePreferredCapabilities,
    })

    const bytes = new Uint8Array([0xff, 0xfe])

    expect(
      engine.parseOutput({
        text: 'fallback',
        bytesBase64: encodeBase64(bytes),
        offsetStart: 10,
        byteLen: bytes.length,
        phase: 'live',
      })
    ).toEqual({ visibleText: '��' })

    expect(engine.inputs).toEqual([
      {
        inputMode: 'bytes',
        text: '��',
        bytes,
        output: {
          offsetStart: 10,
          byteLen: 2,
          phase: 'live',
        },
      },
    ])
  })

  test('control parser class exposes the configured capabilities', () => {
    const engine = new TerminalControlSequenceParserEngine({
      capabilities: bytePreferredCapabilities,
    })

    expect(engine.inputMode).toBe('bytes')
    expect(engine.capabilities).toBe(bytePreferredCapabilities)
  })

  test('capability-aware parser engines fall back to text only when allowed', () => {
    const fallbackEngine = createControlSequenceTerminalParserEngine({
      capabilities: bytePreferredCapabilities,
    })

    const byteOnlyEngine = createControlSequenceTerminalParserEngine({
      capabilities: byteOnlyCapabilities,
    })

    expect(
      fallbackEngine.parseOutput(createTextChunk('fallback', 0, 'live'))
    ).toEqual({ visibleText: 'fallback' })

    expect(() =>
      byteOnlyEngine.parseOutput(createTextChunk('fallback', 0, 'live'))
    ).toThrow('Terminal renderer requires bytesBase64 output')
  })

  test('emits matching OSC 7 cwd events from text and byte paths', () => {
    const textEngine = createControlSequenceTerminalParserEngine({
      capabilities: textOnlyCapabilities,
    })

    const byteEngine = createControlSequenceTerminalParserEngine({
      capabilities: bytePreferredCapabilities,
    })

    const textHandler = vi.fn()
    const byteHandler = vi.fn()
    const output = 'before \x1b]7;file://localhost/tmp/generic-parser\x07 after'

    textEngine.parser.onEvent(textHandler)
    byteEngine.parser.onEvent(byteHandler)

    expect(textEngine.parseOutput(createTextChunk(output, 12, 'live'))).toEqual(
      {
        visibleText: 'before  after',
      }
    )

    expect(byteEngine.parseOutput(createByteChunk(output, 12, 'live'))).toEqual(
      {
        visibleText: 'before  after',
      }
    )

    const expectedEvent = {
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/generic-parser',
      output: {
        offsetStart: 12,
        byteLen: new TextEncoder().encode(output).length,
        phase: 'live',
      },
    }

    expect(textHandler).toHaveBeenCalledWith(expectedEvent)
    expect(byteHandler).toHaveBeenCalledWith(expectedEvent)
  })
})

describe('byte-capable control sequence parser engine', () => {
  test('emits OSC 7 cwd events from byte payloads', () => {
    const engine = createByteEngine()
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
    const engine = createByteEngine()
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
    const engine = createByteEngine()
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
    const engine = createByteEngine()
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
