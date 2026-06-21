import { describe, expect, test } from 'vitest'
import {
  LAYOUT_CYCLE,
  LAYOUT_IDS,
  LAYOUTS,
  MAX_BUILTIN_PANE_COUNT,
  PaneLayoutRegistry,
  VISIBLE_LAYOUTS,
  autoShrinkLayoutFor,
  isKnownLayoutId,
  type PaneLayoutDefinition,
} from '.'

const customGrid2x2 = (): PaneLayoutDefinition => ({
  schemaVersion: 1,
  id: 'custom:grid-2x2',
  title: 'Custom grid 2x2',
  source: 'workspace',
  tracks: {
    columns: [
      { id: 'c0', units: 12 },
      { id: 'c1', units: 12 },
    ],
    rows: [
      { id: 'r0', units: 12 },
      { id: 'r1', units: 12 },
    ],
  },
  slots: [
    { id: 'slot:p0', rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p1', rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p2', rect: { col: 0, row: 1, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p3', rect: { col: 1, row: 1, colSpan: 1, rowSpan: 1 } },
  ],
  addOrder: ['slot:p0', 'slot:p1', 'slot:p2', 'slot:p3'],
})

describe('layoutRegistry', () => {
  test('exports the canonical layout order once', () => {
    expect(LAYOUT_IDS).toEqual([
      'single',
      'vsplit',
      'hsplit',
      'threeRight',
      'quad',
      'grid3x2',
    ])
    expect(LAYOUT_CYCLE).toEqual(LAYOUT_IDS)
    expect(VISIBLE_LAYOUTS.map((layout) => layout.id)).toEqual(LAYOUT_IDS)
  })

  test('exposes record lookup by layout id', () => {
    expect(LAYOUTS.single.name).toBe('Single')
    expect(LAYOUTS.quad.capacity).toBe(4)
    expect(LAYOUTS.grid3x2.capacity).toBe(6)
  })

  test('recognizes known layout ids and rejects unknown ones', () => {
    expect(isKnownLayoutId('single')).toBe(true)
    expect(isKnownLayoutId('quad')).toBe(true)
    expect(isKnownLayoutId('grid3x2')).toBe(true)
  })

  test('centralizes the current auto-shrink policy', () => {
    expect(autoShrinkLayoutFor(1, 'quad')).toBe('single')
    expect(autoShrinkLayoutFor(2, 'hsplit')).toBe('hsplit')
    expect(autoShrinkLayoutFor(2, 'quad')).toBe('vsplit')
    expect(autoShrinkLayoutFor(3, 'quad')).toBe('threeRight')
    expect(autoShrinkLayoutFor(4, 'quad')).toBe('quad')
    expect(autoShrinkLayoutFor(5, 'grid3x2')).toBe('grid3x2')
    expect(autoShrinkLayoutFor(4, 'grid3x2')).toBe('quad')
  })

  test('assembles runtime builtin plus custom layouts', () => {
    const registry = new PaneLayoutRegistry([customGrid2x2()])

    expect(registry.layouts.map((layout) => layout.id)).toEqual([
      ...LAYOUT_IDS,
      'custom:grid-2x2',
    ])

    expect(registry.customLayouts.map((layout) => layout.id)).toEqual([
      'custom:grid-2x2',
    ])
    expect(registry.getLayout('custom:grid-2x2')?.capacity).toBe(4)
    expect(registry.resolveLayoutId('custom:grid-2x2')).toBe('custom:grid-2x2')
    expect(registry.resolveLayoutId('custom:missing')).toBe('single')
  })

  test('custom layouts preserve empty slots on pane removal', () => {
    const registry = new PaneLayoutRegistry([customGrid2x2()])

    expect(registry.autoShrinkLayoutFor(3, 'custom:grid-2x2')).toBe(
      'custom:grid-2x2'
    )

    expect(autoShrinkLayoutFor(3, 'custom:grid-2x2', registry)).toBe(
      'custom:grid-2x2'
    )
  })

  test('exposes the maximum builtin pane count', () => {
    expect(MAX_BUILTIN_PANE_COUNT).toBe(6)
  })

  test('workspace layout with zero panes falls through to single', () => {
    const registry = new PaneLayoutRegistry([customGrid2x2()])

    expect(registry.autoShrinkLayoutFor(0, 'custom:grid-2x2')).toBe('single')
  })

  test('accepts custom layouts with up to 24 tracks per axis', () => {
    const layout: PaneLayoutDefinition = {
      schemaVersion: 1,
      id: 'custom:row-24',
      title: 'Twenty four columns',
      source: 'workspace',
      tracks: {
        columns: Array.from({ length: 24 }, (_, index) => ({
          id: `col-${index}`,
          units: 1,
        })),
        rows: [{ id: 'row-0', units: 24 }],
      },
      slots: [
        {
          id: 'slot:p0',
          rect: { col: 0, row: 0, colSpan: 24, rowSpan: 1 },
        },
      ],
      addOrder: ['slot:p0'],
    }

    const registry = new PaneLayoutRegistry([layout])

    expect(registry.getLayout('custom:row-24')).not.toBeNull()
    expect(registry.rejected).toEqual([])
  })
})
