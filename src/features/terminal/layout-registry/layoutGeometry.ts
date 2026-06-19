// cspell:ignore vdiv hdiv
import {
  gridAreaNameForSlotId,
  type PaneLayoutDefinition,
} from './layoutDefinition'
import type { RatioAxis } from './ratioModel'

export type DividerDragAxis = 'horizontal' | 'vertical'

export type DividerOrientation = 'vertical' | 'horizontal'

export interface DividerHandleSpec {
  readonly id: string
  readonly gridArea: string
  readonly dragAxis: DividerDragAxis
  readonly orientation: DividerOrientation
  readonly trackAxis: RatioAxis
  readonly trackIndex: number
}

export interface SlotGridArea {
  readonly slotId: string
  readonly gridArea: string
}

export interface LayoutGeometry {
  readonly areas: readonly (readonly string[])[]
  readonly dividers: readonly DividerHandleSpec[]
  readonly slotAreas: readonly SlotGridArea[]
}

const verticalDividerName = (colIndex: number): string => `vdiv-c${colIndex}`

const verticalDividerSegmentName = (
  colIndex: number,
  rowIndex: number
): string => `${verticalDividerName(colIndex)}-r${rowIndex}`

const horizontalDividerName = (rowIndex: number): string => `hdiv-r${rowIndex}`

const horizontalDividerSegmentName = (
  rowIndex: number,
  colIndex: number
): string => `${horizontalDividerName(rowIndex)}-c${colIndex}`

const allEqual = (values: readonly string[]): boolean =>
  values.length > 0 && values.every((value) => value === values[0])

const hasFullHorizontalBoundary = (
  areas: readonly (readonly string[])[],
  rowIndex: number
): boolean =>
  areas[rowIndex].every(
    (area, colIndex) => area !== areas[rowIndex + 1][colIndex]
  )

const hasFullVerticalBoundary = (
  areas: readonly (readonly string[])[],
  colIndex: number,
  fullHorizontalRows: ReadonlySet<number>
): boolean =>
  fullHorizontalRows.size === 0 &&
  areas.every((row) => row[colIndex] !== row[colIndex + 1])

const horizontalNameForCell = (
  areas: readonly (readonly string[])[],
  rowIndex: number,
  colIndex: number,
  fullHorizontalRows: ReadonlySet<number>
): string => {
  const top = areas[rowIndex][colIndex]
  const bottom = areas[rowIndex + 1][colIndex]

  if (top === bottom) {
    return top
  }

  return fullHorizontalRows.has(rowIndex)
    ? horizontalDividerName(rowIndex)
    : horizontalDividerSegmentName(rowIndex, colIndex)
}

const verticalNameForCell = (
  areas: readonly (readonly string[])[],
  rowIndex: number,
  colIndex: number,
  fullVerticalCols: ReadonlySet<number>
): string => {
  const left = areas[rowIndex][colIndex]
  const right = areas[rowIndex][colIndex + 1]

  if (left === right) {
    return left
  }

  return fullVerticalCols.has(colIndex)
    ? verticalDividerName(colIndex)
    : verticalDividerSegmentName(colIndex, rowIndex)
}

const junctionName = (
  areas: readonly (readonly string[])[],
  rowIndex: number,
  colIndex: number,
  fullHorizontalRows: ReadonlySet<number>,
  fullVerticalCols: ReadonlySet<number>
): string => {
  const topLeft = areas[rowIndex][colIndex]
  const topRight = areas[rowIndex][colIndex + 1]
  const bottomLeft = areas[rowIndex + 1][colIndex]
  const bottomRight = areas[rowIndex + 1][colIndex + 1]

  if (allEqual([topLeft, topRight, bottomLeft, bottomRight])) {
    return topLeft
  }

  if (fullHorizontalRows.has(rowIndex)) {
    return horizontalDividerName(rowIndex)
  }

  if (fullVerticalCols.has(colIndex)) {
    return verticalDividerName(colIndex)
  }

  return '.'
}

const addDivider = (
  dividers: DividerHandleSpec[],
  seen: Set<string>,
  spec: DividerHandleSpec
): void => {
  if (seen.has(spec.id)) {
    return
  }

  seen.add(spec.id)
  dividers.push(spec)
}

export const areaMatrixFromDefinition = (
  definition: PaneLayoutDefinition
): readonly (readonly string[])[] => {
  const colCount = definition.tracks.columns.length
  const rowCount = definition.tracks.rows.length

  const areas = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => '.')
  )

  for (const slot of definition.slots) {
    const areaName = gridAreaNameForSlotId(slot.id)
    const colEnd = slot.rect.col + slot.rect.colSpan
    const rowEnd = slot.rect.row + slot.rect.rowSpan

    for (let row = slot.rect.row; row < rowEnd; row += 1) {
      for (let col = slot.rect.col; col < colEnd; col += 1) {
        if (row >= 0 && row < rowCount && col >= 0 && col < colCount) {
          areas[row][col] = areaName
        }
      }
    }
  }

  return areas
}

