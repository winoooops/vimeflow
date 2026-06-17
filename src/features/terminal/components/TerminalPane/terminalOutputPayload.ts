import type {
  TerminalOutputChunk,
  TerminalOutputInputMode,
  TerminalRendererCapabilities,
} from '../../types'

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

class TerminalOutputBytePayloadDecoder {
  private readonly streamingDecoder = new TextDecoder()

  decode(chunk: TerminalOutputChunk): string | null {
    const bytes = readTerminalOutputBytes(chunk)

    if (!bytes) {
      this.reset()

      return null
    }

    return this.streamingDecoder.decode(bytes, { stream: true })
  }

  private reset(): void {
    this.streamingDecoder.decode()
  }
}

export interface TerminalOutputPayloadSelection {
  readonly inputMode: TerminalOutputInputMode
  readonly text: string
}

export class TerminalOutputPayloadRouter {
  private readonly byteDecoder: TerminalOutputBytePayloadDecoder | null

  constructor(private readonly capabilities: TerminalRendererCapabilities) {
    this.byteDecoder =
      capabilities.preferredOutputInputMode === 'bytes'
        ? new TerminalOutputBytePayloadDecoder()
        : null
  }

  read(chunk: TerminalOutputChunk): TerminalOutputPayloadSelection {
    if (this.capabilities.preferredOutputInputMode === 'text') {
      return {
        inputMode: 'text',
        text: chunk.text,
      }
    }

    const decodedBytes = this.byteDecoder?.decode(chunk) ?? null

    if (decodedBytes !== null) {
      return {
        inputMode: 'bytes',
        text: decodedBytes,
      }
    }

    if (this.capabilities.acceptsText) {
      return {
        inputMode: 'text',
        text: chunk.text,
      }
    }

    throw new Error(
      'Terminal renderer requires bytesBase64 output, but the chunk did not include readable bytesBase64'
    )
  }
}
