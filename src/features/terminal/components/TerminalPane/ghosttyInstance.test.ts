// cspell:ignore ghostty
import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  TerminalDisposable,
  TerminalOutputChunk,
  TerminalParser,
} from '../../types'
import type { TerminalParserEngineOutput } from './terminalParserEngine'
import {
  GHOSTTY_TERMINAL_RENDERER_ID,
  createGhosttyTerminal,
  ghosttyTerminalRenderer,
  type GhosttyTerminalOptions,
} from './ghosttyInstance'

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return globalThis.btoa(binary)
}

const encodeText = (text: string): string =>
  encodeBase64(new TextEncoder().encode(text))

const createdTerminals = new Set<ReturnType<typeof createGhosttyTerminal>>()

const createTrackedGhosttyTerminal = (
  options: GhosttyTerminalOptions = {}
): ReturnType<typeof createGhosttyTerminal> => {
  const created = createGhosttyTerminal(options)
  createdTerminals.add(created)

  return created
}

afterEach(() => {
  createdTerminals.forEach((created) => {
    created.terminal.dispose()
  })
  createdTerminals.clear()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('ghosttyInstance', () => {
  test('exposes the opt-in ghostty renderer adapter', () => {
    expect(ghosttyTerminalRenderer.id).toBe(GHOSTTY_TERMINAL_RENDERER_ID)
    expect(ghosttyTerminalRenderer.createInstance).toBe(createGhosttyTerminal)
  })

  test('delegates output parsing through an injected parser engine', () => {
    const parser: TerminalParser = {
      onEvent: (handler): TerminalDisposable => {
        void handler

        return { dispose: vi.fn() }
      },
    }

    const parseOutput = vi.fn(
      (chunk: TerminalOutputChunk): TerminalParserEngineOutput => ({
        visibleText: `parsed:${chunk.text}`,
      })
    )

    const created = createTrackedGhosttyTerminal({
      createParserEngine: () => ({
        parser,
        parseOutput,
      }),
    })

    const chunk = {
      text: 'from-engine',
      offsetStart: 3,
      byteLen: 11,
      phase: 'live' as const,
    }

    created.output.writeOutput(chunk)

    expect(created.parser).toBe(parser)
    expect(parseOutput).toHaveBeenCalledWith(chunk)
    expect(created.viewportReader.readVisibleText()).toBe('parsed:from-engine')
  })

  test('prefers byte payloads over lossy text fallback', () => {
    const created = createTrackedGhosttyTerminal()

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('bytes win'),
      offsetStart: 0,
      byteLen: 9,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe('bytes win')
  })

  test('renders invalid byte payloads through the byte path', () => {
    const created = createTrackedGhosttyTerminal()

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: '//4=',
      offsetStart: 0,
      byteLen: 2,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe('\uFFFD\uFFFD')
  })

  test('falls back to text when byte payloads are unavailable', () => {
    const created = createTrackedGhosttyTerminal()

    created.output.writeOutput({
      text: 'text fallback',
      offsetStart: 0,
      byteLen: 13,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe('text fallback')
  })

  test('streams split UTF-8 byte payloads before rendering text', () => {
    const created = createTrackedGhosttyTerminal()
    const character = String.fromCodePoint(0x4f60)
    const bytes = new TextEncoder().encode(character)

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeBase64(bytes.slice(0, 2)),
      offsetStart: 0,
      byteLen: 2,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe('')

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeBase64(bytes.slice(2)),
      offsetStart: 2,
      byteLen: 1,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe(character)
  })

  test('emits OSC 7 cwd events parsed from byte payloads', () => {
    const created = createTrackedGhosttyTerminal()
    const handler = vi.fn()

    created.parser.onEvent(handler)
    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText(
        'before \x1b]7;file://localhost/tmp/ghostty-project\x07 after'
      ),
      offsetStart: 40,
      byteLen: 58,
      phase: 'live',
    })

    expect(handler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/ghostty-project',
      output: {
        offsetStart: 40,
        byteLen: 58,
        phase: 'live',
      },
    })
    expect(created.viewportReader.readVisibleText()).toBe('before  after')
  })

  test('reassembles split OSC 7 byte payloads with completion context', () => {
    const created = createTrackedGhosttyTerminal()
    const handler = vi.fn()

    created.parser.onEvent(handler)
    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('before \x1b]7;file://local'),
      offsetStart: 0,
      byteLen: 24,
      phase: 'restore',
    })

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('host/tmp/ghostty\x07 after'),
      offsetStart: 24,
      byteLen: 23,
      phase: 'restore',
    })

    expect(handler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/ghostty',
      output: {
        offsetStart: 24,
        byteLen: 23,
        phase: 'restore',
      },
    })
    expect(created.viewportReader.readVisibleText()).toBe('before  after')
  })

  test('marks the composed terminal surface as the ghostty spike renderer', () => {
    const created = createTrackedGhosttyTerminal()

    expect(created.terminal.element?.dataset.terminalRenderer).toBe(
      GHOSTTY_TERMINAL_RENDERER_ID
    )
  })
})
