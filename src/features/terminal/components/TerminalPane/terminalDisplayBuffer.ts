import {
  getEraseDisplayModeFromSentinel,
  getEraseLineModeFromSentinel,
  isClearScreenSentinel,
  isCursorLeftSentinel,
  isCursorRightSentinel,
  isCursorDownSentinel,
  isCursorUpSentinel,
  isRestoreCursorSentinel,
  isSaveCursorSentinel,
  readCursorHorizontalAbsoluteSentinel,
  readCursorPositionSentinel,
  readSgrStyleSentinel,
} from './terminalControlParser'

const DEFAULT_MAX_SCROLLBACK_LINES = 10_000
const MIN_SOFT_WRAP_COLUMNS = 2
const MAX_CURSOR_POSITION_VALUE = 4_096
const CSS_RGB_FUNCTION = 'rgb'
const XTERM_COLOR_CUBE_FIRST_INDEX = 16
const XTERM_COLOR_CUBE_LAST_INDEX = 231
const XTERM_GRAYSCALE_FIRST_INDEX = 232
const XTERM_GRAYSCALE_LAST_INDEX = 255
const XTERM_GRAYSCALE_BASE = 8
const XTERM_GRAYSCALE_STEP = 10

export interface TerminalDisplayStyle {
  readonly background?: string
  readonly bold?: boolean
  readonly dim?: boolean
  readonly foreground?: string
  readonly italic?: boolean
  readonly underline?: boolean
}

export interface TerminalDisplayRun {
  readonly text: string
  readonly style: TerminalDisplayStyle
}

export type TerminalDisplayDeltaOperation =
  | {
      readonly type: 'append'
      readonly text: string
    }
  | {
      readonly type: 'replace'
      readonly text: string
    }

export interface TerminalDisplayDelta {
  readonly operations: readonly TerminalDisplayDeltaOperation[]
}

interface DisplayState {
  readonly text: string
  readonly cursor: number
  readonly cursorRow: number
  readonly pendingCr: boolean
  readonly savedCursor: number | null
  readonly softWrapOffsets: readonly number[]
  readonly style: TerminalDisplayStyle
  readonly runs: readonly TerminalDisplayRun[]
}

interface DisplayCharacterResult {
  readonly text: string
  readonly cursor: number
  readonly runs: readonly TerminalDisplayRun[]
  readonly softWrapOffsets: readonly number[]
}

interface CursorPositionResult extends DisplayCharacterResult {
  readonly cursorRow: number
}

export interface TerminalDisplayBufferOptions {
  readonly columns?: number
  readonly maxScrollbackLines?: number
}

const createEmptyState = (): DisplayState => ({
  text: '',
  cursor: 0,
  cursorRow: 1,
  pendingCr: false,
  savedCursor: null,
  softWrapOffsets: [],
  style: {},
  runs: [],
})

const ANSI_COLOR_NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
] as const

const ANSI_BRIGHT_COLOR_NAMES = [
  'bright-black',
  'bright-red',
  'bright-green',
  'bright-yellow',
  'bright-blue',
  'bright-magenta',
  'bright-cyan',
  'bright-white',
] as const

const isRgbComponent = (value: number | undefined): value is number =>
  value !== undefined && Number.isInteger(value) && value >= 0 && value <= 255

const formatRgbColor = (red: number, green: number, blue: number): string =>
  `${CSS_RGB_FUNCTION}(${red}, ${green}, ${blue})`

const styleWith = (
  style: TerminalDisplayStyle,
  patch: Partial<TerminalDisplayStyle>
): TerminalDisplayStyle => ({
  ...style,
  ...patch,
})

const removeStyleKeys = (
  style: TerminalDisplayStyle,
  keys: readonly (keyof TerminalDisplayStyle)[]
): TerminalDisplayStyle => {
  const next: Partial<TerminalDisplayStyle> = { ...style }

  keys.forEach((key) => {
    delete next[key]
  })

  return next
}

const readAnsiForeground = (code: number): string | null => {
  if (code >= 30 && code <= 37) {
    return `var(--terminal-ansi-${ANSI_COLOR_NAMES[code - 30]})`
  }

  if (code >= 90 && code <= 97) {
    return `var(--terminal-ansi-${ANSI_BRIGHT_COLOR_NAMES[code - 90]})`
  }

  return null
}

const readAnsiBackground = (code: number): string | null => {
  if (code >= 40 && code <= 47) {
    return `var(--terminal-ansi-${ANSI_COLOR_NAMES[code - 40]})`
  }

  if (code >= 100 && code <= 107) {
    return `var(--terminal-ansi-${ANSI_BRIGHT_COLOR_NAMES[code - 100]})`
  }

  return null
}

