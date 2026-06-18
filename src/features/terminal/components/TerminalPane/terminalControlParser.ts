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
const MAX_REPEATED_DISPLAY_CONTROL_COUNT = 4_096

const ERASE_LINE_SENTINELS = ['\u{F0000}', '\u{F0001}', '\u{F0002}']
const CLEAR_SCREEN_SENTINEL = '\u{F0003}'
const CURSOR_LEFT_SENTINEL = '\u{F0004}'
const CURSOR_RIGHT_SENTINEL = '\u{F0005}'
const SGR_STYLE_SENTINEL_START = '\u{F0006}'
const SGR_STYLE_SENTINEL_END = '\u{F0007}'
const CURSOR_UP_SENTINEL = '\u{F0008}'
const CURSOR_DOWN_SENTINEL = '\u{F0009}'
const CURSOR_POSITION_SENTINEL_START = '\u{F000A}'
const CURSOR_POSITION_SENTINEL_END = '\u{F000B}'
const ERASE_DISPLAY_SENTINELS = ['\u{F000C}', '\u{F000D}']
const SAVE_CURSOR_SENTINEL = '\u{F000E}'
const RESTORE_CURSOR_SENTINEL = '\u{F000F}'
const CURSOR_HORIZONTAL_ABSOLUTE_SENTINEL_START = '\u{F0010}'
const CURSOR_HORIZONTAL_ABSOLUTE_SENTINEL_END = '\u{F0011}'

export interface TerminalControlSequenceOutput {
  readonly visibleText: string
  readonly displayText?: string
}

export interface SgrStyleSentinel {
  readonly parameters: readonly number[]
  readonly length: number
}

export interface CursorPositionSentinel {
  readonly row: number
  readonly column: number
  readonly length: number
}

export interface CursorHorizontalAbsoluteSentinel {
  readonly column: number
  readonly length: number
}

export const getEraseLineSentinel = (mode: 0 | 1 | 2): string =>
  ERASE_LINE_SENTINELS[mode]

export const getEraseDisplaySentinel = (mode: 0 | 1): string =>
  ERASE_DISPLAY_SENTINELS[mode]

export const getClearScreenSentinel = (): string => CLEAR_SCREEN_SENTINEL

export const getCursorLeftSentinel = (): string => CURSOR_LEFT_SENTINEL

export const getCursorRightSentinel = (): string => CURSOR_RIGHT_SENTINEL

export const getCursorUpSentinel = (): string => CURSOR_UP_SENTINEL

export const getCursorDownSentinel = (): string => CURSOR_DOWN_SENTINEL

export const getCursorPositionSentinel = (
  row: number,
  column: number
): string =>
  `${CURSOR_POSITION_SENTINEL_START}${row};${column}${CURSOR_POSITION_SENTINEL_END}`

export const getCursorHorizontalAbsoluteSentinel = (
  column: number
): string =>
  `${CURSOR_HORIZONTAL_ABSOLUTE_SENTINEL_START}${column}${CURSOR_HORIZONTAL_ABSOLUTE_SENTINEL_END}`

export const getSaveCursorSentinel = (): string => SAVE_CURSOR_SENTINEL

export const getRestoreCursorSentinel = (): string => RESTORE_CURSOR_SENTINEL

export const getSgrStyleSentinel = (parameters: readonly number[]): string =>
  `${SGR_STYLE_SENTINEL_START}${parameters.join(';')}${SGR_STYLE_SENTINEL_END}`

export const getEraseLineModeFromSentinel = (
  character: string
): 0 | 1 | 2 | null => {
  const index = ERASE_LINE_SENTINELS.indexOf(character)

  if (index === -1) {
    return null
  }

  return index as 0 | 1 | 2
}

export const getEraseDisplayModeFromSentinel = (
  character: string
): 0 | 1 | null => {
  const index = ERASE_DISPLAY_SENTINELS.indexOf(character)

  if (index === -1) {
    return null
  }

  return index as 0 | 1
}

export const isClearScreenSentinel = (character: string): boolean =>
  character === CLEAR_SCREEN_SENTINEL

export const isCursorLeftSentinel = (character: string): boolean =>
  character === CURSOR_LEFT_SENTINEL

export const isCursorRightSentinel = (character: string): boolean =>
  character === CURSOR_RIGHT_SENTINEL

export const isCursorUpSentinel = (character: string): boolean =>
  character === CURSOR_UP_SENTINEL

