import type { LayoutShape } from '../components/SplitView/layouts'
import type { LayoutSlotId } from '../../sessions/types'
import { gridAreaNameForSlotId } from '../layout-registry/layoutDefinition'

export type PaneDirection = 'left' | 'right' | 'up' | 'down'

interface Cell {
  readonly row: number
  readonly col: number
}

interface Candidate {
  readonly slotId: LayoutSlotId
  readonly steps: number
  readonly nRow: number
  readonly nCol: number
}

const DIRECTION_DELTAS: Record<PaneDirection, Cell> = {
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
}

const rayPositions = (
  grid: readonly (readonly string[])[],
  startRow: number,
  startCol: number,
  direction: PaneDirection
): Cell[] => {
  const rowCount = grid.length
  const colCount = grid[0]?.length ?? 0
  const delta = DIRECTION_DELTAS[direction]

  const maxSteps = ((): number => {
    switch (direction) {
      case 'left':
        return startCol
      case 'right':
        return colCount - 1 - startCol
      case 'up':
        return startRow
      case 'down':
        return rowCount - 1 - startRow
    }
  })()

  return Array.from({ length: maxSteps }, (_, stepIndex) => ({
    row: startRow + delta.row * (stepIndex + 1),
    col: startCol + delta.col * (stepIndex + 1),
  }))
}

export const resolveDirectionalPane = (
  layout: LayoutShape,
  activeSlotId: LayoutSlotId,
  occupiedSlotIds: ReadonlySet<LayoutSlotId>,
  direction: PaneDirection
): LayoutSlotId | null => {
  const gridAreaBySlotId = new Map(
    layout.definition.slots.map((slot) => [
      slot.id,
      gridAreaNameForSlotId(slot.id),
    ])
  )

  const slotIdByGridArea = new Map(
    [...gridAreaBySlotId].map(([slotId, gridArea]) => [gridArea, slotId])
  )
  const activeSlot = gridAreaBySlotId.get(activeSlotId)
  if (activeSlot === undefined) {
    return null
  }
  const grid = layout.areas

  const activeCells = grid.flatMap((row, rowIndex) =>
    row
      .map((slot, colIndex) =>
        slot === activeSlot ? { row: rowIndex, col: colIndex } : null
      )
      .filter((cell): cell is Cell => cell !== null)
  )

  if (activeCells.length === 0) {
    return null
  }

  const candidates = activeCells.reduce<Candidate[]>((acc, { row, col }) => {
    const neighbor = rayPositions(grid, row, col, direction).find((pos) => {
      const slot = grid[pos.row][pos.col]
      if (slot === activeSlot) {
        return false
      }
      const slotId = slotIdByGridArea.get(slot)
      if (slotId === undefined) {
        return false
      }

      return occupiedSlotIds.has(slotId)
    })

    if (!neighbor) {
      return acc
    }

    const slot = grid[neighbor.row][neighbor.col]
    const neighborSlotId = slotIdByGridArea.get(slot)
    if (neighborSlotId === undefined) {
      return acc
    }

    return [
      ...acc,
      {
        slotId: neighborSlotId,
        steps: Math.abs(neighbor.row - row) + Math.abs(neighbor.col - col),
        nRow: neighbor.row,
        nCol: neighbor.col,
      },
    ]
  }, [])

  const nearest = candidates.reduce<Candidate | null>((best, candidate) => {
    if (best === null) {
      return candidate
    }
    if (candidate.steps !== best.steps) {
      return candidate.steps < best.steps ? candidate : best
    }
    if (candidate.nRow !== best.nRow) {
      return candidate.nRow < best.nRow ? candidate : best
    }

    return candidate.nCol < best.nCol ? candidate : best
  }, null)

  return nearest?.slotId ?? null
}
