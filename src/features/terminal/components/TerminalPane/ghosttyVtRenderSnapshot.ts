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
  readonly textOffset?: number
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

const hasCellStyle = (cell: GhosttyVtRenderSnapshotCell): boolean =>
  cell.bold === true ||
  cell.italic === true ||
  cell.underline === true ||
  cell.foreground !== undefined ||
  cell.background !== undefined

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
            ...(snapshot.cursor.textOffset === undefined
              ? {}
              : { textOffset: snapshot.cursor.textOffset }),
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

type CellsByRow = ReadonlyMap<number, readonly GhosttyVtRenderSnapshotCell[]>

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

const readCellDisplayText = (
  rowText: string,
  cell: GhosttyVtRenderSnapshotCell,
  fallbackColumn: number
): string => {
  if (cell.text !== '') {
    return cell.text
  }

  return hasCellStyle(cell)
    ? ' '.repeat(cell.width)
    : readRowTextByCellColumns(
        rowText,
        fallbackColumn,
        fallbackColumn + cell.width
      )
}

const readFallbackColumnDeltaForCell = (
  rowText: string,
  cell: GhosttyVtRenderSnapshotCell,
  fallbackColumn: number
): number => {
  if (cell.text !== '') {
    return readTextCellWidth(cell.text)
  }

  if (!hasCellStyle(cell)) {
    return cell.width
  }

  const fallbackText = readRowTextByCellColumns(
    rowText,
    fallbackColumn,
    fallbackColumn + cell.width
  )

  // Ghostty visibleLines omits styled-blank columns; non-blank fallback here belongs to a later column.
  return fallbackText.trim() === '' ? cell.width : 0
}

const readTextOffsetForNativeCellColumn = (
  text: string,
  nativeCellWidth: number,
  columnOffset: number
): number => {
  const clampedColumn = clamp(columnOffset, 0, nativeCellWidth)

  if (clampedColumn === 0) {
    return 0
  }

  if (clampedColumn >= nativeCellWidth) {
    return text.length
  }

  return readTextCellWidth(text) >= nativeCellWidth
    ? findTextOffsetForCellColumn(text, clampedColumn)
    : 0
}

const readCellRowVisibleText = (
  rowText: string,
  rowCells: readonly GhosttyVtRenderSnapshotCell[] | undefined
): string => {
  if (!rowCells || rowCells.length === 0) {
    return rowText
  }

  let output = ''
  let currentColumn = 0
  let fallbackColumn = 0

  rowCells.forEach((cell) => {
    if (cell.col < currentColumn) {
      currentColumn = Math.max(currentColumn, cell.col + cell.width)

      return
    }

    if (cell.col > currentColumn) {
      const gapWidth = cell.col - currentColumn

      output += readRowTextByCellColumns(
        rowText,
        fallbackColumn,
        fallbackColumn + gapWidth
      )
      currentColumn = cell.col
      fallbackColumn += gapWidth
    }

    output += readCellDisplayText(rowText, cell, fallbackColumn)
    fallbackColumn += readFallbackColumnDeltaForCell(
      rowText,
      cell,
      fallbackColumn
    )
    currentColumn = cell.col + cell.width
  })

  const trailingTextOffset = findTextOffsetForCellColumn(
    rowText,
    fallbackColumn
  )

  return `${output}${rowText.slice(trailingTextOffset)}`
}

