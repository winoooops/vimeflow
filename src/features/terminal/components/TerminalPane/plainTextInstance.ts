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
import { createTextControlSequenceTerminalParserEngine } from './terminalParserEngine'
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

const normalizeDisplayText = (data: string): string =>
  data.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const trimScrollbackLines = (text: string): string => {
  const lines = text.split('\n')

  if (lines.length <= MAX_SCROLLBACK_LINES) {
    return text
  }

  return lines.slice(-MAX_SCROLLBACK_LINES).join('\n')
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
      this.outputText = trimScrollbackLines(
        `${this.outputText}${normalizeDisplayText(visibleData)}`
      )
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
  private readonly parserEngine =
    createTextControlSequenceTerminalParserEngine()
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

  readonly viewportReader: TerminalViewportReader = {
    readVisibleText: (): string => this.terminal.readVisibleText(),
  }

  readonly fitController: TerminalFitController = {
    fit: (): void => {
      this.terminal.fit()
    },
  }

  readonly rendererHandle: TerminalRendererHandle = {
    dispose: (): void => undefined,
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
  createInstance: createPlainTextTerminal,
}
