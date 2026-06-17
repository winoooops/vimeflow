import { themeService } from '../../../../theme'
import type {
  TerminalDisposable,
  TerminalFitController,
  TerminalInstance,
  TerminalKeyEventHandler,
  TerminalOutputWriter,
  TerminalParser,
  TerminalRendererAdapter,
  TerminalRendererHandle,
  TerminalSize,
  TerminalSurface,
  TerminalTheme,
  TerminalViewportReader,
} from '../../types'
import { PLAIN_TEXT_TERMINAL_RENDERER_ID } from './plainTextRendererMetadata'
import { getEraseLineModeFromSentinel } from './terminalControlParser'
import { createControlSequenceTerminalParserEngine } from './terminalParserEngine'
import { PLAIN_TEXT_TERMINAL_CAPABILITIES } from './terminalRendererCapabilities'
import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE } from './terminalFont'

export { PLAIN_TEXT_TERMINAL_RENDERER_ID } from './plainTextRendererMetadata'

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const MIN_COLS = 2
const MIN_ROWS = 1
const APPROXIMATE_CHAR_WIDTH = 8
const APPROXIMATE_LINE_HEIGHT = 18
const MAX_SCROLLBACK_LINES = 10_000

const KEYBOARD_SEQUENCES = new Map<string, string>([
  ['ArrowUp', '\x1b[A'],
  ['ArrowDown', '\x1b[B'],
  ['ArrowRight', '\x1b[C'],
  ['ArrowLeft', '\x1b[D'],
  ['Home', '\x1b[H'],
  ['End', '\x1b[F'],
  ['Delete', '\x1b[3~'],
  ['PageUp', '\x1b[5~'],
  ['PageDown', '\x1b[6~'],
])

const getControlKeyData = (key: string): string | null => {
  if (key.length !== 1) {
    return null
  }

  const upperKey = key.toUpperCase()

  if (upperKey < 'A' || upperKey > 'Z') {
    return null
  }

  return String.fromCharCode(upperKey.charCodeAt(0) - 64)
}

const createDisposable = (dispose: () => void): TerminalDisposable => ({
  dispose,
})

interface DisplayState {
  readonly text: string
  readonly cursor: number
  readonly pendingCr: boolean
}

const findLineStart = (text: string, cursor: number): number => {
  if (cursor <= 0) {
    return 0
  }

  return text.lastIndexOf('\n', cursor - 1) + 1
}

const readCodePointLength = (text: string, cursor: number): number =>
  (text.codePointAt(cursor) ?? 0) > 0xffff ? 2 : 1

interface DisplayCharacterResult {
  readonly text: string
  readonly cursor: number
}

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

