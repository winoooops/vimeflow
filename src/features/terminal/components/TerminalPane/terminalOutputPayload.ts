import type { TerminalOutputChunk } from '../../types'

export const decodeBase64ToBytes = (value: string): Uint8Array | null => {
  try {
    const binary = globalThis.atob(value)
    const bytes = new Uint8Array(binary.length)

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    return bytes
  } catch {
    return null
  }
}

export const readTerminalOutputBytes = (
  chunk: TerminalOutputChunk
): Uint8Array | null =>
  chunk.bytesBase64 === undefined
    ? null
    : decodeBase64ToBytes(chunk.bytesBase64)

export class TerminalOutputPayloadDecoder {
  private readonly streamingDecoder = new TextDecoder()

  decode(chunk: TerminalOutputChunk): string {
    const bytes = readTerminalOutputBytes(chunk)

    if (!bytes) {
      this.reset()

      return chunk.text
    }

    return this.streamingDecoder.decode(bytes, { stream: true })
  }

  private reset(): void {
    this.streamingDecoder.decode()
  }
}
