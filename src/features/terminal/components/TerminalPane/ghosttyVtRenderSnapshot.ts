// cspell:ignore ghostty
import {
  findTextOffsetForCellColumn,
  readTextCellWidth,
} from './terminalDisplayBuffer'
import { getSgrStyleSentinel } from './terminalControlParser'
import type { TerminalParserEngineOutput } from './terminalParserEngine'

export interface GhosttyVtRenderSnapshotCursor {
  readonly rowIndex: number
  readonly columnOffset: number
}

export interface GhosttyVtRenderSnapshotCell {
  readonly row: number
  readonly col: number
  readonly text: string
  readonly width: number
  readonly bold?: boolean
  readonly italic?: boolean
  readonly underline?: boolean
  readonly foreground?: string
  readonly background?: string
}

export interface GhosttyVtRenderSnapshot {
  readonly rows: readonly string[]
  readonly cursor?: GhosttyVtRenderSnapshotCursor
  readonly cells?: readonly GhosttyVtRenderSnapshotCell[]
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

interface SnapshotStyle {
  readonly bold?: boolean
  readonly italic?: boolean
  readonly underline?: boolean
  readonly foreground?: string
  readonly background?: string
}

const HEX_COLOR_PATTERN = /^#?([0-9a-f]{6})$/i

const readSgrColorParameters = (
  selector: 38 | 48,
  color: string | undefined
): readonly number[] => {
  if (!color) {
    return []
  }

  const match = HEX_COLOR_PATTERN.exec(color.trim())

  if (!match) {
    return []
  }

  const hex = match[1]
  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)

  return [selector, 2, red, green, blue]
}

const readCellStyle = (cell: GhosttyVtRenderSnapshotCell): SnapshotStyle => ({
  ...(cell.bold === true ? { bold: true } : {}),
  ...(cell.italic === true ? { italic: true } : {}),
  ...(cell.underline === true ? { underline: true } : {}),
  ...(cell.foreground ? { foreground: cell.foreground } : {}),
  ...(cell.background ? { background: cell.background } : {}),
})

const readStyleKey = (style: SnapshotStyle): string =>
  [
    style.bold === true ? '1' : '',
    style.italic === true ? '3' : '',
    style.underline === true ? '4' : '',
    style.foreground ?? '',
    style.background ?? '',
  ].join('|')

const EMPTY_STYLE_KEY = readStyleKey({})

const readStyleParameters = (style: SnapshotStyle): readonly number[] => [
  0,
  ...(style.bold === true ? [1] : []),
  ...(style.italic === true ? [3] : []),
  ...(style.underline === true ? [4] : []),
  ...readSgrColorParameters(38, style.foreground),
  ...readSgrColorParameters(48, style.background),
]

const sortCells = (
  cells: readonly GhosttyVtRenderSnapshotCell[]
): readonly GhosttyVtRenderSnapshotCell[] =>
  [...cells].sort((left, right) =>
    left.row === right.row ? left.col - right.col : left.row - right.row
  )

const readCellRows = (
  cells: readonly GhosttyVtRenderSnapshotCell[] | undefined
): ReadonlySet<number> => new Set((cells ?? []).map((cell) => cell.row))

const readLeadingEmptyRowCount = (
  snapshot: GhosttyVtRenderSnapshot
): number => {
  const cellRows = readCellRows(snapshot.cells)

  const firstContentRow = snapshot.rows.findIndex(
    (row, rowIndex) => row.length > 0 || cellRows.has(rowIndex)
  )

  if (firstContentRow <= 0) {
    return 0
  }

  const cursor = snapshot.cursor

  return !cursor || cursor.rowIndex >= firstContentRow ? firstContentRow : 0
}

const trimLeadingEmptyRows = (
  snapshot: GhosttyVtRenderSnapshot
): GhosttyVtRenderSnapshot => {
  const leadingRows = readLeadingEmptyRowCount(snapshot)

  if (leadingRows === 0) {
    return snapshot
  }

  return {
    rows: [
      ...snapshot.rows.slice(leadingRows),
      ...Array.from({ length: leadingRows }, () => ''),
    ],
    ...(snapshot.cursor
      ? {
          cursor: {
            rowIndex: snapshot.cursor.rowIndex - leadingRows,
            columnOffset: snapshot.cursor.columnOffset,
          },
        }
      : {}),
    ...(snapshot.cells
      ? {
          cells: snapshot.cells
            .filter((cell) => cell.row >= leadingRows)
            .map((cell) => ({
              ...cell,
              row: cell.row - leadingRows,
            })),
        }
      : {}),
  }
}

