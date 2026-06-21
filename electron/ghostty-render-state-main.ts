// cspell:ignore ghostty libghostty prebuilds
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { TextDecoder } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  readCellsByRow,
  readCursorOffsetInCellRow,
  readRowTextByCellColumns,
  readTextCellWidth,
  type GhosttyCellTraversalCell,
} from '../shared/ghosttyCellTraversal'
import {
  GHOSTTY_RENDER_STATE_CREATE,
  GHOSTTY_RENDER_STATE_DISPOSE,
  GHOSTTY_RENDER_STATE_READ_SNAPSHOT,
  GHOSTTY_RENDER_STATE_RESET,
  GHOSTTY_RENDER_STATE_RESIZE,
  GHOSTTY_RENDER_STATE_STATUS,
  GHOSTTY_RENDER_STATE_WRITE_BYTES,
} from './ghostty-render-state-channels'

const GHOSTTY_NATIVE_PACKAGE_ID = '@coder/libghostty-vt-node'
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const MAX_COLS = 1000
const MAX_ROWS = 1000
const DEFAULT_SCROLLBACK_LIMIT = 10_000
const OSC7_PREFIX = '\u001b]7;'
const OSC_BEL_TERMINATOR = '\u0007'
const OSC_ST_TERMINATOR = '\u001b\\'
const OSC_BUFFER_LIMIT = 8192
const ESC = '\u001b'
const CSI = `${ESC}[`
const CSI_PRIVATE_MODE_PREFIX = `${CSI}?`
const CURSOR_VISIBILITY_MODE = '25'

const nodeRequire = createRequire(import.meta.url)
const electronModuleDir = path.dirname(fileURLToPath(import.meta.url))

export interface GhosttyRenderStateBridgeSize {
  cols: number
  rows: number
}

export interface GhosttyRenderStateBridgeSnapshot {
  rows: readonly string[]
  cursor?: {
    rowIndex: number
    columnOffset: number
    textOffset?: number
    visible?: boolean
  }
  cells?: readonly GhosttyRenderStateBridgeSnapshotCell[]
}

export interface GhosttyRenderStateBridgeSnapshotCell extends GhosttyCellTraversalCell {
  row: number
  col: number
  text: string
  width: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  foreground?: string
  background?: string
  reverse?: boolean
}

interface GhosttyNativeTerminalOptions {
  cols: number
  rows: number
  scrollbackLimit: number
}

interface GhosttyNativeTerminalLine {
  row: number
  text: string
}

interface GhosttyNativeTerminalSnapshotCell {
  row: number
  col: number
  text: string
  width: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  foreground?: string
  background?: string
  reverse?: boolean
}

interface GhosttyNativeTerminalSnapshot {
  rows: number
  cursorRow: number
  cursorCol: number
  cursorVisible?: boolean
  visibleLines: readonly GhosttyNativeTerminalLine[]
  cells?: readonly GhosttyNativeTerminalSnapshotCell[]
}

interface GhosttyNativeTerminal {
  feed: (bytes: Uint8Array) => void
  resize: (cols: number, rows: number) => void
  snapshot: (options?: {
    includeCells?: boolean
  }) => GhosttyNativeTerminalSnapshot
  dispose: () => void
  formatHtml?: () => string
}

export interface GhosttyNativeBindings {
  createTerminal: (
    options: GhosttyNativeTerminalOptions
  ) => GhosttyNativeTerminal
  getNativeInfo?: () => unknown
}

interface GhosttyDriverRecord {
  readonly driverId: string
  readonly ownerWebContentsId: number
  readonly ownerWebContents: IpcMainEventLike['sender']
  readonly ownerWebContentsDestroyListener: () => void
  readonly osc7Scanner: Osc7Scanner
  readonly cursorVisibilityScanner: CursorVisibilityScanner
  terminal: GhosttyNativeTerminal
  size: GhosttyRenderStateBridgeSize
}

interface GhosttyRenderStateMainOptions {
  ipcMain: IpcMainLike
  appRoot: string
  nativeBindings?: GhosttyNativeBindings
}

interface IpcMainLike {
  on: (
    channel: string,
    listener: (event: IpcMainEventLike, payload?: unknown) => void
  ) => void
  removeListener: (
    channel: string,
    listener: (event: IpcMainEventLike, payload?: unknown) => void
  ) => void
}