export const isCursorDownSentinel = (character: string): boolean =>
  character === CURSOR_DOWN_SENTINEL

export const isSaveCursorSentinel = (character: string): boolean =>
  character === SAVE_CURSOR_SENTINEL

export const isRestoreCursorSentinel = (character: string): boolean =>
  character === RESTORE_CURSOR_SENTINEL

export const isCursorHorizontalAbsoluteSentinel = (
  character: string
): boolean => character === CURSOR_HORIZONTAL_ABSOLUTE_SENTINEL_START

export const readCursorPositionSentinel = (
  data: string,
  startIndex: number
): CursorPositionSentinel | null => {
  if (!data.startsWith(CURSOR_POSITION_SENTINEL_START, startIndex)) {
    return null
  }

  const contentStart = startIndex + CURSOR_POSITION_SENTINEL_START.length
  const contentEnd = data.indexOf(CURSOR_POSITION_SENTINEL_END, contentStart)

  if (contentEnd === -1) {
    return null
  }

  const [rowText, columnText] = data.slice(contentStart, contentEnd).split(';')

  if (!/^\d+$/.test(rowText) || !/^\d+$/.test(columnText)) {
    return null
  }

  return {
    row: Number(rowText),
    column: Number(columnText),
    length: contentEnd + CURSOR_POSITION_SENTINEL_END.length - startIndex,
  }
}

export const readCursorHorizontalAbsoluteSentinel = (
  data: string,
  startIndex: number
): CursorHorizontalAbsoluteSentinel | null => {
  if (!data.startsWith(CURSOR_HORIZONTAL_ABSOLUTE_SENTINEL_START, startIndex)) {
    return null
  }

  const contentStart =
    startIndex + CURSOR_HORIZONTAL_ABSOLUTE_SENTINEL_START.length

  const contentEnd = data.indexOf(
    CURSOR_HORIZONTAL_ABSOLUTE_SENTINEL_END,
    contentStart
  )

  if (contentEnd === -1) {
    return null
  }

  const columnText = data.slice(contentStart, contentEnd)

  if (!/^\d+$/.test(columnText)) {
    return null
  }

  return {
    column: Number(columnText),
    length:
      contentEnd +
      CURSOR_HORIZONTAL_ABSOLUTE_SENTINEL_END.length -
      startIndex,
  }
}

const parseSgrParameters = (content: string): readonly number[] | null => {
  if (content.length === 0) {
    return [0]
  }

  const parameters: number[] = []

  for (const parameter of content.split(';')) {
    if (parameter.length === 0) {
      parameters.push(0)
      continue
    }

    if (!/^\d+$/.test(parameter)) {
      return null
    }

    parameters.push(Number(parameter))
  }

  return parameters
}

export const readSgrStyleSentinel = (
  data: string,
  startIndex: number
): SgrStyleSentinel | null => {
  if (!data.startsWith(SGR_STYLE_SENTINEL_START, startIndex)) {
    return null
  }

  const contentStart = startIndex + SGR_STYLE_SENTINEL_START.length
  const contentEnd = data.indexOf(SGR_STYLE_SENTINEL_END, contentStart)

  if (contentEnd === -1) {
    return null
  }

  const parameters = parseSgrParameters(data.slice(contentStart, contentEnd))

  if (!parameters) {
    return null
  }

  return {
    parameters,
    length: contentEnd + SGR_STYLE_SENTINEL_END.length - startIndex,
  }
}

interface SequenceTerminator {
  readonly index: number
  readonly length: number
}

