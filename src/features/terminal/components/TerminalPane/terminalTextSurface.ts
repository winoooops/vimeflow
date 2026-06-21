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
  type TerminalDisplayDelta,
  type TerminalDisplayRun,
  type TerminalDisplayStyle,
  readTextCellWidth,
} from './terminalDisplayBuffer'
import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE } from './terminalFont'

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const MIN_COLS = 2
const MIN_ROWS = 1
const APPROXIMATE_CHAR_WIDTH = 8
const APPROXIMATE_LINE_HEIGHT = 18
const MEASURED_CHAR_SAMPLE_LENGTH = 80
const BLOCK_ELEMENT_PATTERN = /[\u2580-\u2590\u2594-\u259f]/
const BLOCK_ONE_EIGHTH = 12.5

interface BlockGlyphRect {
  readonly heightPercent: number
  readonly leftPercent: number
  readonly topPercent: number
  readonly widthPercent: number
}

interface BlockGlyphPaint {
  readonly rects: readonly BlockGlyphRect[]
}

interface BlockGlyphColors {
  readonly background: string
  readonly foreground: string
}

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
  readonly displayDelta?: TerminalDisplayDelta
}

type RenderScrollMode = 'bottom' | 'cursor' | 'top'

const createDisposable = (dispose: () => void): TerminalDisposable => ({
  dispose,
})

const readBlockGlyphColors = (
  style: TerminalDisplayStyle
): BlockGlyphColors => {
  if (style.reverse) {
    return {
      background: style.foreground ?? 'var(--terminal-foreground)',
      foreground: style.background ?? 'var(--terminal-background)',
    }
  }

  return {
    background: style.background ?? 'transparent',
    foreground: style.foreground ?? 'var(--terminal-foreground)',
  }
}

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

const readContainedSelection = (
  root: HTMLElement,
  output: HTMLElement,
  selectAllText: string
): string => {
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

  const range = selection.getRangeAt(0)
  const outputRange = document.createRange()
  outputRange.selectNodeContents(output)

  const includesAllOutput =
    range.compareBoundaryPoints(Range.START_TO_START, outputRange) <= 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, outputRange) >= 0

  if (includesAllOutput) {
    return selectAllText
  }

  return selection.toString()
}

const parseCssPixels = (value: string): number => {
  const parsed = Number.parseFloat(value)

  return Number.isFinite(parsed) ? parsed : 0
}

const readCursorRowIndex = (text: string, cursorOffset: number): number => {
  let rowIndex = 0

  for (let index = 0; index < cursorOffset; index += 1) {
    if (text[index] === '\n') {
      rowIndex += 1
    }
  }

  return rowIndex
}