export interface IpcMainEventLike {
  returnValue: unknown
  sender: {
    id: number
    once?: (event: 'destroyed', listener: () => void) => void
    removeListener?: (event: 'destroyed', listener: () => void) => void
  }
}

type IpcResult<T> = { ok: true; result: T } | { ok: false; error: string }

type StatusResult = IpcResult<null>
type CreateResult = IpcResult<{ driverId: string }>
type WriteBytesResult = IpcResult<{
  events: readonly GhosttyRenderStateEvent[]
}>
type SnapshotResult = IpcResult<GhosttyRenderStateBridgeSnapshot>
type EmptyResult = IpcResult<null>

interface GhosttyRenderStateEvent {
  type: 'cwd'
  uri: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  Number.isFinite(value) &&
  value > 0

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  Number.isFinite(value) &&
  value >= 0

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const ok = <T>(result: T): IpcResult<T> => ({ ok: true, result })

const fail = (error: string): IpcResult<never> => ({ ok: false, error })

const packageNameToPathSegments = (packageName: string): string[] =>
  packageName.split('/').filter((segment) => segment.length > 0)

const GHOSTTY_NATIVE_PACKAGE_PATH_SEGMENTS = packageNameToPathSegments(
  GHOSTTY_NATIVE_PACKAGE_ID
)

const hasPackageManifest = (packageRoot: string): boolean =>
  fs.existsSync(path.join(packageRoot, 'package.json'))

const hasNativeBuildFile = (dirPath: string): boolean => {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true }).some((entry) => {
      if (entry.isFile()) {
        return entry.name.endsWith('.node')
      }

      return (
        entry.isDirectory() &&
        hasNativeBuildFile(path.join(dirPath, entry.name))
      )
    })
  } catch {
    return false
  }
}

const hasNativeBuildCandidate = (packageRoot: string): boolean =>
  hasNativeBuildFile(path.join(packageRoot, 'prebuilds')) ||
  hasNativeBuildFile(path.join(packageRoot, 'build', 'Release')) ||
  hasNativeBuildFile(path.join(packageRoot, 'build', 'Debug'))

const isLoadablePackageRoot = (packageRoot: string): boolean =>
  hasPackageManifest(packageRoot) && hasNativeBuildCandidate(packageRoot)

const resolvePackageRootUnder = (basePath: string): string =>
  path.join(basePath, 'node_modules', ...GHOSTTY_NATIVE_PACKAGE_PATH_SEGMENTS)

const findPackageRootInAncestors = (startPath: string): string | null => {
  let currentDir = path.resolve(startPath)

  while (currentDir !== path.dirname(currentDir)) {
    const packageRoot = resolvePackageRootUnder(currentDir)

    if (isLoadablePackageRoot(packageRoot)) {
      return packageRoot
    }

    currentDir = path.dirname(currentDir)
  }

  return null
}

export const resolveGhosttyNativePackageRoot = (appRoot: string): string => {
  const appRootPackageRoot = resolvePackageRootUnder(appRoot)

  if (isLoadablePackageRoot(appRootPackageRoot)) {
    return appRootPackageRoot
  }

  const searchRoots = new Set([appRoot, electronModuleDir, process.cwd()])

  for (const searchRoot of searchRoots) {
    const packageRoot = findPackageRootInAncestors(searchRoot)

    if (packageRoot) {
      return packageRoot
    }
  }

  return appRootPackageRoot
}

const isGhosttyNativeBindings = (
  value: unknown
): value is GhosttyNativeBindings =>
  isRecord(value) && typeof value.createTerminal === 'function'

export const loadGhosttyNativeBindings = (
  appRoot: string
): GhosttyNativeBindings => {
  const loadNativeModule = nodeRequire('node-gyp-build') as (
    packageRoot: string
  ) => unknown

  const nativeBindings = loadNativeModule(
    resolveGhosttyNativePackageRoot(appRoot)
  )

  if (!isGhosttyNativeBindings(nativeBindings)) {
    throw new Error(
      `${GHOSTTY_NATIVE_PACKAGE_ID} did not expose createTerminal`
    )
  }

  return nativeBindings
}

const createNativeTerminal = (
  nativeBindings: GhosttyNativeBindings,
  size: GhosttyRenderStateBridgeSize
): GhosttyNativeTerminal =>
  nativeBindings.createTerminal({
    cols: size.cols,
    rows: size.rows,
    scrollbackLimit: DEFAULT_SCROLLBACK_LIMIT,
  })