export const resolveAreaGeometry = (
  areas: readonly (readonly string[])[]
): Pick<LayoutGeometry, 'areas' | 'dividers'> => {
  const rowCount = areas.length
  const colCount = areas[0]?.length ?? 0

  if (rowCount === 0 || colCount === 0) {
    return { areas: [], dividers: [] }
  }

  const fullHorizontalRows = new Set<number>()
  for (let rowIndex = 0; rowIndex < rowCount - 1; rowIndex += 1) {
    if (hasFullHorizontalBoundary(areas, rowIndex)) {
      fullHorizontalRows.add(rowIndex)
    }
  }

  const fullVerticalCols = new Set<number>()
  for (let colIndex = 0; colIndex < colCount - 1; colIndex += 1) {
    if (hasFullVerticalBoundary(areas, colIndex, fullHorizontalRows)) {
      fullVerticalCols.add(colIndex)
    }
  }

  const expanded: string[][] = []
  for (let expandedRow = 0; expandedRow < rowCount * 2 - 1; expandedRow += 1) {
    const row: string[] = []
    const logicalRow = Math.floor(expandedRow / 2)

    for (
      let expandedCol = 0;
      expandedCol < colCount * 2 - 1;
      expandedCol += 1
    ) {
      const logicalCol = Math.floor(expandedCol / 2)

      if (expandedRow % 2 === 0 && expandedCol % 2 === 0) {
        row.push(areas[logicalRow][logicalCol])
      } else if (expandedRow % 2 === 0) {
        row.push(
          verticalNameForCell(areas, logicalRow, logicalCol, fullVerticalCols)
        )
      } else if (expandedCol % 2 === 0) {
        row.push(
          horizontalNameForCell(
            areas,
            logicalRow,
            logicalCol,
            fullHorizontalRows
          )
        )
      } else {
        row.push(
          junctionName(
            areas,
            logicalRow,
            logicalCol,
            fullHorizontalRows,
            fullVerticalCols
          )
        )
      }
    }

    expanded.push(row)
  }

  const dividers: DividerHandleSpec[] = []
  const seen = new Set<string>()

  for (let colIndex = 0; colIndex < colCount - 1; colIndex += 1) {
    if (fullVerticalCols.has(colIndex)) {
      const id = verticalDividerName(colIndex)
      addDivider(dividers, seen, {
        id,
        gridArea: id,
        dragAxis: 'horizontal',
        orientation: 'vertical',
        trackAxis: 'cols',
        trackIndex: colIndex,
      })

      continue
    }

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      if (areas[rowIndex][colIndex] === areas[rowIndex][colIndex + 1]) {
        continue
      }

      const id = verticalDividerSegmentName(colIndex, rowIndex)
      addDivider(dividers, seen, {
        id,
        gridArea: id,
        dragAxis: 'horizontal',
        orientation: 'vertical',
        trackAxis: 'cols',
        trackIndex: colIndex,
      })
    }
  }

  for (let rowIndex = 0; rowIndex < rowCount - 1; rowIndex += 1) {
    if (fullHorizontalRows.has(rowIndex)) {
      const id = horizontalDividerName(rowIndex)
      addDivider(dividers, seen, {
        id,
        gridArea: id,
        dragAxis: 'vertical',
        orientation: 'horizontal',
        trackAxis: 'rows',
        trackIndex: rowIndex,
      })

      continue
    }

    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      if (areas[rowIndex][colIndex] === areas[rowIndex + 1][colIndex]) {
        continue
      }

      const id = horizontalDividerSegmentName(rowIndex, colIndex)
      addDivider(dividers, seen, {
        id,
        gridArea: id,
        dragAxis: 'vertical',
        orientation: 'horizontal',
        trackAxis: 'rows',
        trackIndex: rowIndex,
      })
    }
  }

  return { areas: expanded, dividers }
}

export const resolvePaneLayoutGeometry = (
  definition: PaneLayoutDefinition
): LayoutGeometry => {
  const areas = areaMatrixFromDefinition(definition)
  const geometry = resolveAreaGeometry(areas)

  const slotAreas = definition.slots.map((slot) => ({
    slotId: slot.id,
    gridArea: gridAreaNameForSlotId(slot.id),
  }))

  return { ...geometry, slotAreas }
}
