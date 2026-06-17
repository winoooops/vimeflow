import { describe, expect, test } from 'vitest'
import type { TerminalOutputChunk } from '../../types'
import {
  TerminalOutputPayloadRouter,
  decodeBase64ToBytes,
  readTerminalOutputBytes,
} from './terminalOutputPayload'

const textOnlyCapabilities = {
  preferredOutputInputMode: 'text',
  acceptsText: true,
  acceptsBytes: false,
} as const

const bytePreferredCapabilities = {
  preferredOutputInputMode: 'bytes',
  acceptsText: true,
  acceptsBytes: true,
} as const

const byteOnlyCapabilities = {
  preferredOutputInputMode: 'bytes',
  acceptsText: false,
  acceptsBytes: true,
} as const

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return globalThis.btoa(binary)
}

const encodeText = (text: string): string =>
  encodeBase64(new TextEncoder().encode(text))

const outputChunk = (
  text: string,
  bytesBase64?: string
): TerminalOutputChunk => ({
  text,
  ...(bytesBase64 === undefined ? {} : { bytesBase64 }),
  offsetStart: 0,
  byteLen: bytesBase64?.length ?? text.length,
  phase: 'live',
})

describe('terminalOutputPayload', () => {
  test('decodes base64 payloads to raw bytes', () => {
    expect(decodeBase64ToBytes('//4=')).toEqual(new Uint8Array([255, 254]))
  })

  test('returns null for invalid base64 payloads', () => {
    expect(decodeBase64ToBytes('not base64?')).toBeNull()
  })

  test('reads optional bytes from terminal output chunks', () => {
    const chunk = outputChunk('fallback', 'aGk=')

    expect(readTerminalOutputBytes(chunk)).toEqual(new Uint8Array([104, 105]))
    expect(readTerminalOutputBytes(outputChunk('fallback'))).toBeNull()
  })

  test('prefers streaming byte payloads over fallback text', () => {
    const router = new TerminalOutputPayloadRouter(bytePreferredCapabilities)
    const character = String.fromCodePoint(0x4f60)
    const bytes = new TextEncoder().encode(character)
    const first = outputChunk('wrong', encodeBase64(bytes.slice(0, 2)))
    const second = outputChunk('wrong', encodeBase64(bytes.slice(2)))

    expect(router.read(first)).toEqual({ inputMode: 'bytes', text: '' })
    expect(router.read(second)).toEqual({
      inputMode: 'bytes',
      text: character,
    })
  })

  test('falls back to text when bytes are unavailable or invalid', () => {
    const router = new TerminalOutputPayloadRouter(bytePreferredCapabilities)

    expect(router.read(outputChunk('fallback'))).toEqual({
      inputMode: 'text',
      text: 'fallback',
    })

    expect(router.read(outputChunk('fallback', 'not base64?'))).toEqual({
      inputMode: 'text',
      text: 'fallback',
    })
  })

  test('resets streaming bytes before falling back to text', () => {
    const router = new TerminalOutputPayloadRouter(bytePreferredCapabilities)
    const character = String.fromCodePoint(0x4f60)
    const bytes = new TextEncoder().encode(character)
    const partial = outputChunk('wrong', encodeBase64(bytes.slice(0, 2)))
    const complete = outputChunk('wrong', encodeBase64(bytes))

    expect(router.read(partial)).toEqual({ inputMode: 'bytes', text: '' })
    expect(router.read(outputChunk('fallback'))).toEqual({
      inputMode: 'text',
      text: 'fallback',
    })

    expect(router.read(complete)).toEqual({
      inputMode: 'bytes',
      text: character,
    })
  })

  test('routes text-preferring renderers through text chunks', () => {
    const router = new TerminalOutputPayloadRouter(textOnlyCapabilities)

    expect(
      router.read(outputChunk('text wins', encodeText('bytes lose')))
    ).toEqual({
      inputMode: 'text',
      text: 'text wins',
    })
  })

  test('routes byte-preferring renderers through byte chunks', () => {
    const router = new TerminalOutputPayloadRouter(bytePreferredCapabilities)

    expect(
      router.read(outputChunk('text loses', encodeText('bytes win')))
    ).toEqual({
      inputMode: 'bytes',
      text: 'bytes win',
    })
  })

  test('falls back to text only when byte-preferring renderers accept text', () => {
    const router = new TerminalOutputPayloadRouter(bytePreferredCapabilities)

    expect(router.read(outputChunk('text fallback'))).toEqual({
      inputMode: 'text',
      text: 'text fallback',
    })
  })

  test('throws when byte-only renderers receive no readable byte payload', () => {
    const router = new TerminalOutputPayloadRouter(byteOnlyCapabilities)

    expect(() => router.read(outputChunk('text fallback'))).toThrow(
      'Terminal renderer requires bytesBase64 output'
    )

    expect(() =>
      router.read(outputChunk('text fallback', 'not base64?'))
    ).toThrow('Terminal renderer requires bytesBase64 output')
  })
})
