import type { LayoutShape } from '../components/SplitView/layouts'

export type PaneDirection = 'left' | 'right' | 'up' | 'down'

interface Cell {
  readonly row: number
  readonly col: number
}

interface Candidate {
  readonly index: number
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
  activePaneIndex: number,
  paneCount: number,
  direction: PaneDirection
): number | null => {
  const activeSlot = `p${activePaneIndex}`
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
      const index = Number(slot.slice(1))

      return index < paneCount
    })

    if (!neighbor) {
      return acc
    }

    const slot = grid[neighbor.row][neighbor.col]

    return [
      ...acc,
      {
        index: Number(slot.slice(1)),
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

  return nearest?.index ?? null
}