const readTerminator = (
  buffer: string,
  startIndex: number
): { endIndex: number; terminatorLength: number } | null => {
  const bellIndex = buffer.indexOf(OSC_BEL_TERMINATOR, startIndex)
  const stIndex = buffer.indexOf(OSC_ST_TERMINATOR, startIndex)

  if (bellIndex === -1 && stIndex === -1) {
    return null
  }

  if (bellIndex !== -1 && (stIndex === -1 || bellIndex < stIndex)) {
    return { endIndex: bellIndex, terminatorLength: OSC_BEL_TERMINATOR.length }
  }

  return { endIndex: stIndex, terminatorLength: OSC_ST_TERMINATOR.length }
}

const retainPossiblePrefixTail = (buffer: string): string =>
  buffer.slice(-Math.max(OSC7_PREFIX.length - 1, 0))

class Osc7Scanner {
  private readonly decoder = new TextDecoder()
  private buffer = ''

  write(bytes: Uint8Array): readonly GhosttyRenderStateEvent[] {
    this.buffer += this.decoder.decode(bytes, { stream: true })

    return this.drain()
  }

  reset(): void {
    this.buffer = ''
    this.decoder.decode()
  }

  private drain(): readonly GhosttyRenderStateEvent[] {
    const events: GhosttyRenderStateEvent[] = []
    let searchIndex = 0

    while (searchIndex < this.buffer.length) {
      const oscStartIndex = this.buffer.indexOf(OSC7_PREFIX, searchIndex)

      if (oscStartIndex === -1) {
        this.buffer = retainPossiblePrefixTail(this.buffer.slice(searchIndex))

        return events
      }

      const uriStartIndex = oscStartIndex + OSC7_PREFIX.length
      const terminator = readTerminator(this.buffer, uriStartIndex)

      if (!terminator) {
        const pendingOsc = this.buffer.slice(oscStartIndex)
        this.buffer = pendingOsc.length > OSC_BUFFER_LIMIT ? '' : pendingOsc

        return events
      }

      const uri = this.buffer.slice(uriStartIndex, terminator.endIndex)

      if (uri.length > 0 && uri.length <= OSC_BUFFER_LIMIT) {
        events.push({ type: 'cwd', uri })
      }

      searchIndex = terminator.endIndex + terminator.terminatorLength
    }

    this.buffer = ''

    return events
  }
}

class CursorVisibilityScanner {
  private readonly decoder = new TextDecoder()
  private buffer = ''
  private visible = true

  write(bytes: Uint8Array): void {
    this.buffer += this.decoder.decode(bytes, { stream: true })
    this.drain()
  }

  reset(): void {
    this.visible = true
    this.buffer = ''
    this.decoder.decode()
  }

  readVisible(): boolean {
    return this.visible
  }

  private drain(): void {
    let searchIndex = 0

    while (searchIndex < this.buffer.length) {
      const sequenceStart = this.buffer.indexOf(
        CSI_PRIVATE_MODE_PREFIX,
        searchIndex
      )

      if (sequenceStart === -1) {
        this.buffer = this.buffer.slice(
          Math.max(0, this.buffer.length - CSI_PRIVATE_MODE_PREFIX.length + 1)
        )

        return
      }

      const finalStart = sequenceStart + CSI_PRIVATE_MODE_PREFIX.length
      const finalIndex = this.findPrivateModeFinal(finalStart)

      if (finalIndex === -1) {
        this.buffer = this.buffer.slice(sequenceStart)

        return
      }

      const final = this.buffer[finalIndex]
      const parameters = this.buffer.slice(finalStart, finalIndex).split(';')

      if (
        (final === 'h' || final === 'l') &&
        parameters.includes(CURSOR_VISIBILITY_MODE)
      ) {
        this.visible = final === 'h'
      }

      searchIndex = finalIndex + 1
    }

    this.buffer = ''
  }

  private findPrivateModeFinal(startIndex: number): number {
    for (let index = startIndex; index < this.buffer.length; index += 1) {
      const character = this.buffer[index]

      if (character === 'h' || character === 'l') {
        return index
      }

      if (character !== ';' && (character < '0' || character > '9')) {
        return index
      }
    }

    return -1
  }
}

interface ReverseVideoRange {
  readonly row: number
  readonly startColumn: number
  readonly endColumn: number
}

