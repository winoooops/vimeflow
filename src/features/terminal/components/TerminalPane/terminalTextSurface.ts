import { themeService } from '../../../../theme'
import type {
  TerminalDisposable,
  TerminalKeyEventHandler,
  TerminalSize,
  TerminalSurface,
  TerminalTheme,
} from '../../types'
import {
  TerminalDisplayBuffer,
  type TerminalDisplayRun,
  type TerminalDisplayStyle,
} from './terminalDisplayBuffer'
import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE } from './terminalFont'

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const MIN_COLS = 2
const MIN_ROWS = 1
const APPROXIMATE_CHAR_WIDTH = 8
const APPROXIMATE_LINE_HEIGHT = 18
const MEASURED_CHAR_SAMPLE_LENGTH = 80

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

export interface TerminalTextSurfaceOptions {
  readonly rendererId: string
  readonly transformOutput: (data: string) => TerminalTextSurfaceOutput
}

export interface TerminalTextSurfaceOutput {
  readonly visibleText: string
  readonly displayText?: string
}

const createDisposable = (dispose: () => void): TerminalDisposable => ({
  dispose,
})

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

const parseCssPixels = (value: string): number => {
  const parsed = Number.parseFloat(value)

  return Number.isFinite(parsed) ? parsed : 0
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

export class TerminalTextSurface implements TerminalSurface {
  private readonly root = document.createElement('div')
  private readonly output = document.createElement('pre')
  private readonly input = document.createElement('textarea')
  private readonly dataHandlers = new Set<(data: string) => void>()
  private readonly resizeHandlers = new Set<(size: TerminalSize) => void>()
  private readonly selectionHandlers = new Set<() => void>()
  private readonly keyHandlers = new Set<TerminalKeyEventHandler>()
  private readonly outputBuffer = new TerminalDisplayBuffer({
    columns: DEFAULT_COLS,
  })
  private container: HTMLElement | null = null
  private colsValue = DEFAULT_COLS
  private rowsValue = DEFAULT_ROWS
  private lastSelectionText = ''
  private disposed = false

  constructor(private readonly options: TerminalTextSurfaceOptions) {
    this.root.dataset.terminalRenderer = options.rendererId
    this.root.tabIndex = -1
    this.root.append(this.output, this.input)

    Object.assign(this.root.style, {
      height: '100%',
      maxWidth: '100%',
      minHeight: '0',
      overflowX: 'hidden',
      overflowY: 'auto',
      position: 'relative',
      width: '100%',
    })

    Object.assign(this.output.style, {
      boxSizing: 'border-box',
      display: 'block',
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: `${TERMINAL_FONT_SIZE}px`,
      lineHeight: `${APPROXIMATE_LINE_HEIGHT}px`,
      margin: '0',
      maxWidth: '100%',
      minHeight: '100%',
      overflowX: 'hidden',
      padding: '8px',
      whiteSpace: 'normal',
      width: '100%',
      wordBreak: 'normal',
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
    this.renderOutput()
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
    this.outputBuffer.clear()
    this.renderOutput()
  }

  write(data: string, callback?: () => void): void {
    if (this.disposed) {
      callback?.()

      return
    }

    this.writeParsedOutput(this.options.transformOutput(data), callback)
  }

  writeVisible(visibleData: string, callback?: () => void): void {
    this.writeParsedOutput({ visibleText: visibleData }, callback)
  }

  writeParsedOutput(
    output: TerminalTextSurfaceOutput,
    callback?: () => void
  ): void {
    if (this.disposed) {
      callback?.()

      return
    }

    const displayData = output.displayText ?? output.visibleText

    if (displayData.length > 0) {
      this.outputBuffer.write(displayData)
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
    this.root.style.setProperty('--terminal-ansi-black', theme.black)
    this.root.style.setProperty('--terminal-ansi-red', theme.red)
    this.root.style.setProperty('--terminal-ansi-green', theme.green)
    this.root.style.setProperty('--terminal-ansi-yellow', theme.yellow)
    this.root.style.setProperty('--terminal-ansi-blue', theme.blue)
    this.root.style.setProperty('--terminal-ansi-magenta', theme.magenta)
    this.root.style.setProperty('--terminal-ansi-cyan', theme.cyan)
    this.root.style.setProperty('--terminal-ansi-white', theme.white)
    this.root.style.setProperty(
      '--terminal-ansi-bright-black',
      theme.brightBlack
    )

    this.root.style.setProperty('--terminal-ansi-bright-red', theme.brightRed)
    this.root.style.setProperty(
      '--terminal-ansi-bright-green',
      theme.brightGreen
    )

    this.root.style.setProperty(
      '--terminal-ansi-bright-yellow',
      theme.brightYellow
    )
    this.root.style.setProperty('--terminal-ansi-bright-blue', theme.brightBlue)
    this.root.style.setProperty(
      '--terminal-ansi-bright-magenta',
      theme.brightMagenta
    )
    this.root.style.setProperty('--terminal-ansi-bright-cyan', theme.brightCyan)
    this.root.style.setProperty(
      '--terminal-ansi-bright-white',
      theme.brightWhite
    )
    this.output.style.caretColor = theme.cursor
    this.root.style.setProperty('--terminal-cursor-color', theme.cursor)
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

    const contentWidth = Math.max(0, width - this.readOutputHorizontalPadding())

    const nextCols = Math.max(
      MIN_COLS,
      Math.floor(contentWidth / this.measureCharacterWidth())
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
    this.outputBuffer.setColumns(nextCols)
    this.notifyResize()
  }

  readVisibleText(): string {
    return this.outputBuffer.readVisibleText()
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

  private readOutputHorizontalPadding(): number {
    const style = window.getComputedStyle(this.output)

    return (
      parseCssPixels(style.paddingLeft) + parseCssPixels(style.paddingRight)
    )
  }

  private measureCharacterWidth(): number {
    const probe = document.createElement('span')
    probe.textContent = '0'.repeat(MEASURED_CHAR_SAMPLE_LENGTH)

    Object.assign(probe.style, {
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: `${TERMINAL_FONT_SIZE}px`,
      lineHeight: `${APPROXIMATE_LINE_HEIGHT}px`,
      pointerEvents: 'none',
      position: 'absolute',
      visibility: 'hidden',
      whiteSpace: 'pre',
    })

    this.root.append(probe)
    const width = probe.getBoundingClientRect().width
    probe.remove()

    if (width <= 0) {
      return APPROXIMATE_CHAR_WIDTH
    }

    return width / MEASURED_CHAR_SAMPLE_LENGTH
  }

  private createCursorElement(): HTMLElement {
    const cursor = document.createElement('span')
    const marker = document.createElement('span')

    cursor.dataset.terminalCursor = 'true'
    cursor.setAttribute('aria-hidden', 'true')
    marker.dataset.terminalCursorMarker = 'true'

    Object.assign(cursor.style, {
      display: 'inline-block',
      height: '1em',
      pointerEvents: 'none',
      position: 'relative',
      userSelect: 'none',
      verticalAlign: '-0.12em',
      width: '0',
    })

    Object.assign(marker.style, {
      animationDuration: '1.1s',
      animationIterationCount: 'infinite',
      animationName: 'vfTerminalCursorBlink',
      animationTimingFunction: 'steps(1, end)',
      backgroundColor: 'var(--terminal-cursor-color)',
      display: 'block',
      height: '1em',
      left: '0',
      position: 'absolute',
      top: '0',
      width: '0.62em',
    })

    cursor.append(marker)

    return cursor
  }

  private hasStyle(style: TerminalDisplayStyle): boolean {
    return (
      style.background !== undefined ||
      style.bold === true ||
      style.dim === true ||
      style.foreground !== undefined ||
      style.italic === true ||
      style.underline === true
    )
  }

  private applyStyleToElement(
    element: HTMLElement,
    style: TerminalDisplayStyle
  ): void {
    if (style.background) {
      element.style.backgroundColor = style.background
    }

    if (style.bold) {
      element.style.fontWeight = '700'
    }

    if (style.dim) {
      element.style.opacity = '0.72'
    }

    if (style.foreground) {
      element.style.color = style.foreground
    }

    if (style.italic) {
      element.style.fontStyle = 'italic'
    }

    if (style.underline) {
      element.style.textDecoration = 'underline'
    }
  }

  private createTextNode(text: string, style: TerminalDisplayStyle): Node {
    if (!this.hasStyle(style)) {
      return document.createTextNode(text)
    }

    const span = document.createElement('span')
    span.dataset.terminalStyleRun = 'true'
    span.textContent = text
    this.applyStyleToElement(span, style)

    return span
  }

  private appendRunFragment(
    parent: HTMLElement,
    text: string,
    style: TerminalDisplayStyle
  ): void {
    if (text.length === 0) {
      return
    }

    parent.append(this.createTextNode(text, style))
  }

  private createOutputRow(): HTMLElement {
    const row = document.createElement('span')
    row.dataset.terminalRow = 'true'

    Object.assign(row.style, {
      display: 'block',
      maxWidth: '100%',
      minHeight: `${APPROXIMATE_LINE_HEIGHT}px`,
      overflowX: 'hidden',
      whiteSpace: 'pre',
      width: '100%',
    })

    return row
  }

  private createOutputFragments(
    runs: readonly TerminalDisplayRun[],
    cursorOffset: number
  ): Node[] {
    const rows: HTMLElement[] = [this.createOutputRow()]
    let offset = 0
    const cursorState = { didRender: false }
    let currentRow = rows[0]

    const appendCursor = (): void => {
      currentRow.append(this.createCursorElement())
      cursorState.didRender = true
    }

    const appendSegment = (text: string, style: TerminalDisplayStyle): void => {
      if (text.length === 0) {
        return
      }

      const segmentStart = offset
      const segmentEnd = segmentStart + text.length

      if (
        !cursorState.didRender &&
        cursorOffset >= segmentStart &&
        cursorOffset <= segmentEnd
      ) {
        const splitOffset = cursorOffset - segmentStart

        if (
          splitOffset > 0 &&
          splitOffset < text.length &&
          this.hasStyle(style)
        ) {
          const runElement = document.createElement('span')
          runElement.dataset.terminalStyleRun = 'true'
          this.applyStyleToElement(runElement, style)
          runElement.append(
            document.createTextNode(text.slice(0, splitOffset)),
            this.createCursorElement(),
            document.createTextNode(text.slice(splitOffset))
          )
          currentRow.append(runElement)
          cursorState.didRender = true
        } else {
          this.appendRunFragment(currentRow, text.slice(0, splitOffset), style)
          appendCursor()
          this.appendRunFragment(currentRow, text.slice(splitOffset), style)
        }
      } else {
        this.appendRunFragment(currentRow, text, style)
      }

      offset = segmentEnd
    }

    const appendNewline = (): void => {
      if (!cursorState.didRender && cursorOffset === offset) {
        appendCursor()
      }

      offset += 1
      const newlineMarker = document.createElement('span')
      newlineMarker.style.fontSize = '0'
      newlineMarker.appendChild(document.createTextNode('\n'))
      currentRow.appendChild(newlineMarker)
      currentRow = this.createOutputRow()
      rows.push(currentRow)
    }

    for (const run of runs) {
      let segmentStart = 0

      while (segmentStart < run.text.length) {
        const newlineIndex = run.text.indexOf('\n', segmentStart)

        if (newlineIndex === -1) {
          appendSegment(run.text.slice(segmentStart), run.style)
          segmentStart = run.text.length
          continue
        }

        appendSegment(run.text.slice(segmentStart, newlineIndex), run.style)
        appendNewline()
        segmentStart = newlineIndex + 1
      }
    }

    if (!cursorState.didRender) {
      appendCursor()
    }

    return rows
  }

  private renderOutput(): void {
    const text = this.outputBuffer.readText()
    const runs = this.outputBuffer.readStyledRuns()

    const cursorOffset = Math.min(
      this.outputBuffer.readCursorOffset(),
      text.length
    )

    const fragments = this.createOutputFragments(runs, cursorOffset)

    this.output.replaceChildren(...fragments)
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