const readIndexedAnsiColor = (index: number | undefined): string | null => {
  if (
    index === undefined ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > XTERM_GRAYSCALE_LAST_INDEX
  ) {
    return null
  }

  if (index <= 7) {
    return `var(--terminal-ansi-${ANSI_COLOR_NAMES[index]})`
  }

  if (index <= 15) {
    return `var(--terminal-ansi-${ANSI_BRIGHT_COLOR_NAMES[index - 8]})`
  }

  if (index <= XTERM_COLOR_CUBE_LAST_INDEX) {
    const colorIndex = index - XTERM_COLOR_CUBE_FIRST_INDEX
    const colorCubeSteps = [0, 95, 135, 175, 215, 255] as const
    const red = colorCubeSteps[Math.floor(colorIndex / 36)]
    const green = colorCubeSteps[Math.floor((colorIndex % 36) / 6)]
    const blue = colorCubeSteps[colorIndex % 6]

    return formatRgbColor(red, green, blue)
  }

  const level =
    XTERM_GRAYSCALE_BASE +
    (index - XTERM_GRAYSCALE_FIRST_INDEX) * XTERM_GRAYSCALE_STEP

  return formatRgbColor(level, level, level)
}

const applySgrStyle = (
  style: TerminalDisplayStyle,
  parameters: readonly number[]
): TerminalDisplayStyle => {
  let next = style
  let index = 0

  while (index < parameters.length) {
    const parameter = parameters[index] ?? 0

    if (parameter === 0) {
      next = {}
      index += 1
      continue
    }

    if (parameter === 1) {
      next = styleWith(next, { bold: true })
      index += 1
      continue
    }

    if (parameter === 2) {
      next = styleWith(next, { dim: true })
      index += 1
      continue
    }

    if (parameter === 3) {
      next = styleWith(next, { italic: true })
      index += 1
      continue
    }

    if (parameter === 4) {
      next = styleWith(next, { underline: true })
      index += 1
      continue
    }

    if (parameter === 22) {
      next = removeStyleKeys(next, ['bold', 'dim'])
      index += 1
      continue
    }

    if (parameter === 23) {
      next = removeStyleKeys(next, ['italic'])
      index += 1
      continue
    }

    if (parameter === 24) {
      next = removeStyleKeys(next, ['underline'])
      index += 1
      continue
    }

    if (parameter === 39) {
      next = removeStyleKeys(next, ['foreground'])
      index += 1
      continue
    }

    if (parameter === 49) {
      next = removeStyleKeys(next, ['background'])
      index += 1
      continue
    }

    const ansiForeground = readAnsiForeground(parameter)

    if (ansiForeground) {
      next = styleWith(next, { foreground: ansiForeground })
      index += 1
      continue
    }

    const ansiBackground = readAnsiBackground(parameter)

    if (ansiBackground) {
      next = styleWith(next, { background: ansiBackground })
      index += 1
      continue
    }

    const colorMode = parameters[index + 1]

    if ((parameter === 38 || parameter === 48) && colorMode === 2) {
      const red = parameters[index + 2]
      const green = parameters[index + 3]
      const blue = parameters[index + 4]

      if (
        isRgbComponent(red) &&
        isRgbComponent(green) &&
        isRgbComponent(blue)
      ) {
        const color = formatRgbColor(red, green, blue)

        next =
          parameter === 38
            ? styleWith(next, { foreground: color })
            : styleWith(next, { background: color })
      }
      index += 5
      continue
    }

    if ((parameter === 38 || parameter === 48) && colorMode === 5) {
      const color = readIndexedAnsiColor(parameters[index + 2])

      if (color) {
        next =
          parameter === 38
            ? styleWith(next, { foreground: color })
            : styleWith(next, { background: color })
      }
      index += 3
      continue
    }

    index += 1
  }

  return next
}

const areStylesEqual = (
  left: TerminalDisplayStyle,
  right: TerminalDisplayStyle
): boolean =>
  left.background === right.background &&
  left.bold === right.bold &&
  left.dim === right.dim &&
  left.foreground === right.foreground &&
  left.italic === right.italic &&
  left.underline === right.underline

const findLineStart = (text: string, cursor: number): number => {
  if (cursor <= 0) {
    return 0
  }

  return text.lastIndexOf('\n', cursor - 1) + 1
}

const findLineEnd = (text: string, cursor: number): number => {
  const nextNewline = text.indexOf('\n', cursor)

  return nextNewline === -1 ? text.length : nextNewline
}

const readCodePointLength = (text: string, cursor: number): number =>
  (text.codePointAt(cursor) ?? 0) > 0xffff ? 2 : 1

const readPreviousCodePointLength = (text: string, cursor: number): number => {
  if (cursor <= 0) {
    return 0
  }

  const previous = text.charCodeAt(cursor - 1)
  const beforePrevious = cursor >= 2 ? text.charCodeAt(cursor - 2) : 0

  if (
    previous >= 0xdc00 &&
    previous <= 0xdfff &&
    beforePrevious >= 0xd800 &&
    beforePrevious <= 0xdbff
  ) {
    return 2
  }

  return 1
}

