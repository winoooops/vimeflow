// cspell:ignore ghostty libghostty prebuilds
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { TextDecoder } from 'node:util'
import { fileURLToPath } from 'node:url'
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
  }
  cells?: readonly GhosttyRenderStateBridgeSnapshotCell[]
}

export interface GhosttyRenderStateBridgeSnapshotCell {
  row: number
  col: number
  text: string
  width: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  foreground?: string
  background?: string
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
}

interface GhosttyNativeTerminalSnapshot {
  rows: number
  cursorRow: number
  cursorCol: number
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
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .some((entry) => entry.isFile() && entry.name.endsWith('.node'))
  } catch {
    return false
  }
}

const hasNativeBuildCandidate = (packageRoot: string): boolean =>
  fs.existsSync(path.join(packageRoot, 'prebuilds')) ||
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
  snapshot: GhosttyNativeTerminalSnapshot
): readonly GhosttyRenderStateBridgeSnapshotCell[] | undefined => {
  if (snapshot.cells === undefined) {
    return undefined
  }

  if (!Array.isArray(snapshot.cells)) {
    throw new Error('Ghostty native render-state snapshot cells are invalid')
  }

  return snapshot.cells.map((cell) => {
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

    return normalizedCell
  })
}

const sortSnapshotCells = (
  cells: readonly GhosttyRenderStateBridgeSnapshotCell[]
): readonly GhosttyRenderStateBridgeSnapshotCell[] =>
  [...cells].sort((left, right) =>
    left.row === right.row ? left.col - right.col : left.row - right.row
  )

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

const readCodePointLength = (text: string, cursor: number): number => {
  const codePoint = text.codePointAt(cursor)

  return codePoint !== undefined && codePoint > 0xffff ? 2 : 1
}

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

const readTextCellWidth = (text: string): number => {
  let width = 0
  let cursor = 0

  while (cursor < text.length) {
    width += readTerminalCellWidth(text, cursor)
    cursor += readCodePointLength(text, cursor)
  }

  return width
}

const findTextOffsetForCellColumn = (
  text: string,
  targetColumn: number
): number => {
  if (targetColumn <= 0) {
    return 0
  }

  let cursor = 0
  let column = 0

  while (cursor < text.length) {
    const width = readTerminalCellWidth(text, cursor)
    const nextColumn = column + width

    if (nextColumn > targetColumn) {
      return cursor
    }

    cursor += readCodePointLength(text, cursor)

    if (nextColumn === targetColumn) {
      while (cursor < text.length) {
        const codePoint = text.codePointAt(cursor) ?? 0

        if (!isCombiningCodePoint(codePoint)) {
          break
        }

        cursor += readCodePointLength(text, cursor)
      }

      return cursor
    }

    column = nextColumn
  }

  return text.length
}

const readRowTextByCellColumns = (
  rowText: string,
  start: number,
  end: number
): string => {
  const startOffset = findTextOffsetForCellColumn(rowText, start)
  const endOffset = findTextOffsetForCellColumn(rowText, end)
  const slice = rowText.slice(startOffset, endOffset)

  return slice.padEnd(
    slice.length + Math.max(0, end - start - readTextCellWidth(slice)),
    ' '
  )
}

const readRowsWithCells = (
  rows: readonly string[],
  cells: readonly GhosttyRenderStateBridgeSnapshotCell[] | undefined
): readonly string[] => {
  if (!cells || cells.length === 0) {
    return rows
  }

  const cellsByRow = new Map<number, GhosttyRenderStateBridgeSnapshotCell[]>()

  sortSnapshotCells(cells).forEach((cell) => {
    const rowCells = cellsByRow.get(cell.row) ?? []

    rowCells.push(cell)
    cellsByRow.set(cell.row, rowCells)
  })

  return rows.map((fallbackRow, rowIndex) => {
    const rowCells = cellsByRow.get(rowIndex)

    if (!rowCells || rowCells.length === 0) {
      return fallbackRow
    }

    let currentColumn = 0
    let rowText = ''

    rowCells.forEach((cell) => {
      if (cell.col > currentColumn) {
        rowText += readRowTextByCellColumns(
          fallbackRow,
          currentColumn,
          cell.col
        )
        currentColumn = cell.col
      }

      rowText +=
        cell.text === ''
          ? readRowTextByCellColumns(
              fallbackRow,
              cell.col,
              cell.col + cell.width
            )
          : cell.text
      currentColumn += cell.width
    })

    const trailingTextOffset = findTextOffsetForCellColumn(
      fallbackRow,
      currentColumn
    )

    return `${rowText}${fallbackRow.slice(trailingTextOffset)}`
  })
}

const normalizeSnapshot = (
  snapshot: GhosttyNativeTerminalSnapshot
): GhosttyRenderStateBridgeSnapshot => {
  const rows = readSnapshotRows(snapshot)
  const cells = readSnapshotCells(snapshot)
  const normalizedRows = readRowsWithCells(rows, cells)

  if (
    !isNonNegativeInteger(snapshot.cursorRow) ||
    !isNonNegativeInteger(snapshot.cursorCol)
  ) {
    throw new Error('Ghostty native render-state snapshot cursor is invalid')
  }

  return {
    rows: normalizedRows,
    cursor: {
      rowIndex: snapshot.cursorRow,
      columnOffset: snapshot.cursorCol,
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

      record.terminal.feed(bytes)

      return ok({ events })
    })
  }

  readSnapshot(ownerWebContentsId: number, payload: unknown): SnapshotResult {
    return this.withDriver(ownerWebContentsId, payload, (record) =>
      ok(normalizeSnapshot(record.terminal.snapshot({ includeCells: true })))
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