const HTML_ENTITY_PATTERN = /&(?:amp|lt|gt|quot|#39);/g
const HTML_TOKEN_PATTERN = /<[^>]*>|[^<]+/g
const HTML_STYLE_ATTRIBUTE_PATTERN = /\bstyle="([^"]*)"/i
const HTML_REVERSE_FILTER_PATTERN = /filter:\s*invert\(100%\)/i

const decodeHtmlText = (text: string): string =>
  text.replace(HTML_ENTITY_PATTERN, (entity) => {
    if (entity === '&amp;') {
      return '&'
    }

    if (entity === '&lt;') {
      return '<'
    }

    if (entity === '&gt;') {
      return '>'
    }

    if (entity === '&quot;') {
      return '"'
    }

    return "'"
  })

const isOpeningDivTag = (token: string): boolean => /^<div\b/i.test(token)

const isClosingDivTag = (token: string): boolean => /^<\/div\s*>$/i.test(token)

const hasReverseVideoStyle = (token: string): boolean => {
  const match = HTML_STYLE_ATTRIBUTE_PATTERN.exec(token)

  return match ? HTML_REVERSE_FILTER_PATTERN.test(match[1]) : false
}

const appendReverseVideoRange = (
  ranges: ReverseVideoRange[],
  range: ReverseVideoRange
): void => {
  if (ranges.length === 0) {
    ranges.push(range)

    return
  }

  const previous = ranges[ranges.length - 1]

  if (previous.row === range.row && previous.endColumn === range.startColumn) {
    ranges[ranges.length - 1] = {
      row: previous.row,
      startColumn: previous.startColumn,
      endColumn: range.endColumn,
    }

    return
  }

  ranges.push(range)
}

const readReverseVideoRangesFromHtml = (
  html: string
): readonly ReverseVideoRange[] => {
  const ranges: ReverseVideoRange[] = []
  const reverseStack = [false]
  let row = 0
  let column = 0

  Array.from(html.matchAll(HTML_TOKEN_PATTERN)).forEach((match) => {
    const token = match[0]

    if (isOpeningDivTag(token)) {
      const parentReverse = reverseStack[reverseStack.length - 1] ?? false
      reverseStack.push(parentReverse || hasReverseVideoStyle(token))

      return
    }

    if (isClosingDivTag(token)) {
      reverseStack.pop()

      return
    }

    const reverse = reverseStack[reverseStack.length - 1] ?? false

    for (const character of decodeHtmlText(token)) {
      if (character === '\n') {
        row += 1
        column = 0
        continue
      }

      const width = readTextCellWidth(character)

      if (reverse && width > 0) {
        appendReverseVideoRange(ranges, {
          row,
          startColumn: column,
          endColumn: column + width,
        })
      }

      column += width
    }
  })

  return ranges
}

const readTerminalReverseVideoRanges = (
  terminal: GhosttyNativeTerminal
): readonly ReverseVideoRange[] => {
  if (!terminal.formatHtml) {
    return []
  }

  try {
    return readReverseVideoRangesFromHtml(terminal.formatHtml())
  } catch {
    return []
  }
}

const isCellReverseVideo = (
  cell: GhosttyRenderStateBridgeSnapshotCell,
  ranges: readonly ReverseVideoRange[]
): boolean =>
  ranges.some(
    (range) =>
      range.row === cell.row &&
      cell.col < range.endColumn &&
      cell.col + cell.width > range.startColumn
  )

const appendMissingReverseCells = (
  cells: GhosttyRenderStateBridgeSnapshotCell[],
  rows: readonly string[],
  ranges: readonly ReverseVideoRange[]
): void => {
  ranges.forEach((range) => {
    if (range.row >= rows.length || range.endColumn <= range.startColumn) {
      return
    }

    let startColumn = range.startColumn

    cells
      .filter(
        (cell) =>
          cell.row === range.row &&
          cell.col < range.endColumn &&
          cell.col + cell.width > range.startColumn
      )
      .sort((left, right) => left.col - right.col)
      .forEach((cell) => {
        if (cell.col > startColumn) {
          cells.push({
            row: range.row,
            col: startColumn,
            text: readRowTextByCellColumns(
              rows[range.row] ?? '',
              startColumn,
              Math.min(cell.col, range.endColumn)
            ),
            width: Math.min(cell.col, range.endColumn) - startColumn,
            reverse: true,
          })
        }

        startColumn = Math.max(startColumn, cell.col + cell.width)
      })

    if (startColumn < range.endColumn) {
      cells.push({
        row: range.row,
        col: startColumn,
        text: readRowTextByCellColumns(
          rows[range.row] ?? '',
          startColumn,
          range.endColumn
        ),
        width: range.endColumn - startColumn,
        reverse: true,
      })
    }
  })
}