export interface TerminalControlSequenceParserOptions {
  readonly consumeControlsWithoutSubscribers?: boolean
  readonly preserveSgrStyles?: boolean
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

const isEscIntermediateByte = (char: string): boolean => {
  const code = char.charCodeAt(0)

  return code >= 0x20 && code <= 0x2f
}

const isEscFinalByte = (char: string): boolean => {
  const code = char.charCodeAt(0)

  return code >= 0x30 && code <= 0x7e
}

const findEscTerminator = (
  data: string,
  startIndex: number
): SequenceTerminator | null => {
  for (let index = startIndex; index < data.length; index += 1) {
    const char = data[index] ?? ''

    if (isEscFinalByte(char)) {
      return { index, length: 1 }
    }

    if (!isEscIntermediateByte(char)) {
      return { index, length: 0 }
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

const parseCsiIntegerParameter = (
  content: string,
  fallback: number
): number | null => {
  const firstParameter = content.split(';')[0] ?? ''

  if (firstParameter.length === 0) {
    return fallback
  }

  if (!/^\d+$/.test(firstParameter)) {
    return null
  }

  return Number(firstParameter)
}

const parseCsiCursorPosition = (
  content: string
): { readonly row: number; readonly column: number } | null => {
  const parts = content.split(';')
  const rowText = parts[0] ?? ''
  const columnText = parts[1] ?? ''

  if (!/^\d*$/.test(rowText) || !/^\d*$/.test(columnText) || parts.length > 2) {
    return null
  }

  const row = rowText.length === 0 ? 1 : Number(rowText)
  const column = columnText.length === 0 ? 1 : Number(columnText)

  return {
    row: row === 0 ? 1 : row,
    column: column === 0 ? 1 : column,
  }
}

const repeatDisplayControl = (control: string, count: number): string =>
  control.repeat(
    Math.min(Math.max(count, 0), MAX_REPEATED_DISPLAY_CONTROL_COUNT)
  )

const normalizeCursorMovementCount = (count: number): number =>
  count === 0 ? 1 : count

export class TerminalControlSequenceParser implements TerminalParser {
  private readonly handlers = new Set<TerminalParserEventHandler>()
  private pendingControlSequence = ''

  constructor(
    private readonly options: TerminalControlSequenceParserOptions = {}
  ) {}

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
    return this.transformDisplayOutput(data, output).visibleText
  }

  transformDisplayOutput(
    data: string,
    output: TerminalParserOutputContext | null
  ): TerminalControlSequenceOutput {
    if (
      this.handlers.size === 0 &&
      !this.options.consumeControlsWithoutSubscribers
    ) {
      const visible = `${this.pendingControlSequence}${data}`
      this.pendingControlSequence = ''

      return { visibleText: visible }
    }

    const source = `${this.pendingControlSequence}${data}`
    this.pendingControlSequence = ''

    return this.consumeControlSequences(source, output)
  }

  private consumeControlSequences(
    data: string,
    output: TerminalParserOutputContext | null
  ): TerminalControlSequenceOutput {
    let visible = ''
    let display = ''
    let cursor = 0

    while (cursor < data.length) {
      const sequenceStart = data.indexOf(ESC, cursor)

      if (sequenceStart === -1) {
        visible += data.slice(cursor)
        display += data.slice(cursor)
        break
      }

      visible += data.slice(cursor, sequenceStart)
      display += data.slice(cursor, sequenceStart)

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

        const finalByte = data[terminator.index] ?? ''

        if (finalByte === 'K') {
          const content = data.slice(
            sequenceStart + CSI_PREFIX.length,
            terminator.index
          )
          const mode = parseCsiIntegerParameter(content, 0)

          if (mode === 0 || mode === 1 || mode === 2) {
            const sentinel = getEraseLineSentinel(mode)

            visible += sentinel
            display += sentinel
          }
        }

        if (finalByte === 'J') {
          const content = data.slice(
            sequenceStart + CSI_PREFIX.length,
            terminator.index
          )
          const mode = parseCsiIntegerParameter(content, 0)

          if (mode === 0 || mode === 1) {
            const sentinel = getEraseDisplaySentinel(mode)

            visible += sentinel
            display += sentinel
          }

          if (mode === 2) {
            const sentinel = getClearScreenSentinel()

            visible += sentinel
            display += sentinel
          }
        }

        if (finalByte === 'D') {
          const content = data.slice(
            sequenceStart + CSI_PREFIX.length,
            terminator.index
          )
          const count = parseCsiIntegerParameter(content, 1)

          if (count !== null) {
            const normalizedCount = normalizeCursorMovementCount(count)

            const control = repeatDisplayControl(
              getCursorLeftSentinel(),
              normalizedCount
            )

            visible += control
            display += control
          }
        }

        if (finalByte === 'C') {
          const content = data.slice(
            sequenceStart + CSI_PREFIX.length,
            terminator.index
          )
          const count = parseCsiIntegerParameter(content, 1)

          if (count !== null) {
            const normalizedCount = normalizeCursorMovementCount(count)

            const control = repeatDisplayControl(
              getCursorRightSentinel(),
              normalizedCount
            )

            visible += control
            display += control
          }
        }

        if (finalByte === 'G') {
          const content = data.slice(
            sequenceStart + CSI_PREFIX.length,
            terminator.index
          )
          const column = parseCsiIntegerParameter(content, 1)

          if (column !== null) {
            const normalizedColumn = column === 0 ? 1 : column

            const control = getCursorHorizontalAbsoluteSentinel(normalizedColumn)

            visible += control
            display += control
          }
        }

        if (finalByte === 'A') {
          const content = data.slice(
            sequenceStart + CSI_PREFIX.length,
            terminator.index
          )
          const count = parseCsiIntegerParameter(content, 1)

          if (count !== null) {
            const control = repeatDisplayControl(
              getCursorUpSentinel(),
              normalizeCursorMovementCount(count)
            )

            visible += control
            display += control
          }
        }

        if (finalByte === 'B') {
          const content = data.slice(
            sequenceStart + CSI_PREFIX.length,
            terminator.index
          )
          const count = parseCsiIntegerParameter(content, 1)

          if (count !== null) {
            const control = repeatDisplayControl(
              getCursorDownSentinel(),
              normalizeCursorMovementCount(count)
            )

            visible += control
            display += control
          }
        }

        if (finalByte === 'E') {
          const content = data.slice(
            sequenceStart + CSI_PREFIX.length,
            terminator.index
          )
          const count = parseCsiIntegerParameter(content, 1)

          if (count !== null) {
            const control = `${repeatDisplayControl(
              getCursorDownSentinel(),
              normalizeCursorMovementCount(count)
            )}\r`

            visible += control
            display += control
          }
        }

        if (finalByte === 'F') {
          const content = data.slice(
            sequenceStart + CSI_PREFIX.length,
            terminator.index
          )
          const count = parseCsiIntegerParameter(content, 1)

          if (count !== null) {
            const control = `${repeatDisplayControl(
              getCursorUpSentinel(),
              normalizeCursorMovementCount(count)
            )}\r`

            visible += control
            display += control
          }
        }

        if (finalByte === 'H' || finalByte === 'f') {
          const content = data.slice(
            sequenceStart + CSI_PREFIX.length,
            terminator.index
          )
          const position = parseCsiCursorPosition(content)

          if (position) {
            const control = getCursorPositionSentinel(
              position.row,
              position.column
            )

            visible += control
            display += control
          }
        }

        if (finalByte === 's') {
          const content = data.slice(
            sequenceStart + CSI_PREFIX.length,
            terminator.index
          )

          if (content.length === 0) {
            const control = getSaveCursorSentinel()

            visible += control
            display += control
          }
        }

        if (finalByte === 'u') {
          const content = data.slice(
            sequenceStart + CSI_PREFIX.length,
            terminator.index
          )

          if (content.length === 0) {
            const control = getRestoreCursorSentinel()

            visible += control
            display += control
          }
        }

        if (finalByte === 'm' && this.options.preserveSgrStyles) {
          const content = data.slice(
            sequenceStart + CSI_PREFIX.length,
            terminator.index
          )
          const parameters = parseSgrParameters(content)

          if (parameters) {
            display += getSgrStyleSentinel(parameters)
          }
        }

        cursor = terminator.index + terminator.length
        continue
      }

      // A lone ESC at the end of the chunk is likely the prefix of a control
      // sequence split across PTY writes; keep it pending for the next chunk.
      if (sequenceStart + ESC.length >= data.length) {
        this.pendingControlSequence = data.slice(sequenceStart)
        break
      }

      const terminator = findEscTerminator(data, sequenceStart + ESC.length)

      if (!terminator) {
        this.pendingControlSequence = data.slice(sequenceStart)
        break
      }

      cursor = terminator.index + terminator.length

      const escFinalByte = data[terminator.index] ?? ''

      if (escFinalByte === '7') {
        const control = getSaveCursorSentinel()

        visible += control
        display += control
      }

      if (escFinalByte === '8') {
        const control = getRestoreCursorSentinel()

        visible += control
        display += control
      }
    }

    if (
      this.pendingControlSequence.length > MAX_PENDING_CONTROL_SEQUENCE_LENGTH
    ) {
      visible += this.pendingControlSequence
      display += this.pendingControlSequence
      this.pendingControlSequence = ''
    }

    return {
      visibleText: visible,
      displayText: display === visible ? undefined : display,
    }
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
