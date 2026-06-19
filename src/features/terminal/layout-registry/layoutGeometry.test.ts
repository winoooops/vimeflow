// cspell:ignore vdiv hdiv
import { describe, expect, test } from 'vitest'
import {
  createPaneSlotId,
  resolvePaneLayoutGeometry,
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

const mainWithBottomRow = (): PaneLayoutDefinition => ({
  schemaVersion: 1,
  id: 'custom:main-bottom-row',
  title: 'Main + bottom row',
  source: 'workspace',
  tracks: {
    columns: [
      { id: 'left', units: 8 },
      { id: 'center', units: 8 },
      { id: 'right', units: 8 },
    ],
    rows: [
      { id: 'main', units: 18 },
      { id: 'bottom', units: 6 },
    ],
  },
  slots: [
    {
      id: createPaneSlotId('main'),
      rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
    },
    {
      id: createPaneSlotId('bottom-left'),
      rect: { col: 0, row: 1, colSpan: 1, rowSpan: 1 },
    },
    {
      id: createPaneSlotId('bottom-center'),
      rect: { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
    },
    {
      id: createPaneSlotId('bottom-right'),
      rect: { col: 2, row: 1, colSpan: 1, rowSpan: 1 },
    },
  ],
  addOrder: [
    createPaneSlotId('main'),
    createPaneSlotId('bottom-left'),
    createPaneSlotId('bottom-center'),
    createPaneSlotId('bottom-right'),
  ],
})

describe('layoutGeometry', () => {
  test('derives grid areas and dividers for main + side stack', () => {
    const geometry = resolvePaneLayoutGeometry(mainWithSideStack())

    expect(geometry.areas).toEqual([
      ['slot-main', 'vdiv-c0', 'slot-side-top'],
      ['slot-main', 'vdiv-c0', 'hdiv-r0-c1'],
      ['slot-main', 'vdiv-c0', 'slot-side-middle'],
      ['slot-main', 'vdiv-c0', 'hdiv-r1-c1'],
      ['slot-main', 'vdiv-c0', 'slot-side-bottom'],
    ])

    expect(geometry.dividers).toEqual([
      {
        id: 'vdiv-c0',
        gridArea: 'vdiv-c0',
        dragAxis: 'horizontal',
        orientation: 'vertical',
        trackAxis: 'cols',
        trackIndex: 0,
      },
      {
        id: 'hdiv-r0-c1',
        gridArea: 'hdiv-r0-c1',
        dragAxis: 'vertical',
        orientation: 'horizontal',
        trackAxis: 'rows',
        trackIndex: 0,
      },
      {
        id: 'hdiv-r1-c1',
        gridArea: 'hdiv-r1-c1',
        dragAxis: 'vertical',
        orientation: 'horizontal',
        trackAxis: 'rows',
        trackIndex: 1,
      },
    ])
  })

  test('derives grid areas and dividers for main + bottom row', () => {
    const geometry = resolvePaneLayoutGeometry(mainWithBottomRow())

    expect(geometry.areas).toEqual([
      ['slot-main', 'slot-main', 'slot-main', 'slot-main', 'slot-main'],
      ['hdiv-r0', 'hdiv-r0', 'hdiv-r0', 'hdiv-r0', 'hdiv-r0'],
      [
        'slot-bottom-left',
        'vdiv-c0-r1',
        'slot-bottom-center',
        'vdiv-c1-r1',
        'slot-bottom-right',
      ],
    ])

    expect(geometry.dividers.map((divider) => divider.id)).toEqual([
      'vdiv-c0-r1',
      'vdiv-c1-r1',
      'hdiv-r0',
    ])
  })

  test('exposes a stable slot id to css grid-area mapping', () => {
    const geometry = resolvePaneLayoutGeometry(mainWithBottomRow())

    expect(geometry.slotAreas).toEqual([
      { slotId: 'slot:main', gridArea: 'slot-main' },
      { slotId: 'slot:bottom-left', gridArea: 'slot-bottom-left' },
      { slotId: 'slot:bottom-center', gridArea: 'slot-bottom-center' },
      { slotId: 'slot:bottom-right', gridArea: 'slot-bottom-right' },
    ])
  })
})