const readSnapshotRows = (
  snapshot: GhosttyNativeTerminalSnapshot
): readonly string[] => {
  if (!isPositiveInteger(snapshot.rows)) {
    throw new Error('Ghostty native render-state snapshot row count is invalid')
  }

  if (!Array.isArray(snapshot.visibleLines)) {
    throw new Error('Ghostty native render-state snapshot rows are invalid')
  }

  const rows = Array.from({ length: snapshot.rows }, () => '')

  snapshot.visibleLines.forEach((line) => {
    if (
      !isRecord(line) ||
      !isNonNegativeInteger(line.row) ||
      line.row >= snapshot.rows ||
      typeof line.text !== 'string'
    ) {
      throw new Error('Ghostty native render-state snapshot rows are invalid')
    }

    rows[line.row] = line.text
  })

  return rows
}

const readSnapshotCells = (
  snapshot: GhosttyNativeTerminalSnapshot,
  rows: readonly string[],
  reverseVideoRanges: readonly ReverseVideoRange[]
): readonly GhosttyRenderStateBridgeSnapshotCell[] | undefined => {
  if (snapshot.cells === undefined && reverseVideoRanges.length === 0) {
    return undefined
  }

  if (snapshot.cells !== undefined && !Array.isArray(snapshot.cells)) {
    throw new Error('Ghostty native render-state snapshot cells are invalid')
  }

  const cells = (snapshot.cells ?? []).map((cell) => {
    if (
      !isRecord(cell) ||
      !isNonNegativeInteger(cell.row) ||
      cell.row >= snapshot.rows ||
      !isNonNegativeInteger(cell.col) ||
      typeof cell.text !== 'string' ||
      !isNonNegativeInteger(cell.width)
    ) {
      throw new Error('Ghostty native render-state snapshot cells are invalid')
    }

    const normalizedCell: GhosttyRenderStateBridgeSnapshotCell = {
      row: cell.row,
      col: cell.col,
      text: cell.text,
      width: cell.width,
    }

    if (cell.bold === true) {
      normalizedCell.bold = true
    }

    if (cell.italic === true) {
      normalizedCell.italic = true
    }

    if (cell.underline === true) {
      normalizedCell.underline = true
    }

    if (typeof cell.foreground === 'string') {
      normalizedCell.foreground = cell.foreground
    }

    if (typeof cell.background === 'string') {
      normalizedCell.background = cell.background
    }

    if (
      cell.reverse === true ||
      isCellReverseVideo(normalizedCell, reverseVideoRanges)
    ) {
      normalizedCell.reverse = true
    }

    return normalizedCell
  })

  appendMissingReverseCells(cells, rows, reverseVideoRanges)

  return cells.sort((left, right) =>
    left.row === right.row ? left.col - right.col : left.row - right.row
  )
}

const normalizeSnapshot = (
  snapshot: GhosttyNativeTerminalSnapshot,
  cursorVisible: boolean,
  reverseVideoRanges: readonly ReverseVideoRange[]
): GhosttyRenderStateBridgeSnapshot => {
  const rows = readSnapshotRows(snapshot)
  const cells = readSnapshotCells(snapshot, rows, reverseVideoRanges)
  const cellsByRow = readCellsByRow(cells)
  const cursorRowCells = cellsByRow.get(snapshot.cursorRow)

  const snapshotCursorVisible =
    typeof snapshot.cursorVisible === 'boolean'
      ? snapshot.cursorVisible
      : cursorVisible

  if (
    !isNonNegativeInteger(snapshot.cursorRow) ||
    !isNonNegativeInteger(snapshot.cursorCol)
  ) {
    throw new Error('Ghostty native render-state snapshot cursor is invalid')
  }

  return {
    rows,
    cursor: {
      rowIndex: snapshot.cursorRow,
      columnOffset: snapshot.cursorCol,
      ...(snapshotCursorVisible === false ? { visible: false } : {}),
      ...(cursorRowCells === undefined
        ? {}
        : {
            textOffset: readCursorOffsetInCellRow(
              rows[snapshot.cursorRow] ?? '',
              cursorRowCells,
              snapshot.cursorCol
            ),
          }),
    },
    ...(cells === undefined ? {} : { cells }),
  }
}

