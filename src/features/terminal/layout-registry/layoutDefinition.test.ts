import { describe, expect, test } from 'vitest'
import {
  PREBUILT_PANE_LAYOUTS,
  assemblePaneLayoutRegistry,
  createPaneSlotId,
  getPaneLayoutCapacity,
  getPaneLayoutRatios,
  gridAreaNameForSlotId,
  validatePaneLayoutDefinition,
  type PaneLayoutDefinition,
} from '.'

const mainWithSideStack = (): PaneLayoutDefinition => ({
  schemaVersion: 1,
  id: 'custom:main-side-stack',
  title: 'Main + side stack',
  source: 'workspace',
  tracks: {
    columns: [
      { id: 'main', units: 16 },
      { id: 'side', units: 8 },
    ],
    rows: [
      { id: 'top', units: 8 },
      { id: 'middle', units: 8 },
      { id: 'bottom', units: 8 },
    ],
  },
  slots: [
    {
      id: createPaneSlotId('main'),
      rect: { col: 0, row: 0, colSpan: 1, rowSpan: 3 },
    },
    {
      id: createPaneSlotId('side-top'),
      rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
    },
    {
      id: createPaneSlotId('side-middle'),
      rect: { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
    },
    {
      id: createPaneSlotId('side-bottom'),
      rect: { col: 1, row: 2, colSpan: 1, rowSpan: 1 },
    },
  ],
  addOrder: [
    createPaneSlotId('main'),
    createPaneSlotId('side-top'),
    createPaneSlotId('side-middle'),
    createPaneSlotId('side-bottom'),
  ],
})

describe('layoutDefinition', () => {
  test('validates a workspace custom main + side stack layout', () => {
    const definition = mainWithSideStack()
    const result = validatePaneLayoutDefinition(definition)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(getPaneLayoutCapacity(definition)).toBe(4)
    expect(getPaneLayoutRatios(definition)).toEqual({
      cols: [16, 8],
      rows: [8, 8, 8],
    })
  })

  test('validates every prebuilt layout definition', () => {
    expect(PREBUILT_PANE_LAYOUTS).toHaveLength(6)
    expect(
      PREBUILT_PANE_LAYOUTS.map((definition) => ({
        id: definition.id,
        valid: validatePaneLayoutDefinition(definition).ok,
      }))
    ).toEqual([
      { id: 'single', valid: true },
      { id: 'vsplit', valid: true },
      { id: 'hsplit', valid: true },
      { id: 'threeRight', valid: true },
      { id: 'quad', valid: true },
      { id: 'grid3x2', valid: true },
    ])
  })

  test('maps indexed prebuilt slots to legacy grid areas and custom slots to safe names', () => {
    expect(gridAreaNameForSlotId(createPaneSlotId('p0'))).toBe('p0')
    expect(gridAreaNameForSlotId(createPaneSlotId('main pane'))).toBe(
      'slot-main-pane'
    )
  })

  test('rejects overlap and holes so runtime never receives ambiguous slots', () => {
    const overlapping: PaneLayoutDefinition = {
      ...mainWithSideStack(),
      slots: [
        {
          id: createPaneSlotId('a'),
          rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 },
        },
        {
          id: createPaneSlotId('b'),
          rect: { col: 1, row: 0, colSpan: 1, rowSpan: 2 },
        },
      ],
      addOrder: [createPaneSlotId('a'), createPaneSlotId('b')],
    }

    const codes = validatePaneLayoutDefinition(overlapping).errors.map(
      (error) => error.code
    )
    expect(codes).toContain('slot-overlap')
    expect(codes).toContain('layout-hole')
  })

  test('rejects slots whose sanitized ids collide in the CSS grid', () => {
    const colliding: PaneLayoutDefinition = {
      schemaVersion: 1,
      id: 'custom:colliding',
      title: 'Colliding',
      source: 'workspace',
      tracks: {
        columns: [{ id: 'only', units: 24 }],
        rows: [
          { id: 'top', units: 12 },
          { id: 'bottom', units: 12 },
        ],
      },
      slots: [
        {
          id: createPaneSlotId('a b'),
          rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
        },
        {
          id: createPaneSlotId('a-b'),
          rect: { col: 0, row: 1, colSpan: 1, rowSpan: 1 },
        },
      ],
      addOrder: [createPaneSlotId('a b'), createPaneSlotId('a-b')],
    }

    const codes = validatePaneLayoutDefinition(colliding).errors.map(
      (error) => error.code
    )
    expect(codes).toContain('duplicate-grid-area')
  })

  test('rejects invalid track units and non-unique add order', () => {
    const invalid: PaneLayoutDefinition = {
      ...mainWithSideStack(),
      tracks: {
        columns: [
          { id: 'main', units: 0 },
          { id: 'main', units: 8 },
        ],
        rows: [{ id: 'top', units: Number.NaN }],
      },
      addOrder: [
        createPaneSlotId('main'),
        createPaneSlotId('main'),
        createPaneSlotId('missing'),
      ],
    }

    const codes = validatePaneLayoutDefinition(invalid).errors.map(
      (error) => error.code
    )
    expect(codes).toContain('invalid-track-units')
    expect(codes).toContain('duplicate-track-id')
    expect(codes).toContain('invalid-add-order')
    expect(codes).toContain('duplicate-add-order-slot')
    expect(codes).toContain('unknown-add-order-slot')
  })

  test('keeps prebuilt and custom layouts in separate id namespaces', () => {
    const custom = mainWithSideStack()

    const shadowingCustom: PaneLayoutDefinition = {
      ...custom,
      id: 'single',
      title: 'Bad single override',
    }

    const registry = assemblePaneLayoutRegistry({
      prebuilt: PREBUILT_PANE_LAYOUTS,
      custom: [custom, shadowingCustom],
    })

    expect(registry.layouts.map((definition) => definition.id)).toEqual([
      'single',
      'vsplit',
      'hsplit',
      'threeRight',
      'quad',
      'grid3x2',
      'custom:main-side-stack',
    ])
    expect(registry.rejected).toHaveLength(1)
    expect(registry.rejected[0].definition.id).toBe('single')
    expect(registry.rejected[0].errors.map((error) => error.code)).toContain(
      'invalid-id-namespace'
    )
  })
})