const findLineEnd = (text: string, cursor: number): number => {
  const nextNewline = text.indexOf('\n', cursor)

  return nextNewline === -1 ? text.length : nextNewline
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

  for (const character of data.replace(/\r\n/g, '\n')) {
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

const trimScrollbackLines = (state: DisplayState): DisplayState => {
  const text = state.text
  const lines = text.split('\n')

  if (lines.length <= MAX_SCROLLBACK_LINES) {
    return state
  }

  const firstKeptLine = lines.length - MAX_SCROLLBACK_LINES
  const removedText = `${lines.slice(0, firstKeptLine).join('\n')}\n`

  return {
    text: text.slice(removedText.length),
    cursor: Math.max(0, state.cursor - removedText.length),
    pendingCr: state.pendingCr,
  }
}

const readContainedSelection = (root: HTMLElement): string => {
  const selection = window.getSelection()

  if (!selection || selection.rangeCount === 0) {
    return ''
  }

  const anchorNode = selection.anchorNode
  const focusNode = selection.focusNode

  if (
    !anchorNode ||
    !root.contains(anchorNode) ||
    !focusNode ||
    !root.contains(focusNode)
  ) {
    return ''
  }

  return selection.toString()
}

const getKeyboardData = (event: KeyboardEvent): string | null => {
  if (event.metaKey || event.altKey) {
    return null
  }

  if (event.ctrlKey) {
    return getControlKeyData(event.key)
  }

  if (event.key === 'Enter') {
    return '\r'
  }

  if (event.key === 'Backspace') {
    return '\x7f'
  }

  if (event.key === 'Tab') {
    return '\t'
  }

  if (event.key === 'Escape') {
    return '\x1b'
  }

  const sequence = KEYBOARD_SEQUENCES.get(event.key)
  if (sequence) {
    return sequence
  }

  return event.key.length === 1 ? event.key : null
}

class PlainTextTerminalSurface implements TerminalSurface {
  private readonly root = document.createElement('div')
  private readonly output = document.createElement('pre')
  private readonly input = document.createElement('textarea')
  private readonly dataHandlers = new Set<(data: string) => void>()
  private readonly resizeHandlers = new Set<(size: TerminalSize) => void>()
  private readonly selectionHandlers = new Set<() => void>()
  private readonly keyHandlers = new Set<TerminalKeyEventHandler>()
  private container: HTMLElement | null = null
  private outputText = ''
  private outputCursor = 0
  private outputPendingCr = false
  private colsValue = DEFAULT_COLS
  private rowsValue = DEFAULT_ROWS
  private lastSelectionText = ''
  private disposed = false

  constructor(private readonly transformOutput: (data: string) => string) {
    this.root.dataset.terminalRenderer = PLAIN_TEXT_TERMINAL_RENDERER_ID
    this.root.tabIndex = -1
    this.root.append(this.output, this.input)

    Object.assign(this.root.style, {
      height: '100%',
      minHeight: '0',
      overflow: 'auto',
      position: 'relative',
    })

    Object.assign(this.output.style, {
      boxSizing: 'border-box',
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: `${TERMINAL_FONT_SIZE}px`,
      lineHeight: `${APPROXIMATE_LINE_HEIGHT}px`,
      margin: '0',
      minHeight: '100%',
      padding: '8px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    })

    Object.assign(this.input.style, {
      height: '1px',
      left: '0',
      opacity: '0',
      pointerEvents: 'none',
      position: 'absolute',
      top: '0',
      width: '1px',
    })

    this.input.setAttribute('aria-label', 'Terminal input')
    this.root.addEventListener('mousedown', this.handlePointerDown)
    document.addEventListener('selectionchange', this.handleSelectionChange)
    this.input.addEventListener('keydown', this.handleKeyDown)
    this.input.addEventListener('paste', this.handlePaste)
    this.applyTheme(themeService.current().terminal)
  }

  get cols(): number {
    return this.colsValue
  }

  get rows(): number {
    return this.rowsValue
  }

  get element(): HTMLElement | undefined {
    return this.root
  }

  open(container: HTMLElement): void {
    if (this.disposed) {
      return
    }

    this.container = container

    if (this.root.parentElement !== container) {
      this.root.remove()
      container.append(this.root)
    }

    this.fit()
  }

  focus(): void {
    this.input.focus()
  }

  dispose(): void {
    this.disposed = true
    this.root.removeEventListener('mousedown', this.handlePointerDown)
    document.removeEventListener('selectionchange', this.handleSelectionChange)
    this.input.removeEventListener('keydown', this.handleKeyDown)
    this.input.removeEventListener('paste', this.handlePaste)
    this.dataHandlers.clear()
    this.resizeHandlers.clear()
    this.selectionHandlers.clear()
    this.keyHandlers.clear()
    this.root.remove()
  }

  isDisposed(): boolean {
    return this.disposed
  }

  clear(): void {
    this.outputText = ''
    this.outputCursor = 0
    this.outputPendingCr = false
    this.renderOutput()
  }

  write(data: string, callback?: () => void): void {
    if (this.disposed) {
      callback?.()

      return
    }

    this.writeVisible(this.transformOutput(data), callback)
  }

  writeVisible(visibleData: string, callback?: () => void): void {
    if (this.disposed) {
      callback?.()

      return
    }

    if (visibleData.length > 0) {
      const nextState = trimScrollbackLines(
        applyDisplayData(
          {
            text: this.outputText,
            cursor: this.outputCursor,
            pendingCr: this.outputPendingCr,
          },
          visibleData
        )
      )

      this.outputText = nextState.text
      this.outputCursor = nextState.cursor
      this.outputPendingCr = nextState.pendingCr
      this.renderOutput()
    }

    callback?.()
  }

  refresh(start: number, end: number): void {
    void start
    void end

    this.renderOutput()
  }

  onData(handler: (data: string) => void): TerminalDisposable {
    this.dataHandlers.add(handler)

    return createDisposable((): void => {
      this.dataHandlers.delete(handler)
    })
  }

  onResize(handler: (size: TerminalSize) => void): TerminalDisposable {
    this.resizeHandlers.add(handler)

    return createDisposable((): void => {
      this.resizeHandlers.delete(handler)
    })
  }

  hasSelection(): boolean {
    return readContainedSelection(this.root).length > 0
  }

  getSelection(): string {
    return readContainedSelection(this.root)
  }

  paste(text: string): void {
    this.emitData(text)
  }

  selectAll(): void {
    if (!this.output.firstChild) {
      return
    }

    const range = document.createRange()
    range.selectNodeContents(this.output)

    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    this.lastSelectionText = readContainedSelection(this.root)
    this.notifySelectionChange()
  }

  onSelectionChange(listener: () => void): TerminalDisposable {
    this.selectionHandlers.add(listener)

    return createDisposable((): void => {
      this.selectionHandlers.delete(listener)
    })
  }

  attachKeyEventHandler(handler: TerminalKeyEventHandler): void {
    this.keyHandlers.add(handler)
  }

  applyTheme(theme: TerminalTheme): void {
    this.root.style.background = theme.background
    this.root.style.color = theme.foreground
    this.output.style.caretColor = theme.cursor
    this.root.style.setProperty(
      '--terminal-selection-background',
      theme.selectionBackground
    )
  }

  fit(): void {
    const width = this.container?.offsetWidth ?? 0
    const height = this.container?.offsetHeight ?? 0

    if (width <= 0 || height <= 0) {
      return
    }

    const nextCols = Math.max(
      MIN_COLS,
      Math.floor(width / APPROXIMATE_CHAR_WIDTH)
    )

    const nextRows = Math.max(
      MIN_ROWS,
      Math.floor(height / APPROXIMATE_LINE_HEIGHT)
    )

    if (nextCols === this.colsValue && nextRows === this.rowsValue) {
      return
    }

    this.colsValue = nextCols
    this.rowsValue = nextRows
    this.notifyResize()
  }

  readVisibleText(): string {
    return this.outputText.replace(/\n+$/, '')
  }

  private readonly handlePointerDown = (): void => {
    this.focus()
  }

  private readonly handleSelectionChange = (): void => {
    const selectionText = readContainedSelection(this.root)

    if (selectionText === this.lastSelectionText) {
      return
    }

    this.lastSelectionText = selectionText
    this.notifySelectionChange()
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    for (const handler of this.keyHandlers) {
      if (!handler(event)) {
        event.preventDefault()
        event.stopPropagation()

        return
      }
    }

    const data = getKeyboardData(event)

    if (!data) {
      return
    }

    event.preventDefault()
    this.emitData(data)
  }

  private readonly handlePaste = (event: ClipboardEvent): void => {
    const text = event.clipboardData?.getData('text/plain') ?? ''

    if (!text) {
      return
    }

    event.preventDefault()
    this.emitData(text)
  }

  private emitData(data: string): void {
    this.dataHandlers.forEach((handler) => {
      handler(data)
    })
  }

  private renderOutput(): void {
    this.output.textContent = this.outputText
    this.root.scrollTop = this.root.scrollHeight
  }

  private notifyResize(): void {
    const size = { cols: this.colsValue, rows: this.rowsValue }

    this.resizeHandlers.forEach((handler) => {
      handler(size)
    })
  }

  private notifySelectionChange(): void {
    this.selectionHandlers.forEach((handler) => {
      handler()
    })
  }
}

class PlainTextTerminalModel {
  private readonly parserEngine = createControlSequenceTerminalParserEngine({
    capabilities: PLAIN_TEXT_TERMINAL_CAPABILITIES,
  })
  private readonly noOpParserDisposable: TerminalDisposable
  readonly terminal = new PlainTextTerminalSurface(
    (data) => this.parserEngine.parseText(data, null).visibleText
  )

  readonly parser: TerminalParser = this.parserEngine.parser

  readonly output: TerminalOutputWriter = {
    writeOutput: (chunk, callback): void => {
      if (this.terminal.isDisposed()) {
        callback?.()

        return
      }

      const { visibleText } = this.parserEngine.parseOutput(chunk)

      this.terminal.writeVisible(visibleText, callback)
    },
  }

  constructor() {
    // The plain-text renderer relies on the parser stripping control sequences
    // (and replacing erase-line sequences with sentinels). Subscribing a no-op
    // handler keeps the parser in stripping mode even when no external consumer
    // is listening.
    this.noOpParserDisposable = this.parserEngine.parser.onEvent(() => {
      // Intentionally empty: visible-text transformation is handled by the
      // parser, and erase-line sentinels are interpreted by the surface.
    })
  }

  readonly viewportReader: TerminalViewportReader = {
    readVisibleText: (): string => this.terminal.readVisibleText(),
  }

  readonly fitController: TerminalFitController = {
    fit: (): void => {
      this.terminal.fit()
    },
  }

  readonly rendererHandle: TerminalRendererHandle = {
    dispose: (): void => {
      this.noOpParserDisposable.dispose()
    },
  }
}

export const createPlainTextTerminal = (): TerminalInstance => {
  const model = new PlainTextTerminalModel()

  return {
    terminal: model.terminal,
    output: model.output,
    parser: model.parser,
    viewportReader: model.viewportReader,
    fitController: model.fitController,
    attachRenderer: (): TerminalRendererHandle => model.rendererHandle,
  }
}

export const plainTextTerminalRenderer: TerminalRendererAdapter = {
  id: PLAIN_TEXT_TERMINAL_RENDERER_ID,
  capabilities: PLAIN_TEXT_TERMINAL_CAPABILITIES,
  createInstance: createPlainTextTerminal,
}