const isCombiningCodePoint = (codePoint: number): boolean =>
  (codePoint >= 0x0300 && codePoint <= 0x036f) ||
  (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
  (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
  (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
  (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
  (codePoint >= 0xfe20 && codePoint <= 0xfe2f)

const isPrivateUseCodePoint = (codePoint: number): boolean =>
  (codePoint >= 0xe000 && codePoint <= 0xf8ff) ||
  (codePoint >= 0xf0000 && codePoint <= 0xffffd) ||
  (codePoint >= 0x100000 && codePoint <= 0x10fffd)

const isWideCodePoint = (codePoint: number): boolean =>
  (codePoint >= 0x1100 && codePoint <= 0x115f) ||
  codePoint === 0x2329 ||
  codePoint === 0x232a ||
  (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
  (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
  (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
  (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
  (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
  (codePoint >= 0xff00 && codePoint <= 0xff60) ||
  (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
  (codePoint >= 0x1f300 && codePoint <= 0x1faff)

const readTerminalCellWidth = (text: string, cursor: number): number => {
  const codePoint = text.codePointAt(cursor)

  if (codePoint === undefined || codePoint === 0 || codePoint === 0x0a) {
    return 0
  }

  if (isCombiningCodePoint(codePoint)) {
    return 0
  }

  if (isPrivateUseCodePoint(codePoint)) {
    return 1
  }

  return isWideCodePoint(codePoint) ? 2 : 1
}

const readCellWidth = (text: string, start: number, end: number): number => {
  let width = 0
  let cursor = start

  while (cursor < end) {
    width += readTerminalCellWidth(text, cursor)
    cursor += readCodePointLength(text, cursor)
  }

  return width
}

const findOffsetForCellColumn = (
  text: string,
  lineStart: number,
  lineEnd: number,
  targetColumn: number
): number => {
  if (targetColumn <= 0) {
    return lineStart
  }

  let cursor = lineStart
  let column = 0

  while (cursor < lineEnd) {
    const width = readTerminalCellWidth(text, cursor)
    const nextColumn = column + width

    if (nextColumn > targetColumn) {
      return cursor
    }

    if (nextColumn === targetColumn) {
      return cursor + readCodePointLength(text, cursor)
    }

    column = nextColumn
    cursor += readCodePointLength(text, cursor)
  }

  return lineEnd
}

const findOffsetForChaColumn = (
  text: string,
  lineStart: number,
  lineEnd: number,
  targetColumn: number
): number => {
  let cursor = lineStart
  let column = 0

  while (cursor < lineEnd) {
    const width = readTerminalCellWidth(text, cursor)
    const nextColumn = column + width

    if (nextColumn > targetColumn) {
      return cursor
    }

    if (nextColumn === targetColumn) {
      return cursor + readCodePointLength(text, cursor)
    }

    column = nextColumn
    cursor += readCodePointLength(text, cursor)
  }

  return lineEnd
}

const readCursorColumn = (text: string, cursor: number): number =>
  readCellWidth(text, findLineStart(text, cursor), cursor)

const readCursorRow = (text: string, cursor: number): number => {
  let row = 1

  for (let index = 0; index < cursor; index += 1) {
    if (text[index] === '\n') {
      row += 1
    }
  }

  return row
}

const moveCursorUp = (text: string, cursor: number): number => {
  const currentLineStart = findLineStart(text, cursor)

  if (currentLineStart === 0) {
    return Math.min(cursor, findLineEnd(text, cursor))
  }

  const column = readCursorColumn(text, cursor)
  const previousLineEnd = currentLineStart - 1
  const previousLineStart = findLineStart(text, previousLineEnd)

  return findOffsetForCellColumn(
    text,
    previousLineStart,
    previousLineEnd,
    column
  )
}

const moveCursorDown = (text: string, cursor: number): number => {
  const column = readCursorColumn(text, cursor)
  const currentLineEnd = findLineEnd(text, cursor)

  if (currentLineEnd >= text.length) {
    return Math.min(cursor, currentLineEnd)
  }

  const nextLineStart = currentLineEnd + 1
  const nextLineEnd = findLineEnd(text, nextLineStart)

  return findOffsetForCellColumn(text, nextLineStart, nextLineEnd, column)
}

const normalizeCursorPositionValue = (value: number): number =>
  Math.min(Math.max(value, 1), MAX_CURSOR_POSITION_VALUE)

const normalizeSoftWrapColumns = (columns: number): number =>
  Math.max(MIN_SOFT_WRAP_COLUMNS, Math.floor(columns))

const updateSoftWrapOffsetsForEdit = (
  softWrapOffsets: readonly number[],
  startOffset: number,
  removedLength: number,
  insertedLength: number
): readonly number[] => {
  const endOffset = startOffset + removedLength
  const delta = insertedLength - removedLength

  return softWrapOffsets.flatMap((offset) => {
    if (offset >= startOffset && offset < endOffset) {
      return []
    }

    if (offset >= endOffset) {
      return [offset + delta]
    }

    return [offset]
  })
}

const isSoftWrapOffset = (
  softWrapOffsets: readonly number[],
  offset: number
): boolean => softWrapOffsets.includes(offset)

interface CursorLeftResult {
  readonly cursor: number
  readonly rowDelta: number
}

const moveCursorLeft = (
  text: string,
  cursor: number,
  softWrapOffsets: readonly number[]
): CursorLeftResult => {
  const lineStart = findLineStart(text, cursor)

  if (cursor > lineStart) {
    return {
      cursor: cursor - readPreviousCodePointLength(text, cursor),
      rowDelta: 0,
    }
  }

  const previousNewline = cursor - 1

  if (
    previousNewline <= 0 ||
    !isSoftWrapOffset(softWrapOffsets, previousNewline)
  ) {
    return { cursor: lineStart, rowDelta: 0 }
  }

  return {
    cursor: Math.max(
      findLineStart(text, previousNewline),
      previousNewline - readPreviousCodePointLength(text, previousNewline)
    ),
    rowDelta: -1,
  }
}

const moveCursorRight = (text: string, cursor: number): number => {
  const lineStart = findLineStart(text, cursor)
  const lineEnd = findLineEnd(text, cursor)

  if (cursor >= lineEnd) {
    return lineEnd
  }

  return findOffsetForCellColumn(
    text,
    lineStart,
    lineEnd,
    readCursorColumn(text, cursor) + 1
  )
}

const moveCursorToPosition = (
  text: string,
  runs: readonly TerminalDisplayRun[],
  softWrapOffsets: readonly number[],
  row: number,
  column: number,
  style: TerminalDisplayStyle
): CursorPositionResult => {
  const targetRow = normalizeCursorPositionValue(row)
  const targetColumn = normalizeCursorPositionValue(column)
  let nextText = text
  let nextRuns = runs
  let nextSoftWrapOffsets = softWrapOffsets
  let cursor = 0
  let currentRow = 1

  while (currentRow < targetRow) {
    const lineEnd = findLineEnd(nextText, cursor)

    if (lineEnd < nextText.length) {
      cursor = lineEnd + 1
    } else {
      nextRuns = insertRunText(nextRuns, nextText.length, '\n', style)
      nextSoftWrapOffsets = updateSoftWrapOffsetsForEdit(
        nextSoftWrapOffsets,
        nextText.length,
        0,
        1
      )
      nextText = `${nextText}\n`
      cursor = nextText.length
    }

    currentRow += 1
  }

  const lineEnd = findLineEnd(nextText, cursor)
  const targetCellColumn = targetColumn - 1
  const lineCellWidth = readCellWidth(nextText, cursor, lineEnd)
  let targetCursor = findOffsetForCellColumn(
    nextText,
    cursor,
    lineEnd,
    targetCellColumn
  )

  if (targetCellColumn > lineCellWidth) {
    const padding = ' '.repeat(targetCellColumn - lineCellWidth)

    nextRuns = insertRunText(nextRuns, lineEnd, padding, style)
    nextSoftWrapOffsets = updateSoftWrapOffsetsForEdit(
      nextSoftWrapOffsets,
      lineEnd,
      0,
      padding.length
    )

    nextText = `${nextText.slice(0, lineEnd)}${padding}${nextText.slice(
      lineEnd
    )}`
    targetCursor = lineEnd + padding.length
  }

  return {
    text: nextText,
    cursor: targetCursor,
    cursorRow: currentRow,
    runs: nextRuns,
    softWrapOffsets: nextSoftWrapOffsets,
  }
}

const moveCursorToHorizontalAbsoluteColumn = (
  text: string,
  runs: readonly TerminalDisplayRun[],
  softWrapOffsets: readonly number[],
  row: number,
  column: number,
  style: TerminalDisplayStyle
): CursorPositionResult => {
  const targetRow = normalizeCursorPositionValue(row)
  const targetColumn = normalizeCursorPositionValue(column)
  let nextText = text
  let nextRuns = runs
  let nextSoftWrapOffsets = softWrapOffsets
  let cursor = 0
  let currentRow = 1

  while (currentRow < targetRow) {
    const lineEnd = findLineEnd(nextText, cursor)

    if (lineEnd < nextText.length) {
      cursor = lineEnd + 1
    } else {
      nextRuns = insertRunText(nextRuns, nextText.length, '\n', style)
      nextSoftWrapOffsets = updateSoftWrapOffsetsForEdit(
        nextSoftWrapOffsets,
        nextText.length,
        0,
        1
      )
      nextText = `${nextText}\n`
      cursor = nextText.length
    }

    currentRow += 1
  }

  const lineEnd = findLineEnd(nextText, cursor)
  const targetCellColumn = targetColumn - 1
  const lineCellWidth = readCellWidth(nextText, cursor, lineEnd)
  let targetCursor = findOffsetForChaColumn(
    nextText,
    cursor,
    lineEnd,
    targetCellColumn
  )

  if (targetCellColumn > lineCellWidth) {
    const padding = ' '.repeat(targetCellColumn - lineCellWidth)

    nextRuns = insertRunText(nextRuns, lineEnd, padding, style)
    nextSoftWrapOffsets = updateSoftWrapOffsetsForEdit(
      nextSoftWrapOffsets,
      lineEnd,
      0,
      padding.length
    )

    nextText = `${nextText.slice(0, lineEnd)}${padding}${nextText.slice(
      lineEnd
    )}`
    targetCursor = lineEnd + padding.length
  }

  return {
    text: nextText,
    cursor: targetCursor,
    cursorRow: currentRow,
    runs: nextRuns,
    softWrapOffsets: nextSoftWrapOffsets,
  }
}

const softWrapAtCursor = (
  text: string,
  runs: readonly TerminalDisplayRun[],
  softWrapOffsets: readonly number[],
  cursor: number,
  style: TerminalDisplayStyle,
  columns: number | null,
  character: string
): DisplayCharacterResult => {
  if (columns === null) {
    return { text, cursor, runs, softWrapOffsets }
  }

  const lineStart = findLineStart(text, cursor)
  const lineCellWidth = readCellWidth(text, lineStart, cursor)

  if (
    cursor <= lineStart ||
    lineCellWidth + readTerminalCellWidth(character, 0) <= columns
  ) {
    return { text, cursor, runs, softWrapOffsets }
  }

  if (text[cursor] === '\n') {
    return { text, cursor: cursor + 1, runs, softWrapOffsets }
  }

  const newText = `${text.slice(0, cursor)}\n${text.slice(cursor)}`

  const shiftedSoftWrapOffsets = updateSoftWrapOffsetsForEdit(
    softWrapOffsets,
    cursor,
    0,
    1
  )

  return {
    text: newText,
    cursor: cursor + 1,
    runs: insertRunText(runs, cursor, '\n', style),
    softWrapOffsets: [...shiftedSoftWrapOffsets, cursor].sort(
      (left, right) => left - right
    ),
  }
}

const findRunAtOffset = (
  runs: readonly TerminalDisplayRun[],
  offset: number
): { runIndex: number; runOffset: number } => {
  let current = 0

  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]

    if (offset < current + run.text.length) {
      return { runIndex: index, runOffset: offset - current }
    }

    current += run.text.length
  }

  return { runIndex: runs.length, runOffset: 0 }
}

const mergeAdjacentRuns = (
  runs: readonly TerminalDisplayRun[]
): TerminalDisplayRun[] => {
  const merged: TerminalDisplayRun[] = []
  let current: TerminalDisplayRun | undefined

  for (const run of runs) {
    if (run.text.length === 0) {
      continue
    }

    if (current && areStylesEqual(current.style, run.style)) {
      current = { text: current.text + run.text, style: run.style }
    } else {
      if (current) {
        merged.push(current)
      }
      current = run
    }
  }

  if (current) {
    merged.push(current)
  }

  return merged
}

const insertRunText = (
  runs: readonly TerminalDisplayRun[],
  offset: number,
  text: string,
  style: TerminalDisplayStyle
): TerminalDisplayRun[] => {
  if (runs.length === 0) {
    return [{ text, style }]
  }

  const totalLength = runs.reduce((sum, run) => sum + run.text.length, 0)

  if (offset >= totalLength) {
    const last = runs[runs.length - 1]

    if (areStylesEqual(last.style, style)) {
      const newRuns = [...runs]
      newRuns[newRuns.length - 1] = { text: last.text + text, style }

      return newRuns
    }

    return [...runs, { text, style }]
  }

  const { runIndex, runOffset } = findRunAtOffset(runs, offset)
  const run = runs[runIndex]
  const before = run.text.slice(0, runOffset)
  const after = run.text.slice(runOffset)
  const replacement: TerminalDisplayRun[] = []

  if (before.length > 0) {
    replacement.push({ text: before, style: run.style })
  }

  replacement.push({ text, style })

  if (after.length > 0) {
    replacement.push({ text: after, style: run.style })
  }

  const newRuns = [...runs]
  newRuns.splice(runIndex, 1, ...replacement)

  return mergeAdjacentRuns(newRuns)
}

const replaceRunText = (
  runs: readonly TerminalDisplayRun[],
  offset: number,
  length: number,
  text: string,
  style: TerminalDisplayStyle
): TerminalDisplayRun[] => {
  const { runIndex, runOffset } = findRunAtOffset(runs, offset)

  if (runIndex >= runs.length) {
    return [...runs, { text, style }]
  }

  const run = runs[runIndex]
  const before = run.text.slice(0, runOffset)
  const after = run.text.slice(runOffset + length)
  const replacement: TerminalDisplayRun[] = []

  if (before.length > 0) {
    replacement.push({ text: before, style: run.style })
  }

  replacement.push({ text, style })

  if (after.length > 0) {
    replacement.push({ text: after, style: run.style })
  }

  const newRuns = [...runs]
  newRuns.splice(runIndex, 1, ...replacement)

  return mergeAdjacentRuns(newRuns)
}

const spliceRuns = (
  runs: readonly TerminalDisplayRun[],
  startOffset: number,
  endOffset: number
): TerminalDisplayRun[] => {
  if (startOffset >= endOffset) {
    return [...runs]
  }

  const start = findRunAtOffset(runs, startOffset)
  const end = findRunAtOffset(runs, endOffset)
  const newRuns: TerminalDisplayRun[] = []

  newRuns.push(...runs.slice(0, start.runIndex))

  if (start.runIndex === end.runIndex) {
    if (start.runIndex < runs.length) {
      const run = runs[start.runIndex]
      const before = run.text.slice(0, start.runOffset)
      const after = run.text.slice(end.runOffset)

      if (before.length > 0) {
        newRuns.push({ text: before, style: run.style })
      }

      if (after.length > 0) {
        newRuns.push({ text: after, style: run.style })
      }
    }
  } else {
    if (start.runIndex < runs.length) {
      const startRun = runs[start.runIndex]
      const beforeStart = startRun.text.slice(0, start.runOffset)

      if (beforeStart.length > 0) {
        newRuns.push({ text: beforeStart, style: startRun.style })
      }
    }

    if (end.runIndex < runs.length) {
      const endRun = runs[end.runIndex]
      const afterEnd = endRun.text.slice(end.runOffset)

      if (afterEnd.length > 0) {
        newRuns.push({ text: afterEnd, style: endRun.style })
      }
    }
  }

  newRuns.push(...runs.slice(end.runIndex + 1))

  return mergeAdjacentRuns(newRuns)
}

const writeDisplayCharacter = (
  text: string,
  runs: readonly TerminalDisplayRun[],
  softWrapOffsets: readonly number[],
  cursor: number,
  character: string,
  style: TerminalDisplayStyle
): DisplayCharacterResult => {
  if (cursor < text.length && text[cursor] !== '\n') {
    const nextLength = readCodePointLength(text, cursor)

    const newText = `${text.slice(0, cursor)}${character}${text.slice(
      cursor + nextLength
    )}`

    return {
      text: newText,
      cursor: cursor + character.length,
      runs: replaceRunText(runs, cursor, nextLength, character, style),
      softWrapOffsets: updateSoftWrapOffsetsForEdit(
        softWrapOffsets,
        cursor,
        nextLength,
        character.length
      ),
    }
  }

  const newText = `${text.slice(0, cursor)}${character}${text.slice(cursor)}`

  return {
    text: newText,
    cursor: cursor + character.length,
    runs: insertRunText(runs, cursor, character, style),
    softWrapOffsets: updateSoftWrapOffsetsForEdit(
      softWrapOffsets,
      cursor,
      0,
      character.length
    ),
  }
}

const eraseLineInState = (
  state: DisplayState,
  mode: 0 | 1 | 2
): DisplayState => {
  const text = state.text
  const cursor = state.cursor
  const lineStart = findLineStart(text, cursor)
  const lineEnd = findLineEnd(text, cursor)

  if (mode === 0) {
    const newText = `${text.slice(0, cursor)}${text.slice(lineEnd)}`

    return {
      ...state,
      text: newText,
      cursorRow: readCursorRow(newText, cursor),
      runs: spliceRuns(state.runs, cursor, lineEnd),
      softWrapOffsets: updateSoftWrapOffsetsForEdit(
        state.softWrapOffsets,
        cursor,
        lineEnd - cursor,
        0
      ),
    }
  }

  if (mode === 1) {
    const cursorCodePointLength = readCodePointLength(text, cursor)

    const newText = `${text.slice(0, lineStart)}${text.slice(
      cursor + cursorCodePointLength
    )}`

    return {
      ...state,
      text: newText,
      cursor: lineStart,
      cursorRow: readCursorRow(newText, lineStart),
      runs: spliceRuns(state.runs, lineStart, cursor + cursorCodePointLength),
      softWrapOffsets: updateSoftWrapOffsetsForEdit(
        state.softWrapOffsets,
        lineStart,
        cursor + cursorCodePointLength - lineStart,
        0
      ),
    }
  }

  const newText = `${text.slice(0, lineStart)}${text.slice(lineEnd)}`

  return {
    ...state,
    text: newText,
    cursor: lineStart,
    cursorRow: readCursorRow(newText, lineStart),
    runs: spliceRuns(state.runs, lineStart, lineEnd),
    softWrapOffsets: updateSoftWrapOffsetsForEdit(
      state.softWrapOffsets,
      lineStart,
      lineEnd - lineStart,
      0
    ),
  }
}

const eraseDisplayInState = (
  state: DisplayState,
  mode: 0 | 1
): DisplayState => {
  const text = state.text
  const cursor = state.cursor

  if (mode === 0) {
    return {
      ...state,
      text: text.slice(0, cursor),
      cursorRow: state.cursorRow,
      runs: spliceRuns(state.runs, cursor, text.length),
      softWrapOffsets: updateSoftWrapOffsetsForEdit(
        state.softWrapOffsets,
        cursor,
        text.length - cursor,
        0
      ),
    }
  }

  const cursorCodePointLength = readCodePointLength(text, cursor)
  const endOffset = Math.min(text.length, cursor + cursorCodePointLength)

  return {
    ...state,
    text: text.slice(endOffset),
    cursor: 0,
    cursorRow: 1,
    savedCursor:
      state.savedCursor === null
        ? null
        : Math.max(0, state.savedCursor - endOffset),
    runs: spliceRuns(state.runs, 0, endOffset),
    softWrapOffsets: updateSoftWrapOffsetsForEdit(
      state.softWrapOffsets,
      0,
      endOffset,
      0
    ),
  }
}

const applyDisplayData = (
  state: DisplayState,
  data: string,
  columns: number | null
): DisplayState => {
  let text = state.text
  let cursor = Math.min(Math.max(state.cursor, 0), text.length)
  let cursorRow = state.cursorRow
  let pendingCr = state.pendingCr
  let savedCursor = state.savedCursor
  let softWrapOffsets = state.softWrapOffsets
  let style = state.style
  let runs = state.runs
  let index = 0

  while (index < data.length) {
    const styleControl = readSgrStyleSentinel(data, index)

    if (styleControl) {
      style = applySgrStyle(style, styleControl.parameters)
      index += styleControl.length
      continue
    }

    const cursorPositionControl = readCursorPositionSentinel(data, index)

    if (cursorPositionControl) {
      const next = moveCursorToPosition(
        text,
        runs,
        softWrapOffsets,
        cursorPositionControl.row,
        cursorPositionControl.column,
        style
      )

      text = next.text
      runs = next.runs
      softWrapOffsets = next.softWrapOffsets
      cursor = next.cursor
      cursorRow = next.cursorRow
      pendingCr = false
      index += cursorPositionControl.length
      continue
    }

    const cursorHorizontalAbsoluteControl =
      readCursorHorizontalAbsoluteSentinel(data, index)

    if (cursorHorizontalAbsoluteControl) {
      const next = moveCursorToHorizontalAbsoluteColumn(
        text,
        runs,
        softWrapOffsets,
        cursorRow,
        cursorHorizontalAbsoluteControl.column,
        style
      )

      text = next.text
      runs = next.runs
      softWrapOffsets = next.softWrapOffsets
      cursor = next.cursor
      cursorRow = next.cursorRow
      pendingCr = false
      index += cursorHorizontalAbsoluteControl.length
      continue
    }

    const characterLength = readCodePointLength(data, index)
    const character = data.slice(index, index + characterLength)
    const eraseDisplayMode = getEraseDisplayModeFromSentinel(character)
    const eraseLineMode = getEraseLineModeFromSentinel(character)

    index += characterLength

    if (eraseDisplayMode !== null) {
      const nextState = eraseDisplayInState(
        {
          text,
          cursor,
          cursorRow,
          pendingCr,
          savedCursor,
          softWrapOffsets,
          style,
          runs,
        },
        eraseDisplayMode
      )
      text = nextState.text
      runs = nextState.runs
      cursor = nextState.cursor
      cursorRow = nextState.cursorRow
      savedCursor = nextState.savedCursor
      softWrapOffsets = nextState.softWrapOffsets
      pendingCr = false
      continue
    }

    if (eraseLineMode !== null) {
      const nextState = eraseLineInState(
        {
          text,
          cursor,
          cursorRow,
          pendingCr,
          savedCursor,
          softWrapOffsets,
          style,
          runs,
        },
        eraseLineMode
      )
      text = nextState.text
      runs = nextState.runs
      cursor = nextState.cursor
      cursorRow = nextState.cursorRow
      savedCursor = nextState.savedCursor
      softWrapOffsets = nextState.softWrapOffsets
      pendingCr = false
      continue
    }

    if (isClearScreenSentinel(character)) {
      text = ''
      runs = []
      cursor = 0
      cursorRow = 1
      savedCursor = null
      softWrapOffsets = []
      pendingCr = false
      continue
    }

    if (isCursorLeftSentinel(character)) {
      const left = moveCursorLeft(text, cursor, softWrapOffsets)
      cursor = left.cursor
      cursorRow += left.rowDelta
      pendingCr = false
      continue
    }

    if (isCursorRightSentinel(character)) {
      cursor = moveCursorRight(text, cursor)
      pendingCr = false
      continue
    }

    if (isCursorUpSentinel(character)) {
      cursor = moveCursorUp(text, cursor)
      cursorRow = readCursorRow(text, cursor)
      pendingCr = false
      continue
    }

    if (isCursorDownSentinel(character)) {
      const currentLineEnd = findLineEnd(text, cursor)

      if (currentLineEnd >= text.length) {
        const next = moveCursorToPosition(
          text,
          runs,
          softWrapOffsets,
          cursorRow + 1,
          readCursorColumn(text, cursor) + 1,
          style
        )

        text = next.text
        runs = next.runs
        softWrapOffsets = next.softWrapOffsets
        cursor = next.cursor
        cursorRow = next.cursorRow
      } else {
        cursor = moveCursorDown(text, cursor)
        cursorRow += 1
      }

      pendingCr = false
      continue
    }

    if (isSaveCursorSentinel(character)) {
      savedCursor = cursor
      pendingCr = false
      continue
    }

    if (isRestoreCursorSentinel(character)) {
      cursor = Math.min(savedCursor ?? cursor, text.length)
      cursorRow = readCursorRow(text, cursor)
      pendingCr = false
      continue
    }

    if (character === '\r') {
      cursor = findLineStart(text, cursor)
      pendingCr = true
      continue
    }

    if (character === '\n') {
      if (pendingCr) {
        cursor = findLineEnd(text, cursor)
      }

      const lineEnd = findLineEnd(text, cursor)

      if (lineEnd < text.length) {
        cursor = lineEnd + 1
        cursorRow += 1
        pendingCr = false
        continue
      }

      text = `${text.slice(0, cursor)}\n${text.slice(cursor)}`
      runs = insertRunText(runs, cursor, '\n', style)
      softWrapOffsets = updateSoftWrapOffsetsForEdit(
        softWrapOffsets,
        cursor,
        0,
        1
      )
      cursor += 1
      cursorRow += 1
      pendingCr = false
      continue
    }

    if (character === '\b') {
      const left = moveCursorLeft(text, cursor, softWrapOffsets)
      cursor = left.cursor
      cursorRow += left.rowDelta
      pendingCr = false
      continue
    }

    const wrapped = softWrapAtCursor(
      text,
      runs,
      softWrapOffsets,
      cursor,
      style,
      columns,
      character
    )

    if (wrapped.cursor !== cursor) {
      cursorRow += 1
    }

    text = wrapped.text
    runs = wrapped.runs
    softWrapOffsets = wrapped.softWrapOffsets
    cursor = wrapped.cursor

    const next = writeDisplayCharacter(
      text,
      runs,
      softWrapOffsets,
      cursor,
      character,
      style
    )
    text = next.text
    runs = next.runs
    softWrapOffsets = next.softWrapOffsets
    cursor = next.cursor
    pendingCr = false
  }

  return {
    text,
    cursor,
    cursorRow,
    pendingCr,
    savedCursor,
    softWrapOffsets,
    style,
    runs,
  }
}

const trimScrollbackLines = (
  state: DisplayState,
  maxScrollbackLines: number
): DisplayState => {
  const text = state.text
  const lines = text.split('\n')

  if (lines.length <= maxScrollbackLines) {
    return state
  }

  const firstKeptLine = lines.length - maxScrollbackLines
  const removedText = `${lines.slice(0, firstKeptLine).join('\n')}\n`
  let remaining = removedText.length
  const newRuns: TerminalDisplayRun[] = []

  for (const run of state.runs) {
    if (remaining <= 0) {
      newRuns.push(run)
    } else if (remaining >= run.text.length) {
      remaining -= run.text.length
    } else {
      newRuns.push({ text: run.text.slice(remaining), style: run.style })
      remaining = 0
    }
  }

  const newText = text.slice(removedText.length)
  const newCursor = Math.max(0, state.cursor - removedText.length)

  return {
    text: newText,
    cursor: newCursor,
    cursorRow: readCursorRow(newText, newCursor),
    pendingCr: state.pendingCr,
    savedCursor:
      state.savedCursor === null
        ? null
        : Math.max(0, state.savedCursor - removedText.length),
    softWrapOffsets: state.softWrapOffsets.flatMap((offset) =>
      offset >= removedText.length ? [offset - removedText.length] : []
    ),
    style: state.style,
    runs: newRuns,
  }
}

export class TerminalDisplayBuffer {
  private state = createEmptyState()
  private columns: number | null
  private readonly maxScrollbackLines: number

  constructor(options: TerminalDisplayBufferOptions = {}) {
    this.columns =
      options.columns === undefined
        ? null
        : normalizeSoftWrapColumns(options.columns)

    this.maxScrollbackLines =
      options.maxScrollbackLines ?? DEFAULT_MAX_SCROLLBACK_LINES
  }

  setColumns(columns: number): void {
    this.columns = normalizeSoftWrapColumns(columns)
  }

  clear(): void {
    this.state = createEmptyState()
  }

  replace(data: string): void {
    this.clear()
    this.write(data)
  }

  write(data: string): void {
    if (data.length === 0) {
      return
    }

    this.state = trimScrollbackLines(
      applyDisplayData(this.state, data, this.columns),
      this.maxScrollbackLines
    )
  }

  applyDelta(delta: TerminalDisplayDelta): void {
    delta.operations.forEach((operation) => {
      if (operation.type === 'replace') {
        this.replace(operation.text)

        return
      }

      this.write(operation.text)
    })
  }

  readText(): string {
    return this.state.text
  }

  readCursorOffset(): number {
    return this.state.cursor
  }

  readStyledRuns(): readonly TerminalDisplayRun[] {
    return this.state.runs
  }

  readVisibleText(): string {
    return this.readText().replace(/\n+$/, '')
  }
}
