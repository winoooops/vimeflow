import { getEraseLineModeFromSentinel } from './terminalControlParser'

const DEFAULT_MAX_SCROLLBACK_LINES = 10_000

interface DisplayState {
  readonly text: string
  readonly cursor: number
  readonly pendingCr: boolean
}

interface DisplayCharacterResult {
  readonly text: string
  readonly cursor: number
}

export interface TerminalDisplayBufferOptions {
  readonly maxScrollbackLines?: number
}

const createEmptyState = (): DisplayState => ({
  text: '',
  cursor: 0,
  pendingCr: false,
})

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

const writeDisplayCharacter = (
  text: string,
  cursor: number,
  character: string
): DisplayCharacterResult => {
  if (cursor < text.length && text[cursor] !== '\n') {
    const nextLength = readCodePointLength(text, cursor)

    return {
      text: `${text.slice(0, cursor)}${character}${text.slice(
        cursor + nextLength
      )}`,
      cursor: cursor + character.length,
    }
  }

  return {
    text: `${text.slice(0, cursor)}${character}${text.slice(cursor)}`,
    cursor: cursor + character.length,
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
    }
  }

  if (mode === 1) {
    const cursorCodePointLength = readCodePointLength(text, cursor)

    return {
      ...state,
      text: `${text.slice(0, lineStart)}${text.slice(cursor + cursorCodePointLength)}`,
      cursor: lineStart,
    }
  }

  return {
    ...state,
    text: `${text.slice(0, lineStart)}${text.slice(lineEnd)}`,
    cursor: lineStart,
  }
}

const applyDisplayData = (state: DisplayState, data: string): DisplayState => {
  let text = state.text
  let cursor = Math.min(Math.max(state.cursor, 0), text.length)
  let pendingCr = state.pendingCr

  for (const character of data) {
    const eraseLineMode = getEraseLineModeFromSentinel(character)

    if (eraseLineMode !== null) {
      const nextState = eraseLineInState(
        { text, cursor, pendingCr },
        eraseLineMode
      )
      text = nextState.text
      cursor = nextState.cursor
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
      cursor += 1
      pendingCr = false
      continue
    }

    if (character === '\b') {
      cursor = Math.max(findLineStart(text, cursor), cursor - 1)
      pendingCr = false
      continue
    }

    const next = writeDisplayCharacter(text, cursor, character)
    text = next.text
    cursor = next.cursor
    pendingCr = false
  }

  return { text, cursor, pendingCr }
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

  readVisibleText(): string {
    return this.readText().replace(/\n+$/, '')
  }
}