const readSnapshotText = (snapshot: GhosttyVtRenderSnapshot): string =>
  snapshot.rows.join('\n')

const readCellsByRow = (
  cells: readonly GhosttyVtRenderSnapshotCell[] | undefined
): Map<number, readonly GhosttyVtRenderSnapshotCell[]> => {
  const cellsByRow = new Map<number, GhosttyVtRenderSnapshotCell[]>()

  sortCells(cells ?? []).forEach((cell) => {
    const rowCells = cellsByRow.get(cell.row) ?? []

    rowCells.push(cell)
    cellsByRow.set(cell.row, rowCells)
  })

  return cellsByRow
}

const readStyledRowText = (
  rowText: string,
  rowCells: readonly GhosttyVtRenderSnapshotCell[] | undefined
): string => {
  if (!rowCells || rowCells.length === 0) {
    return rowText
  }

  let output = ''
  let activeStyleKey = EMPTY_STYLE_KEY
  let currentColumn = 0

  const readRowTextByCellColumns = (start: number, end: number): string => {
    const startOffset = findTextOffsetForCellColumn(rowText, start)
    const endOffset = findTextOffsetForCellColumn(rowText, end)
    const slice = rowText.slice(startOffset, endOffset)

    return slice.padEnd(
      slice.length + Math.max(0, end - start - readTextCellWidth(slice)),
      ' '
    )
  }

  rowCells.forEach((cell) => {
    if (cell.col > currentColumn) {
      if (activeStyleKey !== EMPTY_STYLE_KEY) {
        output += getSgrStyleSentinel([0])
        activeStyleKey = EMPTY_STYLE_KEY
      }

      output += readRowTextByCellColumns(currentColumn, cell.col)
      currentColumn = cell.col
    }

    const style = readCellStyle(cell)
    const styleKey = readStyleKey(style)

    if (styleKey !== activeStyleKey) {
      output += getSgrStyleSentinel(readStyleParameters(style))
      activeStyleKey = styleKey
    }

    output +=
      cell.text === ''
        ? readRowTextByCellColumns(cell.col, cell.col + cell.width)
        : cell.text
    currentColumn += cell.width
  })

  if (activeStyleKey !== EMPTY_STYLE_KEY) {
    output += getSgrStyleSentinel([0])
  }

  const trailingTextOffset = findTextOffsetForCellColumn(rowText, currentColumn)
  output += rowText.slice(trailingTextOffset)

  return output
}

const readSnapshotDisplayText = (snapshot: GhosttyVtRenderSnapshot): string => {
  if (!snapshot.cells || snapshot.cells.length === 0) {
    return readSnapshotText(snapshot)
  }

  const cellsByRow = readCellsByRow(snapshot.cells)

  return snapshot.rows
    .map((row, rowIndex) => readStyledRowText(row, cellsByRow.get(rowIndex)))
    .join('\n')
}

const readSnapshotCursorOffset = (
  snapshot: GhosttyVtRenderSnapshot,
  text: string
): number => {
  const cursor = snapshot.cursor

  if (!cursor || snapshot.rows.length === 0) {
    return text.length
  }

  const rowIndex = clamp(cursor.rowIndex, 0, snapshot.rows.length - 1)
  const row = snapshot.rows[rowIndex] ?? ''
  const rowTextOffset = findTextOffsetForCellColumn(row, cursor.columnOffset)

  const precedingRowsLength = snapshot.rows
    .slice(0, rowIndex)
    .reduce((length, previousRow) => length + previousRow.length + 1, 0)

  return precedingRowsLength + rowTextOffset
}

export const createGhosttyVtRenderSnapshotOutput = (
  snapshot: GhosttyVtRenderSnapshot
): TerminalParserEngineOutput => {
  const normalizedSnapshot = trimLeadingEmptyRows(snapshot)
  const text = readSnapshotText(normalizedSnapshot)
  const displayText = readSnapshotDisplayText(normalizedSnapshot)
  const cursorOffset = readSnapshotCursorOffset(normalizedSnapshot, text)

  return {
    visibleText: text,
    displayDelta: {
      operations: [
        {
          type: 'replace',
          text: displayText,
          cursorOffset,
        },
      ],
    },
  }
}
