// cspell:ignore ghostty
import {
  readCellDisplayText,
  readCellRowVisibleText,
  readCellsByRow,
  readCursorOffsetInCellRow,
  readFallbackColumnDeltaForCell,
  readRowTextByCellColumns,
  type GhosttyCellTraversalCell,
  type GhosttyCellsByRow,
} from '../../../../../shared/ghosttyCellTraversal'
import { findTextOffsetForCellColumn } from './terminalDisplayBuffer'
import { getSgrStyleSentinel } from './terminalControlParser'
import type { TerminalParserEngineOutput } from './terminalParserEngine'

export interface GhosttyVtRenderSnapshotCursor {
  readonly rowIndex: number
  readonly columnOffset: number
  readonly visible?: boolean
}

export interface GhosttyVtRenderSnapshotCell extends GhosttyCellTraversalCell {
  readonly row: number
  readonly col: number
  readonly text: string
  readonly width: number
  readonly bold?: boolean
  readonly italic?: boolean
  readonly underline?: boolean
  readonly foreground?: string
  readonly background?: string
  readonly reverse?: boolean
}

export interface GhosttyVtRenderSnapshot {
  readonly rows: readonly string[]
  readonly cursor?: GhosttyVtRenderSnapshotCursor
  readonly cells?: readonly GhosttyVtRenderSnapshotCell[]
  // Count of scrollback rows the native terminal holds above the viewport (0 on
  // the alt screen). Styled rows are fetched lazily via the driver's readScrollback.
  readonly scrollbackRowCount?: number
  readonly isAltScreen?: boolean
}

export interface GhosttyVtRenderScrollback {
  readonly rows: readonly string[]
  readonly cells: readonly GhosttyVtRenderSnapshotCell[]
}

interface SnapshotStyle {
  readonly bold?: boolean
  readonly italic?: boolean
  readonly underline?: boolean
  readonly foreground?: string
  readonly background?: string
  readonly reverse?: boolean
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

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
  ...(cell.reverse === true ? { reverse: true } : {}),
})

const readStyleKey = (style: SnapshotStyle): string =>
  [
    style.bold === true ? '1' : '',
    style.italic === true ? '3' : '',
    style.underline === true ? '4' : '',
    style.foreground ?? '',
    style.background ?? '',
    style.reverse === true ? '7' : '',
  ].join('|')

const EMPTY_STYLE_KEY = readStyleKey({})

const readStyleParameters = (style: SnapshotStyle): readonly number[] => [
  0,
  ...(style.bold === true ? [1] : []),
  ...(style.italic === true ? [3] : []),
  ...(style.underline === true ? [4] : []),
  ...(style.reverse === true ? [7] : []),
  ...readSgrColorParameters(38, style.foreground),
  ...readSgrColorParameters(48, style.background),
]

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
            ...(snapshot.cursor.visible === undefined
              ? {}
              : { visible: snapshot.cursor.visible }),
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