const readBlockGlyphPaint = (character: string): BlockGlyphPaint | null => {
  const codePoint = character.codePointAt(0)

  if (codePoint === undefined) {
    return null
  }

  if (codePoint >= 0x2581 && codePoint <= 0x2588) {
    const eighths = codePoint - 0x2580

    return {
      rects: [
        {
          heightPercent: eighths * BLOCK_ONE_EIGHTH,
          leftPercent: 0,
          topPercent: 100 - eighths * BLOCK_ONE_EIGHTH,
          widthPercent: 100,
        },
      ],
    }
  }

  if (codePoint >= 0x2589 && codePoint <= 0x258f) {
    const eighths = 0x2590 - codePoint

    return {
      rects: [
        {
          heightPercent: 100,
          leftPercent: 0,
          topPercent: 0,
          widthPercent: eighths * BLOCK_ONE_EIGHTH,
        },
      ],
    }
  }

  if (character === '\u2580') {
    return {
      rects: [
        {
          heightPercent: 50,
          leftPercent: 0,
          topPercent: 0,
          widthPercent: 100,
        },
      ],
    }
  }

  if (character === '\u2590') {
    return {
      rects: [
        {
          heightPercent: 100,
          leftPercent: 50,
          topPercent: 0,
          widthPercent: 50,
        },
      ],
    }
  }

  if (character === '\u2594') {
    return {
      rects: [
        {
          heightPercent: BLOCK_ONE_EIGHTH,
          leftPercent: 0,
          topPercent: 0,
          widthPercent: 100,
        },
      ],
    }
  }

  if (character === '\u2595') {
    return {
      rects: [
        {
          heightPercent: 100,
          leftPercent: 100 - BLOCK_ONE_EIGHTH,
          topPercent: 0,
          widthPercent: BLOCK_ONE_EIGHTH,
        },
      ],
    }
  }

  const quadrantRects: Partial<Record<number, readonly BlockGlyphRect[]>> = {
    0x2596: [
      { heightPercent: 50, leftPercent: 0, topPercent: 50, widthPercent: 50 },
    ],
    0x2597: [
      { heightPercent: 50, leftPercent: 50, topPercent: 50, widthPercent: 50 },
    ],
    0x2598: [
      { heightPercent: 50, leftPercent: 0, topPercent: 0, widthPercent: 50 },
    ],
    0x2599: [
      { heightPercent: 50, leftPercent: 0, topPercent: 0, widthPercent: 50 },
      { heightPercent: 50, leftPercent: 0, topPercent: 50, widthPercent: 50 },
      { heightPercent: 50, leftPercent: 50, topPercent: 50, widthPercent: 50 },
    ],
    0x259a: [
      { heightPercent: 50, leftPercent: 0, topPercent: 0, widthPercent: 50 },
      { heightPercent: 50, leftPercent: 50, topPercent: 50, widthPercent: 50 },
    ],
    0x259b: [
      { heightPercent: 50, leftPercent: 0, topPercent: 0, widthPercent: 50 },
      { heightPercent: 50, leftPercent: 50, topPercent: 0, widthPercent: 50 },
      { heightPercent: 50, leftPercent: 0, topPercent: 50, widthPercent: 50 },
    ],
    0x259c: [
      { heightPercent: 50, leftPercent: 0, topPercent: 0, widthPercent: 50 },
      { heightPercent: 50, leftPercent: 50, topPercent: 0, widthPercent: 50 },
      { heightPercent: 50, leftPercent: 50, topPercent: 50, widthPercent: 50 },
    ],
    0x259d: [
      { heightPercent: 50, leftPercent: 50, topPercent: 0, widthPercent: 50 },
    ],
    0x259e: [
      { heightPercent: 50, leftPercent: 50, topPercent: 0, widthPercent: 50 },
      { heightPercent: 50, leftPercent: 0, topPercent: 50, widthPercent: 50 },
    ],
    0x259f: [
      { heightPercent: 50, leftPercent: 50, topPercent: 0, widthPercent: 50 },
      { heightPercent: 50, leftPercent: 0, topPercent: 50, widthPercent: 50 },
      { heightPercent: 50, leftPercent: 50, topPercent: 50, widthPercent: 50 },
    ],
  }

  const rects = quadrantRects[codePoint]

  if (rects) {
    return { rects }
  }

  return null
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
  private cachedCharacterWidth: number | null = null
  private lastSelectionText = ''
  private selectAllSelectionText: string | null = null
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
      lineHeight: 'var(--terminal-line-height)',
      margin: '0',
      maxWidth: '100%',
      minHeight: 'max(100%, var(--terminal-pty-viewport-height))',
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
    this.syncPtyViewportGeometry()
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

    if (output.displayDelta) {
      const scrollMode: RenderScrollMode = output.displayDelta.operations.some(
        (operation) => operation.type === 'replace'
      )
        ? 'top'
        : 'bottom'

      this.outputBuffer.applyDelta(output.displayDelta)
      this.renderOutput({ scrollMode })
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
    return this.readSelectionText().length > 0
  }

  getSelection(): string {
    return this.readSelectionText()
  }

  paste(text: string): void {
    this.emitData(text)
  }

  selectAll(): void {
    if (!this.output.firstChild) {
      return
    }

    this.selectAllSelectionText = this.outputBuffer.readVisibleText()

    const range = document.createRange()
    range.selectNodeContents(this.output)

    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    this.lastSelectionText = this.readSelectionText()
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
    this.root.style.setProperty('--terminal-background', theme.background)
    this.root.style.setProperty('--terminal-foreground', theme.foreground)
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

    if (theme.selectionForeground) {
      this.root.style.setProperty(
        '--terminal-selection-foreground',
        theme.selectionForeground
      )
    } else {
      this.root.style.removeProperty('--terminal-selection-foreground')
    }
  }

  fit(): void {
    const width = this.container?.offsetWidth ?? 0
    const height = this.container?.offsetHeight ?? 0

    if (width <= 0 || height <= 0) {
      return
    }

    const contentWidth = Math.max(0, width - this.readOutputHorizontalPadding())
    const contentHeight = Math.max(0, height - this.readOutputVerticalPadding())
    const lineHeight = this.readLineHeight()

    const nextCols = Math.max(
      MIN_COLS,
      Math.floor(contentWidth / this.measureCharacterWidth())
    )

    const nextRows = Math.max(MIN_ROWS, Math.floor(contentHeight / lineHeight))

    if (nextCols === this.colsValue && nextRows === this.rowsValue) {
      this.syncPtyViewportGeometry()

      return
    }

    this.colsValue = nextCols
    this.rowsValue = nextRows
    this.outputBuffer.setColumns(nextCols)
    this.syncPtyViewportGeometry()
    this.notifyResize()
  }

  readVisibleText(): string {
    return this.outputBuffer.readVisibleText()
  }

  private readonly handlePointerDown = (): void => {
    this.selectAllSelectionText = null
    this.focus()
  }

  private readonly handleSelectionChange = (): void => {
    this.selectAllSelectionText = null
    const selectionText = this.readSelectionText()

    if (selectionText === this.lastSelectionText) {
      return
    }

    this.lastSelectionText = selectionText
    this.notifySelectionChange()
  }

  private readSelectionText(): string {
    const nativeSelectionText = readContainedSelection(
      this.root,
      this.output,
      this.outputBuffer.readVisibleText()
    )

    if (nativeSelectionText.length > 0) {
      return nativeSelectionText
    }

    return this.selectAllSelectionText ?? ''
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

  private readOutputVerticalPadding(): number {
    const style = window.getComputedStyle(this.output)

    return (
      parseCssPixels(style.paddingTop) + parseCssPixels(style.paddingBottom)
    )
  }

  private readLineHeight(): number {
    const parsed = parseCssPixels(
      window.getComputedStyle(this.output).lineHeight
    )

    return parsed > 0 ? parsed : APPROXIMATE_LINE_HEIGHT
  }

  private syncPtyViewportGeometry(): void {
    const viewportHeight =
      this.rowsValue * this.readLineHeight() + this.readOutputVerticalPadding()

    this.root.dataset.terminalCols = String(this.colsValue)
    this.root.dataset.terminalRows = String(this.rowsValue)
    this.root.style.setProperty(
      '--terminal-line-height',
      `${APPROXIMATE_LINE_HEIGHT}px`
    )

    const cellWidth = this.measureCharacterWidth()

    this.root.style.setProperty('--terminal-cell-width', `${cellWidth}px`)
    this.root.style.setProperty(
      '--terminal-pty-viewport-height',
      `${viewportHeight}px`
    )
  }

  private measureCharacterWidth(): number {
    if (this.cachedCharacterWidth !== null) {
      return this.cachedCharacterWidth
    }

    const probe = document.createElement('span')
    probe.textContent = '0'.repeat(MEASURED_CHAR_SAMPLE_LENGTH)

    Object.assign(probe.style, {
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: `${TERMINAL_FONT_SIZE}px`,
      lineHeight: 'var(--terminal-line-height)',
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

    this.cachedCharacterWidth = width / MEASURED_CHAR_SAMPLE_LENGTH

    return this.cachedCharacterWidth
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
      style.reverse === true ||
      style.underline === true
    )
  }

  private applyStyleToElement(
    element: HTMLElement,
    style: TerminalDisplayStyle,
    text: string
  ): void {
    if (style.background || style.reverse) {
      const cellWidth = Math.max(1, readTextCellWidth(text))

      if (style.background && !style.reverse) {
        element.style.backgroundColor = style.background
      }

      element.style.display = 'inline-block'
      element.style.height = 'var(--terminal-line-height)'
      element.style.lineHeight = 'var(--terminal-line-height)'
      element.style.minWidth = `calc(var(--terminal-cell-width) * ${cellWidth})`
      element.style.overflow = 'visible'
      element.style.verticalAlign = 'top'
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

    if (style.reverse) {
      element.style.backgroundColor =
        style.foreground ?? 'var(--terminal-foreground)'
      element.style.color = style.background ?? 'var(--terminal-background)'
    }

    if (style.underline) {
      element.style.textDecoration = 'underline'
    }
  }

  private createBlockGlyphElement(
    character: string,
    style: TerminalDisplayStyle,
    paint: BlockGlyphPaint
  ): HTMLElement {
    const glyph = document.createElement('span')
    const { background, foreground } = readBlockGlyphColors(style)

    glyph.dataset.terminalStyleRun = 'true'
    glyph.dataset.terminalCustomGlyph = 'block'
    glyph.textContent = character
    this.applyStyleToElement(glyph, style, character)

    Object.assign(glyph.style, {
      backgroundColor: background,
      color: 'transparent',
      display: 'inline-block',
      fontSize: '0',
      height: 'var(--terminal-line-height)',
      lineHeight: 'var(--terminal-line-height)',
      minWidth: 'var(--terminal-cell-width)',
      overflow: 'hidden',
      position: 'relative',
      verticalAlign: 'top',
      width: 'var(--terminal-cell-width)',
    })

    paint.rects.forEach((rect) => {
      const fill = document.createElement('span')

      fill.dataset.terminalCustomGlyphRect = 'true'
      fill.setAttribute('aria-hidden', 'true')

      Object.assign(fill.style, {
        backgroundColor: foreground,
        display: 'block',
        height: `${rect.heightPercent}%`,
        left: `${rect.leftPercent}%`,
        pointerEvents: 'none',
        position: 'absolute',
        top: `${rect.topPercent}%`,
        width: `${rect.widthPercent}%`,
      })

      glyph.append(fill)
    })

    return glyph
  }

  private appendStyledTextFragment(
    fragment: DocumentFragment,
    text: string,
    style: TerminalDisplayStyle
  ): void {
    if (text.length === 0) {
      return
    }

    const span = document.createElement('span')
    span.dataset.terminalStyleRun = 'true'
    span.textContent = text
    this.applyStyleToElement(span, style, text)
    fragment.append(span)
  }

  private createTextNode(text: string, style: TerminalDisplayStyle): Node {
    const hasBlockGlyphs = BLOCK_ELEMENT_PATTERN.test(text)

    if (!this.hasStyle(style) && !hasBlockGlyphs) {
      return document.createTextNode(text)
    }

    if (!hasBlockGlyphs) {
      const span = document.createElement('span')
      span.dataset.terminalStyleRun = 'true'
      span.textContent = text
      this.applyStyleToElement(span, style, text)

      return span
    }

    const fragment = document.createDocumentFragment()
    let pendingText = ''

    for (const character of text) {
      const paint = readBlockGlyphPaint(character)

      if (!paint) {
        pendingText += character
        continue
      }

      if (this.hasStyle(style)) {
        this.appendStyledTextFragment(fragment, pendingText, style)
      } else if (pendingText.length > 0) {
        fragment.append(document.createTextNode(pendingText))
      }
      pendingText = ''
      fragment.append(this.createBlockGlyphElement(character, style, paint))
    }

    if (this.hasStyle(style)) {
      this.appendStyledTextFragment(fragment, pendingText, style)
    } else if (pendingText.length > 0) {
      fragment.append(document.createTextNode(pendingText))
    }

    return fragment
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
      height: 'var(--terminal-line-height)',
      lineHeight: 'var(--terminal-line-height)',
      maxWidth: '100%',
      minHeight: 'var(--terminal-line-height)',
      overflow: 'visible',
      whiteSpace: 'pre',
      width: '100%',
    })

    return row
  }

  private createOutputFragments(
    runs: readonly TerminalDisplayRun[],
    cursorOffset: number,
    cursorVisible: boolean
  ): Node[] {
    const rows: HTMLElement[] = [this.createOutputRow()]
    let offset = 0
    const cursorState = { didRender: !cursorVisible }
    let currentRow = rows[0]

    const appendCursor = (): void => {
      if (!cursorVisible) {
        return
      }

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
          this.appendRunFragment(runElement, text.slice(0, splitOffset), style)
          runElement.append(this.createCursorElement())
          this.appendRunFragment(runElement, text.slice(splitOffset), style)
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

  private renderOutput(options: { scrollMode?: RenderScrollMode } = {}): void {
    const text = this.outputBuffer.readText()
    const runs = this.outputBuffer.readStyledRuns()

    const cursorOffset = Math.min(
      this.outputBuffer.readCursorOffset(),
      text.length
    )

    const cursorRowIndex = readCursorRowIndex(text, cursorOffset)

    const fragments = this.createOutputFragments(
      runs,
      cursorOffset,
      this.outputBuffer.readCursorVisible()
    )

    this.output.replaceChildren(...fragments)
    this.applyScrollMode(options.scrollMode ?? 'bottom', cursorRowIndex)
  }

  private applyScrollMode(
    scrollMode: RenderScrollMode,
    cursorRowIndex: number
  ): void {
    if (scrollMode === 'bottom') {
      this.root.scrollTop = this.root.scrollHeight

      return
    }

    this.root.scrollTop = 0

    if (scrollMode === 'cursor') {
      this.scrollCursorMarkerIntoView(cursorRowIndex)
    }
  }

  private scrollCursorRowIntoView(cursorRowIndex: number): void {
    const viewportHeight = this.root.clientHeight

    if (viewportHeight <= 0) {
      return
    }

    const outputStyle = window.getComputedStyle(this.output)
    const paddingTop = parseCssPixels(outputStyle.paddingTop)
    const paddingBottom = parseCssPixels(outputStyle.paddingBottom)

    const cursorTop = paddingTop + cursorRowIndex * this.readLineHeight()

    const cursorBottom = cursorTop + this.readLineHeight()
    const viewportBottom = Math.max(0, viewportHeight - paddingBottom)

    if (cursorBottom <= viewportBottom) {
      return
    }

    const maxScrollTop = Math.max(0, this.root.scrollHeight - viewportHeight)
    const nextScrollTop = cursorBottom - viewportHeight

    this.root.scrollTop = Math.min(Math.max(0, nextScrollTop), maxScrollTop)
  }

  private scrollCursorMarkerIntoView(cursorRowIndex: number): void {
    const cursorMarker = this.root.querySelector<HTMLElement>(
      '[data-terminal-cursor-marker="true"]'
    )

    if (!cursorMarker) {
      this.scrollCursorRowIntoView(cursorRowIndex)

      return
    }

    const rootRect = this.root.getBoundingClientRect()
    const cursorRect = cursorMarker.getBoundingClientRect()

    if (rootRect.height <= 0 || cursorRect.height <= 0) {
      this.scrollCursorRowIntoView(cursorRowIndex)

      return
    }

    const outputStyle = window.getComputedStyle(this.output)
    const paddingTop = parseCssPixels(outputStyle.paddingTop)
    const paddingBottom = parseCssPixels(outputStyle.paddingBottom)
    const topOverflow = cursorRect.top - rootRect.top
    const bottomOverflow = cursorRect.bottom - rootRect.bottom

    if (topOverflow < 0) {
      this.root.scrollTop = Math.max(
        0,
        this.root.scrollTop + Math.floor(topOverflow - paddingTop)
      )

      return
    }

    if (bottomOverflow <= 0) {
      return
    }

    const maxScrollTop = Math.max(
      0,
      this.root.scrollHeight - this.root.clientHeight
    )

    this.root.scrollTop = Math.min(
      maxScrollTop,
      this.root.scrollTop + Math.ceil(bottomOverflow + paddingBottom)
    )
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
