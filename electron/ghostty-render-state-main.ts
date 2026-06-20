// cspell:ignore ghostty libghostty prebuilds
import path from 'node:path'
import { createRequire } from 'node:module'
import { TextDecoder } from 'node:util'
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
const DEFAULT_SCROLLBACK_LIMIT = 10_000
const OSC7_PREFIX = '\u001b]7;'
const OSC_BEL_TERMINATOR = '\u0007'
const OSC_ST_TERMINATOR = '\u001b\\'
const OSC_BUFFER_LIMIT = 8192

const nodeRequire = createRequire(import.meta.url)

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

interface GhosttyNativeTerminalSnapshot {
  rows: number
  cursorRow: number
  cursorCol: number
  visibleLines: readonly GhosttyNativeTerminalLine[]
}

interface GhosttyNativeTerminal {
  feed: (bytes: Uint8Array) => void
  resize: (cols: number, rows: number) => void
  snapshot: () => GhosttyNativeTerminalSnapshot
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

export const resolveGhosttyNativePackageRoot = (appRoot: string): string =>
  path.join(
    appRoot,
    'node_modules',
    ...packageNameToPathSegments(GHOSTTY_NATIVE_PACKAGE_ID)
  )

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

      if (uri.length > 0) {
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

const normalizeSnapshot = (
  snapshot: GhosttyNativeTerminalSnapshot
): GhosttyRenderStateBridgeSnapshot => {
  const rows = readSnapshotRows(snapshot)

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
    },
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

  if (!isPositiveInteger(cols) || !isPositiveInteger(rows)) {
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

      const record: GhosttyDriverRecord = {
        driverId,
        ownerWebContentsId: event.sender.id,
        osc7Scanner: new Osc7Scanner(),
        terminal: createNativeTerminal(nativeBindings, size),
        size,
      }
      this.drivers.set(driverId, record)
      event.sender.once?.('destroyed', () => {
        this.disposeDriver(driverId)
      })

      return ok({ driverId })
    })
  }

  writeBytes(payload: unknown): WriteBytesResult {
    return this.withDriver(payload, (record) => {
      const bytes = readBytes(payload)
      const events = record.osc7Scanner.write(bytes)

      record.terminal.feed(bytes)

      return ok({ events })
    })
  }

  readSnapshot(payload: unknown): SnapshotResult {
    return this.withDriver(payload, (record) =>
      ok(normalizeSnapshot(record.terminal.snapshot()))
    )
  }

  resize(payload: unknown): EmptyResult {
    try {
      const { driverId, size } = readSizePayload(payload)

      return this.withDriverId(driverId, (record) => {
        record.size = size
        record.terminal.resize(size.cols, size.rows)

        return ok(null)
      })
    } catch (error) {
      return fail(stringifyError(error))
    }
  }

  reset(payload: unknown): EmptyResult {
    return this.withDriver(payload, (record) =>
      this.withNativeBindings((nativeBindings) => {
        record.terminal.dispose()
        record.osc7Scanner.reset()
        record.terminal = createNativeTerminal(nativeBindings, record.size)

        return ok(null)
      })
    )
  }

  dispose(payload: unknown): EmptyResult {
    try {
      this.disposeDriver(readDriverId(payload))

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
    if (this.nativeBindings) {
      return callback(this.nativeBindings)
    }

    if (this.loadError) {
      return fail(this.loadError)
    }

    try {
      this.nativeBindings = loadGhosttyNativeBindings(this.appRoot)

      return callback(this.nativeBindings)
    } catch (error) {
      this.loadError = stringifyError(error)

      return fail(this.loadError)
    }
  }

  private withDriver<T>(
    payload: unknown,
    callback: (record: GhosttyDriverRecord) => IpcResult<T>
  ): IpcResult<T> {
    try {
      return this.withDriverId(readDriverId(payload), callback)
    } catch (error) {
      return fail(stringifyError(error))
    }
  }

  private withDriverId<T>(
    driverId: string,
    callback: (record: GhosttyDriverRecord) => IpcResult<T>
  ): IpcResult<T> {
    const record = this.drivers.get(driverId)

    if (!record) {
      return fail('Ghostty native render-state driver is unknown')
    }

    return callback(record)
  }

  private disposeDriver(driverId: string): void {
    const record = this.drivers.get(driverId)

    if (!record) {
      return
    }

    record.terminal.dispose()
    record.osc7Scanner.reset()
    this.drivers.delete(driverId)
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
      (_event, payload) => bridge.writeBytes(payload)
    ),
    registerSyncHandler(
      options.ipcMain,
      GHOSTTY_RENDER_STATE_READ_SNAPSHOT,
      (_event, payload) => bridge.readSnapshot(payload)
    ),
    registerSyncHandler(
      options.ipcMain,
      GHOSTTY_RENDER_STATE_RESET,
      (_event, payload) => bridge.reset(payload)
    ),
    registerSyncHandler(
      options.ipcMain,
      GHOSTTY_RENDER_STATE_RESIZE,
      (_event, payload) => bridge.resize(payload)
    ),
    registerSyncHandler(
      options.ipcMain,
      GHOSTTY_RENDER_STATE_DISPOSE,
      (_event, payload) => bridge.dispose(payload)
    ),
  ]

  return (): void => {
    disposers.forEach((dispose) => {
      dispose()
    })
    bridge.disposeAll()
  }
}