const readDriverId = (payload: unknown): string => {
  if (!isRecord(payload) || typeof payload.driverId !== 'string') {
    throw new Error('Ghostty native render-state driver id is invalid')
  }

  return payload.driverId
}

const readBytes = (payload: unknown): Uint8Array => {
  if (!isRecord(payload)) {
    throw new Error('Ghostty native render-state bytes payload is invalid')
  }

  const { bytes } = payload

  if (bytes instanceof Uint8Array) {
    return bytes
  }

  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  throw new Error('Ghostty native render-state bytes payload is invalid')
}

const readSizePayload = (
  payload: unknown
): {
  driverId: string
  size: GhosttyRenderStateBridgeSize
} => {
  if (!isRecord(payload) || !isRecord(payload.size)) {
    throw new Error('Ghostty native render-state size payload is invalid')
  }

  const driverId = readDriverId(payload)
  const { cols, rows } = payload.size

  if (
    !isPositiveInteger(cols) ||
    !isPositiveInteger(rows) ||
    cols > MAX_COLS ||
    rows > MAX_ROWS
  ) {
    throw new Error('Ghostty native render-state size is invalid')
  }

  return { driverId, size: { cols, rows } }
}

export class GhosttyRenderStateMainBridge {
  private readonly drivers = new Map<string, GhosttyDriverRecord>()
  private nativeBindings: GhosttyNativeBindings | null
  private loadError: string | null = null
  private nextDriverId = 1

  constructor(
    private readonly appRoot: string,
    nativeBindings?: GhosttyNativeBindings
  ) {
    this.nativeBindings = nativeBindings ?? null
  }

  status(): StatusResult {
    return this.withNativeBindings(() => ok(null))
  }

  createDriver(event: IpcMainEventLike): CreateResult {
    return this.withNativeBindings((nativeBindings) => {
      const size = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS }
      const driverId = String(this.nextDriverId)
      this.nextDriverId += 1

      const ownerWebContentsDestroyListener = (): void => {
        this.disposeDriver(driverId)
      }

      const record: GhosttyDriverRecord = {
        driverId,
        ownerWebContentsId: event.sender.id,
        ownerWebContents: event.sender,
        ownerWebContentsDestroyListener,
        osc7Scanner: new Osc7Scanner(),
        cursorVisibilityScanner: new CursorVisibilityScanner(),
        terminal: createNativeTerminal(nativeBindings, size),
        size,
      }
      this.drivers.set(driverId, record)
      event.sender.once?.('destroyed', ownerWebContentsDestroyListener)

      return ok({ driverId })
    })
  }

  writeBytes(ownerWebContentsId: number, payload: unknown): WriteBytesResult {
    return this.withDriver(ownerWebContentsId, payload, (record) => {
      const bytes = readBytes(payload)
      const events = record.osc7Scanner.write(bytes)

      record.cursorVisibilityScanner.write(bytes)
      record.terminal.feed(bytes)

      return ok({ events })
    })
  }

  readSnapshot(ownerWebContentsId: number, payload: unknown): SnapshotResult {
    return this.withDriver(ownerWebContentsId, payload, (record) =>
      ok(
        normalizeSnapshot(
          record.terminal.snapshot({ includeCells: true }),
          record.cursorVisibilityScanner.readVisible(),
          readTerminalReverseVideoRanges(record.terminal)
        )
      )
    )
  }

  resize(ownerWebContentsId: number, payload: unknown): EmptyResult {
    try {
      const { driverId, size } = readSizePayload(payload)

      return this.withDriverId(driverId, ownerWebContentsId, (record) => {
        record.terminal.resize(size.cols, size.rows)
        record.size = size

        return ok(null)
      })
    } catch (error) {
      return fail(stringifyError(error))
    }
  }

  reset(ownerWebContentsId: number, payload: unknown): EmptyResult {
    return this.withDriver(ownerWebContentsId, payload, (record) =>
      this.withNativeBindings((nativeBindings) => {
        const terminal = createNativeTerminal(nativeBindings, record.size)
        const previousTerminal = record.terminal

        record.terminal = terminal
        record.osc7Scanner.reset()
        record.cursorVisibilityScanner.reset()

        try {
          previousTerminal.dispose()
        } catch (error) {
          return fail(stringifyError(error))
        }

        return ok(null)
      })
    )
  }

  dispose(ownerWebContentsId: number, payload: unknown): EmptyResult {
    try {
      const driverId = readDriverId(payload)
      const record = this.drivers.get(driverId)

      if (record?.ownerWebContentsId !== ownerWebContentsId) {
        return fail('Ghostty native render-state driver is unknown')
      }

      this.disposeDriver(driverId)

      return ok(null)
    } catch (error) {
      return fail(stringifyError(error))
    }
  }

  disposeAll(): void {
    Array.from(this.drivers.keys()).forEach((driverId) => {
      this.disposeDriver(driverId)
    })
  }

  private withNativeBindings<T>(
    callback: (nativeBindings: GhosttyNativeBindings) => IpcResult<T>
  ): IpcResult<T> {
    try {
      if (this.nativeBindings) {
        return callback(this.nativeBindings)
      }

      if (this.loadError) {
        return fail(this.loadError)
      }

      this.nativeBindings = loadGhosttyNativeBindings(this.appRoot)

      return callback(this.nativeBindings)
    } catch (error) {
      const message = stringifyError(error)

      if (!this.nativeBindings) {
        this.loadError = message
      }

      return fail(message)
    }
  }

  private withDriver<T>(
    ownerWebContentsId: number,
    payload: unknown,
    callback: (record: GhosttyDriverRecord) => IpcResult<T>
  ): IpcResult<T> {
    try {
      return this.withDriverId(
        readDriverId(payload),
        ownerWebContentsId,
        callback
      )
    } catch (error) {
      return fail(stringifyError(error))
    }
  }

  private withDriverId<T>(
    driverId: string,
    ownerWebContentsId: number,
    callback: (record: GhosttyDriverRecord) => IpcResult<T>
  ): IpcResult<T> {
    const record = this.drivers.get(driverId)

    if (record?.ownerWebContentsId !== ownerWebContentsId) {
      return fail('Ghostty native render-state driver is unknown')
    }

    return callback(record)
  }

  private disposeDriver(driverId: string): void {
    const record = this.drivers.get(driverId)

    if (!record) {
      return
    }

    this.drivers.delete(driverId)
    record.ownerWebContents.removeListener?.(
      'destroyed',
      record.ownerWebContentsDestroyListener
    )
    record.terminal.dispose()
    record.osc7Scanner.reset()
    record.cursorVisibilityScanner.reset()
  }
}

