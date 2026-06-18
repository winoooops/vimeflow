import {
  getEraseLineModeFromSentinel,
  isClearScreenSentinel,
  isCursorLeftSentinel,
  isCursorRightSentinel,
  readSgrStyleSentinel,
} from './terminalControlParser'

const DEFAULT_MAX_SCROLLBACK_LINES = 10_000
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

interface DisplayState {
  readonly text: string
  readonly cursor: number
  readonly pendingCr: boolean
  readonly style: TerminalDisplayStyle
  readonly styles: readonly TerminalDisplayStyle[]
}

interface DisplayCharacterResult {
  readonly text: string
  readonly cursor: number
  readonly styles: TerminalDisplayStyle[]
}

export interface TerminalDisplayBufferOptions {
  readonly maxScrollbackLines?: number
}

const createEmptyState = (): DisplayState => ({
  text: '',
  cursor: 0,
  pendingCr: false,
  style: {},
  styles: [],
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

  if (index >= XTERM_GRAYSCALE_FIRST_INDEX) {
    const level =
      XTERM_GRAYSCALE_BASE +
      (index - XTERM_GRAYSCALE_FIRST_INDEX) * XTERM_GRAYSCALE_STEP

    return formatRgbColor(level, level, level)
  }

  return null
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
        index += 5
        continue
      }
    }

    if ((parameter === 38 || parameter === 48) && colorMode === 5) {
      const color = readIndexedAnsiColor(parameters[index + 2])

      if (color) {
        next =
          parameter === 38
            ? styleWith(next, { foreground: color })
            : styleWith(next, { background: color })
        index += 3
        continue
      }
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

const createStyleCells = (
  length: number,
  style: TerminalDisplayStyle
): TerminalDisplayStyle[] => Array.from({ length }, () => style)

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

const writeDisplayCharacter = (
  text: string,
  styles: TerminalDisplayStyle[],
  cursor: number,
  character: string,
  style: TerminalDisplayStyle
): DisplayCharacterResult => {
  const characterStyles = createStyleCells(character.length, style)

  if (cursor < text.length && text[cursor] !== '\n') {
    const nextLength = readCodePointLength(text, cursor)
    styles.splice(cursor, nextLength, ...characterStyles)

    return {
      text: `${text.slice(0, cursor)}${character}${text.slice(
        cursor + nextLength
      )}`,
      cursor: cursor + character.length,
      styles,
    }
  }

  styles.splice(cursor, 0, ...characterStyles)

  return {
    text: `${text.slice(0, cursor)}${character}${text.slice(cursor)}`,
    cursor: cursor + character.length,
    styles,
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
    return {
      ...state,
      text: `${text.slice(0, cursor)}${text.slice(lineEnd)}`,
      styles: [
        ...state.styles.slice(0, cursor),
        ...state.styles.slice(lineEnd),
      ],
    }
  }

  if (mode === 1) {
    const cursorCodePointLength = readCodePointLength(text, cursor)

    return {
      ...state,
      text: `${text.slice(0, lineStart)}${text.slice(cursor + cursorCodePointLength)}`,
      cursor: lineStart,
      styles: [
        ...state.styles.slice(0, lineStart),
        ...state.styles.slice(cursor + cursorCodePointLength),
      ],
    }
  }

  return {
    ...state,
    text: `${text.slice(0, lineStart)}${text.slice(lineEnd)}`,
    cursor: lineStart,
    styles: [
      ...state.styles.slice(0, lineStart),
      ...state.styles.slice(lineEnd),
    ],
  }
}

const applyDisplayData = (state: DisplayState, data: string): DisplayState => {
  let text = state.text
  let styles = [...state.styles]
  let cursor = Math.min(Math.max(state.cursor, 0), text.length)
  let pendingCr = state.pendingCr
  let style = state.style
  let index = 0

  while (index < data.length) {
    const styleControl = readSgrStyleSentinel(data, index)

    if (styleControl) {
      style = applySgrStyle(style, styleControl.parameters)
      index += styleControl.length
      continue
    }

    const characterLength = readCodePointLength(data, index)
    const character = data.slice(index, index + characterLength)
    const eraseLineMode = getEraseLineModeFromSentinel(character)

    index += characterLength

    if (eraseLineMode !== null) {
      const nextState = eraseLineInState(
        { text, cursor, pendingCr, style, styles },
        eraseLineMode
      )
      text = nextState.text
      styles = [...nextState.styles]
      cursor = nextState.cursor
      pendingCr = false
      continue
    }

    if (isClearScreenSentinel(character)) {
      text = ''
      styles = []
      cursor = 0
      pendingCr = false
      continue
    }

    if (isCursorLeftSentinel(character)) {
      cursor = Math.max(
        findLineStart(text, cursor),
        cursor - readPreviousCodePointLength(text, cursor)
      )
      pendingCr = false
      continue
    }

    if (isCursorRightSentinel(character)) {
      cursor = Math.min(
        findLineEnd(text, cursor),
        cursor + readCodePointLength(text, cursor)
      )
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

      text = `${text.slice(0, cursor)}\n${text.slice(cursor)}`
      styles.splice(cursor, 0, style)
      cursor += 1
      pendingCr = false
      continue
    }

    if (character === '\b') {
      cursor = Math.max(findLineStart(text, cursor), cursor - 1)
      pendingCr = false
      continue
    }

    const next = writeDisplayCharacter(text, styles, cursor, character, style)
    text = next.text
    styles = next.styles
    cursor = next.cursor
    pendingCr = false
  }

  return { text, cursor, pendingCr, style, styles }
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

  return {
    text: text.slice(removedText.length),
    cursor: Math.max(0, state.cursor - removedText.length),
    pendingCr: state.pendingCr,
    style: state.style,
    styles: state.styles.slice(removedText.length),
  }
}

export class TerminalDisplayBuffer {
  private state = createEmptyState()
  private readonly maxScrollbackLines: number

  constructor(options: TerminalDisplayBufferOptions = {}) {
    this.maxScrollbackLines =
      options.maxScrollbackLines ?? DEFAULT_MAX_SCROLLBACK_LINES
  }

  clear(): void {
    this.state = createEmptyState()
  }

  write(data: string): void {
    if (data.length === 0) {
      return
    }

    this.state = trimScrollbackLines(
      applyDisplayData(this.state, data),
      this.maxScrollbackLines
    )
  }

  readText(): string {
    return this.state.text
  }

  readCursorOffset(): number {
    return this.state.cursor
  }

  readStyledRuns(): readonly TerminalDisplayRun[] {
    const text = this.state.text

    if (text.length === 0) {
      return []
    }

    const runs: TerminalDisplayRun[] = []
    let runStart = 0
    let runStyle = this.state.styles[0] ?? {}

    for (let index = 1; index < text.length; index += 1) {
      const style = this.state.styles[index] ?? {}

      if (areStylesEqual(runStyle, style)) {
        continue
      }

      runs.push({
        text: text.slice(runStart, index),
        style: runStyle,
      })
      runStart = index
      runStyle = style
    }

    runs.push({
      text: text.slice(runStart),
      style: runStyle,
    })

    return runs
  }

  readVisibleText(): string {
    return this.readText().replace(/\n+$/, '')
  }
}