type CellsByRow = GhosttyCellsByRow<GhosttyVtRenderSnapshotCell>

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

  rowCells.forEach((cell, index) => {
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

    output += readCellDisplayText(
      rowText,
      cell,
      fallbackColumn,
      rowCells[index + 1]
    )

    fallbackColumn += readFallbackColumnDeltaForCell(
      rowText,
      cell,
      fallbackColumn,
      rowCells[index + 1]
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
  const rowCells = cellsByRow.get(rowIndex)

  const rowTextOffset = readCursorOffsetInCellRow(
    row,
    rowCells,
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

const PROMPT_MARKER_PATTERN = /^\s*>/

const hasCellStyle = (cell: GhosttyVtRenderSnapshotCell): boolean =>
  cell.bold === true ||
  cell.italic === true ||
  cell.underline === true ||
  cell.foreground !== undefined ||
  cell.background !== undefined ||
  cell.reverse === true

const hasStyledBlankCellAtCursor = (
  rowCells: readonly GhosttyVtRenderSnapshotCell[] | undefined,
  columnOffset: number
): boolean =>
  rowCells?.some(
    (cell) =>
      hasCellStyle(cell) &&
      cell.text.trim().length === 0 &&
      cell.col <= columnOffset &&
      columnOffset < cell.col + cell.width
  ) ?? false

// A missing cursor.visible flag means "native default visible", not
// "synthetic cursor". Keep ordinary blank-row cursors visible unless the
// snapshot matches a known stale parked-cursor shape: an agent prompt follower
// or a styled blank native cell stranded above later content.
const shouldHideImplicitParkedCursor = (
  snapshot: GhosttyVtRenderSnapshot,
  cellsByRow: CellsByRow
): boolean => {
  const cursor = snapshot.cursor

  if (!cursor || cursor.visible !== undefined) {
    return false
  }

  const rowIndex = clamp(cursor.rowIndex, 0, snapshot.rows.length - 1)

  const cursorRow = readCellRowVisibleText(
    snapshot.rows[rowIndex] ?? '',
    cellsByRow.get(rowIndex)
  )

  if (cursorRow.trim().length > 0) {
    return false
  }

  const nextContentRow = snapshot.rows
    .slice(rowIndex + 1)
    .map((row, offset) =>
      readCellRowVisibleText(row, cellsByRow.get(rowIndex + offset + 1))
    )
    .find((row) => row.trim().length > 0)

  if (nextContentRow === undefined) {
    return false
  }

  return (
    PROMPT_MARKER_PATTERN.test(nextContentRow) ||
    hasStyledBlankCellAtCursor(cellsByRow.get(rowIndex), cursor.columnOffset)
  )
}

export const createGhosttyVtRenderSnapshotOutput = (
  snapshot: GhosttyVtRenderSnapshot
): TerminalParserEngineOutput => {
  const normalizedSnapshot = trimLeadingEmptyRows(snapshot)
  const cellsByRow = readCellsByRow(normalizedSnapshot.cells)
  const text = readSnapshotText(normalizedSnapshot)
  const displayText = readSnapshotDisplayText(normalizedSnapshot, cellsByRow)
  const cursorOffset = readSnapshotCursorOffset(normalizedSnapshot, cellsByRow)

  const cursorVisible =
    normalizedSnapshot.cursor?.visible ??
    (shouldHideImplicitParkedCursor(normalizedSnapshot, cellsByRow)
      ? false
      : undefined)

  return {
    visibleText: text,
    displayDelta: {
      ...(cursorVisible === undefined ? {} : { cursorVisible }),
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

// Encode styled scrollback rows into the same SGR-sentinel displayText + plain
// visibleText the viewport uses, so it can be prepended to the viewport buffer.
// Scrollback is NOT trimmed (it is history, rendered verbatim).
export const encodeScrollback = (
  scrollback: GhosttyVtRenderScrollback
): { displayText: string; visibleText: string } => {
  const cellsByRow = readCellsByRow(scrollback.cells)

  return {
    displayText: scrollback.rows
      .map((row, rowIndex) => readStyledRowText(row, cellsByRow.get(rowIndex)))
      .join('\n'),
    visibleText: scrollback.rows
      .map((row, rowIndex) =>
        readCellRowVisibleText(row, cellsByRow.get(rowIndex))
      )
      .join('\n'),
  }
}

// Prepend encoded scrollback ABOVE the viewport's replace op. Shifts the cursor
// offset by the scrollback's VISIBLE length + 1 (the joining newline) because
// the buffer indexes cursorOffset against visible text. Composing at the string
// level keeps the viewport's leading-empty-row trim from rotating history.
export const prependScrollbackToOutput = (
  output: TerminalParserEngineOutput,
  encoded: { displayText: string; visibleText: string }
): TerminalParserEngineOutput => {
  const delta = output.displayDelta
  const operation = delta?.operations[0]

  if (!delta || operation?.type !== 'replace') {
    return output
  }

  return {
    ...output,
    visibleText: `${encoded.visibleText}\n${output.visibleText}`,
    displayDelta: {
      ...delta,
      operations: [
        {
          type: 'replace',
          text: `${encoded.displayText}\n${operation.text}`,
          cursorOffset:
            (operation.cursorOffset ?? 0) + encoded.visibleText.length + 1,
        },
        ...delta.operations.slice(1),
      ],
    },
  }
}