const registerSyncHandler = (
  ipcMain: IpcMainLike,
  channel: string,
  handler: (event: IpcMainEventLike, payload?: unknown) => unknown
): (() => void) => {
  const listener = (event: IpcMainEventLike, payload?: unknown): void => {
    event.returnValue = handler(event, payload)
  }

  ipcMain.on(channel, listener)

  return (): void => {
    ipcMain.removeListener(channel, listener)
  }
}

export const setupGhosttyRenderStateIpc = (
  options: GhosttyRenderStateMainOptions
): (() => void) => {
  const bridge = new GhosttyRenderStateMainBridge(
    options.appRoot,
    options.nativeBindings
  )

  const disposers = [
    registerSyncHandler(options.ipcMain, GHOSTTY_RENDER_STATE_STATUS, () =>
      bridge.status()
    ),
    registerSyncHandler(options.ipcMain, GHOSTTY_RENDER_STATE_CREATE, (event) =>
      bridge.createDriver(event)
    ),
    registerSyncHandler(
      options.ipcMain,
      GHOSTTY_RENDER_STATE_WRITE_BYTES,
      (event, payload) => bridge.writeBytes(event.sender.id, payload)
    ),
    registerSyncHandler(
      options.ipcMain,
      GHOSTTY_RENDER_STATE_READ_SNAPSHOT,
      (event, payload) => bridge.readSnapshot(event.sender.id, payload)
    ),
    registerSyncHandler(
      options.ipcMain,
      GHOSTTY_RENDER_STATE_RESET,
      (event, payload) => bridge.reset(event.sender.id, payload)
    ),
    registerSyncHandler(
      options.ipcMain,
      GHOSTTY_RENDER_STATE_RESIZE,
      (event, payload) => bridge.resize(event.sender.id, payload)
    ),
    registerSyncHandler(
      options.ipcMain,
      GHOSTTY_RENDER_STATE_DISPOSE,
      (event, payload) => bridge.dispose(event.sender.id, payload)
    ),
  ]

  return (): void => {
    disposers.forEach((dispose) => {
      dispose()
    })
    bridge.disposeAll()
  }
}
