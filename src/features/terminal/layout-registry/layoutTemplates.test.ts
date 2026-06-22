import { describe, expect, test } from 'vitest'
import {
  PaneLayoutRegistry,
  STARTER_LAYOUT_TEMPLATES,
  createGridTemplate,
  createLayoutShape,
  createMainBottomRowTemplate,
  createMainRightStackTemplate,
  isCustomPaneLayoutId,
  validatePaneLayoutDefinition,
  type PaneLayoutDefinition,
} from '.'

const expectsValid = (definition: PaneLayoutDefinition): void => {
  const result = validatePaneLayoutDefinition(definition)
  expect(result.errors).toEqual([])
  expect(result.ok).toBe(true)
}

const cellOwners = (
  definition: PaneLayoutDefinition
): readonly (string | null)[][] => {
  const colCount = definition.tracks.columns.length
  const rowCount = definition.tracks.rows.length

  const grid: (string | null)[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => null)
  )

  for (const slot of definition.slots) {
    for (
      let row = slot.rect.row;
      row < slot.rect.row + slot.rect.rowSpan;
      row += 1
    ) {
      for (
        let col = slot.rect.col;
        col < slot.rect.col + slot.rect.colSpan;
        col += 1
      ) {
        expect(grid[row][col]).toBeNull()
        grid[row][col] = slot.id
      }
    }
  }

  return grid
}

describe('layoutTemplates', () => {
  test('every starter template is a valid workspace definition with a custom id', () => {
    expect(STARTER_LAYOUT_TEMPLATES).not.toHaveLength(0)

    for (const definition of STARTER_LAYOUT_TEMPLATES) {
      expect(definition.title.length).toBeGreaterThan(0)
      expect(definition.source).toBe('workspace')
      expect(isCustomPaneLayoutId(definition.id)).toBe(true)
      expectsValid(definition)
    }
  })

  test('starter template ids are unique', () => {
    const ids = STARTER_LAYOUT_TEMPLATES.map((definition) => definition.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  test('gallery shows the grids bracketing the spanning templates, without 4x4', () => {
    expect(
      STARTER_LAYOUT_TEMPLATES.map((definition) => definition.title)
    ).toEqual([
      '2 × 3 grid',
      'Main + right stack',
      'Main + bottom row',
      '3 × 3 grid',
    ])
  })

  test('every starter template tiles every grid cell exactly once', () => {
    for (const definition of STARTER_LAYOUT_TEMPLATES) {
      const grid = cellOwners(definition)

      for (const row of grid) {
        for (const owner of row) {
          expect(owner).not.toBeNull()
        }
      }
    }
  })

  test('every starter template round-trips through the registry render path', () => {
    for (const definition of STARTER_LAYOUT_TEMPLATES) {
      const shape = createLayoutShape(definition)

      expect(shape.id).toBe(definition.id)
      expect(shape.capacity).toBe(definition.slots.length)

      const registry = new PaneLayoutRegistry([definition])
      expect(registry.rejected).toEqual([])
      expect(registry.getLayout(definition.id)).not.toBeNull()
    }
  })

  test('2x3 grid reads as 2 columns by 3 rows, row-major', () => {
    // "2 x 3" means 2 columns wide and 3 rows tall: 6 single-cell slots
    // numbered left-to-right, top-to-bottom (row-major reading order).
    const definition = createGridTemplate(2, 3)

    expect(definition.tracks.columns).toHaveLength(2)
    expect(definition.tracks.rows).toHaveLength(3)
    expect(definition.slots).toHaveLength(6)
    expectsValid(definition)

    const grid = cellOwners(definition)
    expect(grid[0][0]).toBe('slot:p0')
    expect(grid[0][1]).toBe('slot:p1')
    expect(grid[1][0]).toBe('slot:p2')
    expect(grid[1][1]).toBe('slot:p3')
    expect(grid[2][0]).toBe('slot:p4')
    expect(grid[2][1]).toBe('slot:p5')
  })

  test('3x3 grid has 9 single-cell slots', () => {
    const definition = createGridTemplate(3, 3)

    expect(definition.tracks.columns).toHaveLength(3)
    expect(definition.tracks.rows).toHaveLength(3)
    expect(definition.slots).toHaveLength(9)
    expectsValid(definition)
  })

  test('grid track units total the 24-unit budget on each axis', () => {
    const definition = createGridTemplate(3, 3)

    const sum = (units: readonly { readonly units: number }[]): number =>
      units.reduce((total, track) => total + track.units, 0)

    expect(sum(definition.tracks.columns)).toBe(24)
    expect(sum(definition.tracks.rows)).toBe(24)
  })

  test('main + right stack spans the main slot across all rows', () => {
    const definition = createMainRightStackTemplate()

    expect(definition.tracks.columns).toHaveLength(2)
    expect(definition.tracks.columns[0].units).toBeGreaterThan(
      definition.tracks.columns[1].units
    )
    expect(definition.tracks.rows).toHaveLength(3)
    expect(definition.slots).toHaveLength(4)
    expectsValid(definition)

    const grid = cellOwners(definition)
    // Main slot owns the entire left column across all three rows.
    expect(grid[0][0]).toBe(grid[1][0])
    expect(grid[1][0]).toBe(grid[2][0])
    // The right column has three distinct stacked slots.
    expect(new Set([grid[0][1], grid[1][1], grid[2][1]]).size).toBe(3)
  })

  test('main + bottom row spans the main slot across all columns', () => {
    const definition = createMainBottomRowTemplate()

    expect(definition.tracks.rows).toHaveLength(2)
    expect(definition.tracks.rows[0].units).toBeGreaterThan(
      definition.tracks.rows[1].units
    )
    expect(definition.tracks.columns).toHaveLength(3)
    expect(definition.slots).toHaveLength(4)
    expectsValid(definition)

    const grid = cellOwners(definition)
    // Main slot owns the entire top row across all three columns.
    expect(grid[0][0]).toBe(grid[0][1])
    expect(grid[0][1]).toBe(grid[0][2])
    // The bottom row has three distinct side-by-side slots.
    expect(new Set([grid[1][0], grid[1][1], grid[1][2]]).size).toBe(3)
  })
})
