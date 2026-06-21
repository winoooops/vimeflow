// cspell:ignore ghostty
export interface GhosttyCellTraversalCell {
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

export type GhosttyCellsByRow<TCell extends GhosttyCellTraversalCell> =
  ReadonlyMap<number, readonly TCell[]>

const hasCellStyle = (cell: GhosttyCellTraversalCell): boolean =>
  cell.bold === true ||
  cell.italic === true ||
  cell.underline === true ||
  cell.foreground !== undefined ||
  cell.background !== undefined ||
  cell.reverse === true

const sortCells = <TCell extends GhosttyCellTraversalCell>(
  cells: readonly TCell[]
): readonly TCell[] =>
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

export const readTextCellWidth = (text: string): number => {
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

export const readCellsByRow = <TCell extends GhosttyCellTraversalCell>(
  cells: readonly TCell[] | undefined
): GhosttyCellsByRow<TCell> => {
  const cellsByRow = new Map<number, TCell[]>()

  sortCells(cells ?? []).forEach((cell) => {
    const rowCells = cellsByRow.get(cell.row) ?? []

    rowCells.push(cell)
    cellsByRow.set(cell.row, rowCells)
  })

  return cellsByRow
}

export const readRowTextByCellColumns = (
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

export const readCellDisplayText = (
  rowText: string,
  cell: GhosttyCellTraversalCell,
  fallbackColumn: number,
  nextCell?: GhosttyCellTraversalCell
): string => {
  if (cell.text !== '') {
    const cellEndColumn = cell.col + cell.width

    const hasExplicitContinuation =
      nextCell !== undefined && nextCell.col < cellEndColumn

    const missingColumns = hasExplicitContinuation
      ? 0
      : Math.max(0, cell.width - readTextCellWidth(cell.text))

    return cell.text.padEnd(cell.text.length + missingColumns, ' ')
  }

  return hasCellStyle(cell)
    ? ' '.repeat(cell.width)
    : readRowTextByCellColumns(
        rowText,
        fallbackColumn,
        fallbackColumn + cell.width
      )
}

export const readFallbackColumnDeltaForCell = (
  rowText: string,
  cell: GhosttyCellTraversalCell,
  fallbackColumn: number,
  nextCell: GhosttyCellTraversalCell | undefined
): number => {
  if (cell.text !== '') {
    return readTextCellWidth(cell.text)
  }

  if (!hasCellStyle(cell)) {
    return cell.width
  }

  if (nextCell === undefined || nextCell.col > cell.col + cell.width) {
    return 0
  }

  const fallbackText = readRowTextByCellColumns(
    rowText,
    fallbackColumn,
    fallbackColumn + cell.width
  )

  return readTextCellWidth(fallbackText) >= cell.width ? cell.width : 0
}

const readTextOffsetForNativeCellColumn = (
  text: string,
  nativeCellWidth: number,
  columnOffset: number
): number => {
  const clampedColumn = Math.min(Math.max(columnOffset, 0), nativeCellWidth)

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

export const readCellRowVisibleText = (
  rowText: string,
  rowCells: readonly GhosttyCellTraversalCell[] | undefined
): string => {
  if (!rowCells || rowCells.length === 0) {
    return rowText
  }

  let output = ''
  let currentColumn = 0
  let fallbackColumn = 0

  rowCells.forEach((cell, index) => {
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

  const trailingTextOffset = findTextOffsetForCellColumn(
    rowText,
    fallbackColumn
  )

  return `${output}${rowText.slice(trailingTextOffset)}`
}

export const readCursorOffsetInCellRow = (
  rowText: string,
  rowCells: readonly GhosttyCellTraversalCell[] | undefined,
  columnOffset: number
): number => {
  if (!rowCells || rowCells.length === 0) {
    return findTextOffsetForCellColumn(rowText, columnOffset)
  }

  let currentColumn = 0
  let fallbackColumn = 0
  let textOffset = 0

  for (const [index, cell] of rowCells.entries()) {
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

    const cellText = readCellDisplayText(
      rowText,
      cell,
      fallbackColumn,
      rowCells[index + 1]
    )

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
      fallbackColumn,
      rowCells[index + 1]
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
