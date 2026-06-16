import { describe, expect, test } from 'vitest'
import type { TerminalOutputChunk } from '../../types'
import {
  TerminalOutputPayloadDecoder,
  decodeBase64ToBytes,
  readTerminalOutputBytes,
} from './terminalOutputPayload'

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return globalThis.btoa(binary)
}

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
    const decoder = new TerminalOutputPayloadDecoder()
    const character = String.fromCodePoint(0x4f60)
    const bytes = new TextEncoder().encode(character)
    const first = outputChunk('wrong', encodeBase64(bytes.slice(0, 2)))
    const second = outputChunk('wrong', encodeBase64(bytes.slice(2)))

    expect(decoder.decode(first)).toBe('')
    expect(decoder.decode(second)).toBe(character)
  })

  test('falls back to text when bytes are unavailable or invalid', () => {
    const decoder = new TerminalOutputPayloadDecoder()

    expect(decoder.decode(outputChunk('fallback'))).toBe('fallback')
    expect(decoder.decode(outputChunk('fallback', 'not base64?'))).toBe(
      'fallback'
    )
  })

  test('resets streaming bytes before falling back to text', () => {
    const decoder = new TerminalOutputPayloadDecoder()
    const character = String.fromCodePoint(0x4f60)
    const bytes = new TextEncoder().encode(character)
    const partial = outputChunk('wrong', encodeBase64(bytes.slice(0, 2)))
    const complete = outputChunk('wrong', encodeBase64(bytes))

    expect(decoder.decode(partial)).toBe('')
    expect(decoder.decode(outputChunk('fallback'))).toBe('fallback')
    expect(decoder.decode(complete)).toBe(character)
  })
})