const readCursorOffsetInCellRow = (
  rowText: string,
  rowCells: readonly GhosttyVtRenderSnapshotCell[] | undefined,
  columnOffset: number
): number => {
  if (!rowCells || rowCells.length === 0) {
    return findTextOffsetForCellColumn(rowText, columnOffset)
  }

  let currentColumn = 0
  let fallbackColumn = 0
  let textOffset = 0

  for (const cell of rowCells) {
    if (cell.col < currentColumn) {
      if (columnOffset < currentColumn) {
        return textOffset
      }

      currentColumn = Math.max(currentColumn, cell.col + cell.width)
      continue
    }

    if (columnOffset <= cell.col) {
      const gapWidth = cell.col - currentColumn

      const gapText = readRowTextByCellColumns(
        rowText,
        fallbackColumn,
        fallbackColumn + gapWidth
      )

      return (
        textOffset +
        findTextOffsetForCellColumn(gapText, columnOffset - currentColumn)
      )
    }

    if (cell.col > currentColumn) {
      const gapWidth = cell.col - currentColumn

      textOffset += readRowTextByCellColumns(
        rowText,
        fallbackColumn,
        fallbackColumn + gapWidth
      ).length
      currentColumn = cell.col
      fallbackColumn += gapWidth
    }

    const cellEndColumn = cell.col + cell.width
    const cellText = readCellDisplayText(rowText, cell, fallbackColumn)

    if (columnOffset < cellEndColumn) {
      return (
        textOffset +
        readTextOffsetForNativeCellColumn(
          cellText,
          cell.width,
          columnOffset - cell.col
        )
      )
    }

    textOffset += cellText.length
    fallbackColumn += readFallbackColumnDeltaForCell(
      rowText,
      cell,
      fallbackColumn
    )
    currentColumn = cellEndColumn
  }

  const trailingText = rowText.slice(
    findTextOffsetForCellColumn(rowText, fallbackColumn)
  )

  return (
    textOffset +
    findTextOffsetForCellColumn(trailingText, columnOffset - currentColumn)
  )
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
  let fallbackColumn = 0

  rowCells.forEach((cell) => {
    if (cell.col < currentColumn) {
      currentColumn = Math.max(currentColumn, cell.col + cell.width)

      return
    }

    if (cell.col > currentColumn) {
      const gapWidth = cell.col - currentColumn

      if (activeStyleKey !== EMPTY_STYLE_KEY) {
        output += getSgrStyleSentinel([0])
        activeStyleKey = EMPTY_STYLE_KEY
      }

      output += readRowTextByCellColumns(
        rowText,
        fallbackColumn,
        fallbackColumn + gapWidth
      )
      currentColumn = cell.col
      fallbackColumn += gapWidth
    }

    const style = readCellStyle(cell)
    const styleKey = readStyleKey(style)

    if (styleKey !== activeStyleKey) {
      output += getSgrStyleSentinel(readStyleParameters(style))
      activeStyleKey = styleKey
    }

    output += readCellDisplayText(rowText, cell, fallbackColumn)
    fallbackColumn += readFallbackColumnDeltaForCell(
      rowText,
      cell,
      fallbackColumn
    )

    currentColumn = cell.col + cell.width
  })

  if (activeStyleKey !== EMPTY_STYLE_KEY) {
    output += getSgrStyleSentinel([0])
  }

  const trailingTextOffset = findTextOffsetForCellColumn(
    rowText,
    fallbackColumn
  )
  output += rowText.slice(trailingTextOffset)

  return output
}

const readSnapshotDisplayText = (
  snapshot: GhosttyVtRenderSnapshot,
  cellsByRow: CellsByRow
): string => {
  if (!snapshot.cells || snapshot.cells.length === 0) {
    return readSnapshotText(snapshot)
  }

  return snapshot.rows
    .map((row, rowIndex) => readStyledRowText(row, cellsByRow.get(rowIndex)))
    .join('\n')
}

const readSnapshotDisplayVisibleText = (
  snapshot: GhosttyVtRenderSnapshot,
  cellsByRow: CellsByRow
): string => {
  if (!snapshot.cells || snapshot.cells.length === 0) {
    return readSnapshotText(snapshot)
  }

  return snapshot.rows
    .map((row, rowIndex) =>
      readCellRowVisibleText(row, cellsByRow.get(rowIndex))
    )
    .join('\n')
}

const readSnapshotCursorOffset = (
  snapshot: GhosttyVtRenderSnapshot,
  cellsByRow: CellsByRow
): number => {
  const cursor = snapshot.cursor

  if (!cursor || snapshot.rows.length === 0) {
    return readSnapshotDisplayVisibleText(snapshot, cellsByRow).length
  }

  const rowIndex = clamp(cursor.rowIndex, 0, snapshot.rows.length - 1)
  const row = snapshot.rows[rowIndex] ?? ''

  const rowTextOffset =
    cursor.textOffset ??
    readCursorOffsetInCellRow(
      row,
      cellsByRow.get(rowIndex),
      cursor.columnOffset
    )

  const precedingRowsLength = snapshot.rows
    .slice(0, rowIndex)
    .reduce(
      (length, previousRow, previousRowIndex) =>
        length +
        readCellRowVisibleText(previousRow, cellsByRow.get(previousRowIndex))
          .length +
        1,
      0
    )

  return precedingRowsLength + rowTextOffset
}

export const createGhosttyVtRenderSnapshotOutput = (
  snapshot: GhosttyVtRenderSnapshot
): TerminalParserEngineOutput => {
  const normalizedSnapshot = trimLeadingEmptyRows(snapshot)
  const cellsByRow = readCellsByRow(normalizedSnapshot.cells)
  const text = readSnapshotText(normalizedSnapshot)
  const displayText = readSnapshotDisplayText(normalizedSnapshot, cellsByRow)
  const cursorOffset = readSnapshotCursorOffset(normalizedSnapshot, cellsByRow)

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
