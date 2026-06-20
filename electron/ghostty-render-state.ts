// cspell:ignore ghostty libghostty prebuilds
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { TextDecoder } from 'node:util'

const GHOSTTY_NATIVE_PACKAGE_ID = '@coder/libghostty-vt-node'
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const DEFAULT_SCROLLBACK_LIMIT = 10_000
const OSC7_PREFIX = '\u001b]7;'
const OSC_BEL_TERMINATOR = '\u0007'
const OSC_ST_TERMINATOR = '\u001b\\'
const OSC_BUFFER_LIMIT = 8192

const nodeRequire = createRequire(import.meta.url)

export interface GhosttyRenderStateBridgeEffects {
  onCwdChange: (uri: string) => void
}

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

export interface GhosttyRenderStateBridgeDriver {
  writeBytes: (bytes: Uint8Array) => void
  readSnapshot: () => GhosttyRenderStateBridgeSnapshot
  reset: () => void
  resize: (size: GhosttyRenderStateBridgeSize) => void
  dispose: () => void
}

export interface GhosttyRenderStateBridge {
  createDriver: (
    effects: GhosttyRenderStateBridgeEffects
  ) => GhosttyRenderStateBridgeDriver
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

export interface GhosttyRenderStateBridgeLoadResult {
  bridge?: GhosttyRenderStateBridge
  error?: string
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

const stringifyLoadError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const resolveAppRoot = (): string => {
  const preloadDirectory = path.dirname(fileURLToPath(import.meta.url))

  return path.dirname(preloadDirectory)
}

const packageNameToPathSegments = (packageName: string): string[] =>
  packageName.split('/').filter((segment) => segment.length > 0)

export const resolveGhosttyNativePackageRoot = (): string =>
  path.join(
    resolveAppRoot(),
    'node_modules',
    ...packageNameToPathSegments(GHOSTTY_NATIVE_PACKAGE_ID)
  )

const isGhosttyNativeBindings = (
  value: unknown
): value is GhosttyNativeBindings =>
  isRecord(value) && typeof value.createTerminal === 'function'

export const loadGhosttyNativeBindings = (): GhosttyNativeBindings => {
  const loadNativeModule = nodeRequire('node-gyp-build') as (
    packageRoot: string
  ) => unknown
  const nativeBindings = loadNativeModule(resolveGhosttyNativePackageRoot())

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

const assertSize = (size: GhosttyRenderStateBridgeSize): void => {
  if (!isPositiveInteger(size.cols) || !isPositiveInteger(size.rows)) {
    throw new Error('Ghostty native render-state size is invalid')
  }
}

const assertActive = (disposed: boolean): void => {
  if (disposed) {
    throw new Error('Ghostty native render-state driver has been disposed')
  }
}

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

  constructor(private readonly onCwdChange: (uri: string) => void) {}

  write(bytes: Uint8Array): void {
    this.buffer += this.decoder.decode(bytes, { stream: true })
    this.drain()
  }

  reset(): void {
    this.buffer = ''
    this.decoder.decode()
  }

  private drain(): void {
    let searchIndex = 0

    while (searchIndex < this.buffer.length) {
      const oscStartIndex = this.buffer.indexOf(OSC7_PREFIX, searchIndex)

      if (oscStartIndex === -1) {
        this.buffer = retainPossiblePrefixTail(this.buffer.slice(searchIndex))

        return
      }

      const uriStartIndex = oscStartIndex + OSC7_PREFIX.length
      const terminator = readTerminator(this.buffer, uriStartIndex)

      if (!terminator) {
        const pendingOsc = this.buffer.slice(oscStartIndex)
        this.buffer = pendingOsc.length > OSC_BUFFER_LIMIT ? '' : pendingOsc

        return
      }

      const uri = this.buffer.slice(uriStartIndex, terminator.endIndex)

      if (uri.length > 0) {
        this.onCwdChange(uri)
      }

      searchIndex = terminator.endIndex + terminator.terminatorLength
    }

    this.buffer = ''
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

export const createGhosttyRenderStateBridge = (
  nativeBindings: GhosttyNativeBindings
): GhosttyRenderStateBridge => ({
  createDriver: (effects): GhosttyRenderStateBridgeDriver => {
    let disposed = false
    let size: GhosttyRenderStateBridgeSize = {
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    }
    let terminal = createNativeTerminal(nativeBindings, size)
    const osc7Scanner = new Osc7Scanner(effects.onCwdChange)

    return {
      writeBytes: (bytes): void => {
        assertActive(disposed)
        osc7Scanner.write(bytes)
        terminal.feed(bytes)
      },
      readSnapshot: (): GhosttyRenderStateBridgeSnapshot => {
        assertActive(disposed)

        return normalizeSnapshot(terminal.snapshot())
      },
      reset: (): void => {
        assertActive(disposed)
        terminal.dispose()
        osc7Scanner.reset()
        terminal = createNativeTerminal(nativeBindings, size)
      },
      resize: (nextSize): void => {
        assertActive(disposed)
        assertSize(nextSize)
        size = nextSize
        terminal.resize(nextSize.cols, nextSize.rows)
      },
      dispose: (): void => {
        if (disposed) {
          return
        }

        disposed = true
        terminal.dispose()
        osc7Scanner.reset()
      },
    }
  },
})

export const loadOptionalGhosttyRenderStateBridge =
  (): GhosttyRenderStateBridgeLoadResult => {
    try {
      return {
        bridge: createGhosttyRenderStateBridge(loadGhosttyNativeBindings()),
      }
    } catch (error) {
      return {
        error: stringifyLoadError(error),
      }
    }
  }
