// cspell:ignore ghostty libghostty
import type {
  BackendApi,
  GhosttyRenderStateBridge,
} from '../../../../lib/backend'
import type {
  GhosttyVtRenderStateDriver,
  GhosttyVtRenderStateDriverFactory,
} from './ghosttyVtRenderStateDriver'
import type { GhosttyVtRenderSnapshot } from './ghosttyVtRenderSnapshot'
import { readTextCellWidth } from './terminalDisplayBuffer'

export const GHOSTTY_NATIVE_RENDER_STATE_DRIVER_PROVIDER_ID = 'native'

const NATIVE_BRIDGE_UNAVAILABLE_MESSAGE =
  'Ghostty native render-state bridge is unavailable; package and expose a libghostty-vt bridge from the Electron preload before selecting VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER=native'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  Number.isFinite(value) &&
  value >= 0

const readVimeflowBridge = (): BackendApi | null => {
  if (typeof window === 'undefined') {
    return null
  }

  return window.vimeflow ?? null
}

export const readGhosttyNativeRenderStateBridge =
  (): GhosttyRenderStateBridge => {
    const bridge = readVimeflowBridge()
    const nativeBridge = bridge?.ghosttyRenderState

    if (!nativeBridge) {
      const loadError = bridge?.ghosttyRenderStateLoadError

      throw new Error(
        loadError
          ? `${NATIVE_BRIDGE_UNAVAILABLE_MESSAGE}: ${loadError}`
          : NATIVE_BRIDGE_UNAVAILABLE_MESSAGE
      )
    }

    return nativeBridge
  }

export const assertGhosttyNativeRenderStateBridgeAvailable = (): void => {
  void readGhosttyNativeRenderStateBridge()
}

const readSnapshotRows = (
  snapshot: Record<string, unknown>
): readonly string[] => {
  const rows = snapshot.rows

  if (!Array.isArray(rows)) {
    throw new Error('Ghostty native render-state snapshot rows are invalid')
  }

  return rows.map((row) => {
    if (typeof row !== 'string') {
      throw new Error('Ghostty native render-state snapshot rows are invalid')
    }

    return row
  })
}

const readSnapshotCells = (
  snapshot: Record<string, unknown>,
  rowCount: number
): GhosttyVtRenderSnapshot['cells'] => {
  const cells = snapshot.cells

  if (cells === undefined) {
    return undefined
  }

  if (!Array.isArray(cells)) {
    throw new Error('Ghostty native render-state snapshot cells are invalid')
  }

  return cells.map((cell) => {
    if (!isRecord(cell)) {
      throw new Error('Ghostty native render-state snapshot cells are invalid')
    }

    const { row, col, text, width } = cell

    if (
      !isNonNegativeInteger(row) ||
      row >= rowCount ||
      !isNonNegativeInteger(col) ||
      typeof text !== 'string' ||
      !isNonNegativeInteger(width)
    ) {
      throw new Error('Ghostty native render-state snapshot cells are invalid')
    }

    return {
      row,
      col,
      text,
      width,
      ...(cell.bold === true ? { bold: true } : {}),
      ...(cell.italic === true ? { italic: true } : {}),
      ...(cell.underline === true ? { underline: true } : {}),
      ...(typeof cell.foreground === 'string'
        ? { foreground: cell.foreground }
        : {}),
      ...(typeof cell.background === 'string'
        ? { background: cell.background }
        : {}),
    }
  })
}

const readSnapshotCursor = (
  snapshot: Record<string, unknown>,
  rowCount: number
): GhosttyVtRenderSnapshot['cursor'] => {
  const cursor = snapshot.cursor

  if (cursor === undefined) {
    return undefined
  }

  if (!isRecord(cursor)) {
    throw new Error('Ghostty native render-state snapshot cursor is invalid')
  }

  const { rowIndex, columnOffset } = cursor

  if (
    !isNonNegativeInteger(rowIndex) ||
    rowIndex >= rowCount ||
    !isNonNegativeInteger(columnOffset)
  ) {
    throw new Error('Ghostty native render-state snapshot cursor is invalid')
  }

  return { rowIndex, columnOffset }
}

const padRowsToCursor = (
  rows: readonly string[],
  cursor: GhosttyVtRenderSnapshot['cursor']
): readonly string[] => {
  if (cursor === undefined) {
    return rows
  }

  return rows.map((row, rowIndex) => {
    const cellWidth = readTextCellWidth(row)

    return rowIndex === cursor.rowIndex && cellWidth < cursor.columnOffset
      ? row.padEnd(row.length + cursor.columnOffset - cellWidth, ' ')
      : row
  })
}

const normalizeNativeSnapshot = (
  snapshot: unknown
): GhosttyVtRenderSnapshot => {
  if (!isRecord(snapshot)) {
    throw new Error('Ghostty native render-state snapshot is invalid')
  }

  const rows = readSnapshotRows(snapshot)
  const cursor = readSnapshotCursor(snapshot, rows.length)
  const cells = readSnapshotCells(snapshot, rows.length)
  const paddedRows = padRowsToCursor(rows, cursor)

  return {
    rows: paddedRows,
    ...(cursor === undefined ? {} : { cursor }),
    ...(cells === undefined ? {} : { cells }),
  }
}

export const createGhosttyNativeRenderStateDriver: GhosttyVtRenderStateDriverFactory =
  (effects): GhosttyVtRenderStateDriver => {
    const bridge = readGhosttyNativeRenderStateBridge()

    const driver = bridge.createDriver({
      onCwdChange: effects.onCwdChange,
    })

    return {
      writeBytes: (bytes): void => {
        driver.writeBytes(bytes)
      },
      readSnapshot: (): GhosttyVtRenderSnapshot =>
        normalizeNativeSnapshot(driver.readSnapshot()),
      reset: (): void => {
        driver.reset?.()
      },
      resize: (size): void => {
        driver.resize?.(size)
      },
      dispose: (): void => {
        driver.dispose?.()
      },
    }
  }
