import type {
  TerminalDisposable,
  TerminalParser,
  TerminalParserEvent,
  TerminalParserEventHandler,
  TerminalParserOutputContext,
} from '../../types'

const BEL = '\x07'
const ESC = '\x1b'
const CSI_PREFIX = `${ESC}[`
const OSC_PREFIX = `${ESC}]`
const STRING_TERMINATOR = `${ESC}\\`
const MAX_PENDING_CONTROL_SEQUENCE_LENGTH = 16_384

interface SequenceTerminator {
  readonly index: number
  readonly length: number
}

const createDisposable = (dispose: () => void): TerminalDisposable => ({
  dispose,
})

const findSequenceTerminator = (
  data: string,
  startIndex: number
): SequenceTerminator | null => {
  const belIndex = data.indexOf(BEL, startIndex)
  const stringTerminatorIndex = data.indexOf(STRING_TERMINATOR, startIndex)

  if (belIndex === -1 && stringTerminatorIndex === -1) {
    return null
  }

  if (
    belIndex !== -1 &&
    (stringTerminatorIndex === -1 || belIndex < stringTerminatorIndex)
  ) {
    return { index: belIndex, length: BEL.length }
  }

  return {
    index: stringTerminatorIndex,
    length: STRING_TERMINATOR.length,
  }
}

const isCsiFinalByte = (char: string): boolean => {
  const code = char.charCodeAt(0)

  return code >= 0x40 && code <= 0x7e
}

const findCsiTerminator = (
  data: string,
  startIndex: number
): SequenceTerminator | null => {
  for (let index = startIndex; index < data.length; index += 1) {
    if (isCsiFinalByte(data[index] ?? '')) {
      return { index, length: 1 }
    }
  }

  return null
}

const parseOscIdentifier = (content: string): string | null => {
  const separatorIndex = content.indexOf(';')

  if (separatorIndex <= 0) {
    return null
  }

  return content.slice(0, separatorIndex)
}

const parseOscPayload = (content: string): string | null => {
  const separatorIndex = content.indexOf(';')

  if (separatorIndex <= 0) {
    return null
  }

  return content.slice(separatorIndex + 1)
}

export class TerminalControlSequenceParser implements TerminalParser {
  private readonly handlers = new Set<TerminalParserEventHandler>()
  private pendingControlSequence = ''

  onEvent(handler: TerminalParserEventHandler): TerminalDisposable {
    this.handlers.add(handler)

    return createDisposable((): void => {
      this.handlers.delete(handler)
    })
  }

  transformOutput(
    data: string,
    output: TerminalParserOutputContext | null
  ): string {
    if (this.handlers.size === 0) {
      const visible = `${this.pendingControlSequence}${data}`
      this.pendingControlSequence = ''

      return visible
    }

    const source = `${this.pendingControlSequence}${data}`
    this.pendingControlSequence = ''

    return this.consumeControlSequences(source, output)
  }

  private consumeControlSequences(
    data: string,
    output: TerminalParserOutputContext | null
  ): string {
    let visible = ''
    let cursor = 0

    while (cursor < data.length) {
      const sequenceStart = data.indexOf(ESC, cursor)

      if (sequenceStart === -1) {
        visible += data.slice(cursor)
        break
      }

      visible += data.slice(cursor, sequenceStart)

      if (data.startsWith(OSC_PREFIX, sequenceStart)) {
        const contentStart = sequenceStart + OSC_PREFIX.length
        const terminator = findSequenceTerminator(data, contentStart)

        if (!terminator) {
          this.pendingControlSequence = data.slice(sequenceStart)
          break
        }

        const sequenceEnd = terminator.index + terminator.length
        const content = data.slice(contentStart, terminator.index)

        this.consumeOsc(content, output)
        cursor = sequenceEnd
        continue
      }

      if (data.startsWith(CSI_PREFIX, sequenceStart)) {
        const terminator = findCsiTerminator(
          data,
          sequenceStart + CSI_PREFIX.length
        )

        if (!terminator) {
          this.pendingControlSequence = data.slice(sequenceStart)
          break
        }

        cursor = terminator.index + terminator.length
        continue
      }

      visible += ESC
      cursor = sequenceStart + ESC.length
    }

    if (
      this.pendingControlSequence.length > MAX_PENDING_CONTROL_SEQUENCE_LENGTH
    ) {
      visible += this.pendingControlSequence
      this.pendingControlSequence = ''
    }

    return visible
  }

  private consumeOsc(
    content: string,
    output: TerminalParserOutputContext | null
  ): void {
    const identifier = parseOscIdentifier(content)
    const payload = parseOscPayload(content)

    if (identifier === null || payload === null || Number(identifier) !== 7) {
      return
    }

    this.emit({
      type: 'cwd',
      source: 'osc7',
      uri: payload,
      output,
    })
  }

  private emit(event: TerminalParserEvent): void {
    this.handlers.forEach((handler) => {
      handler(event)
    })
  }
}
