// cspell:ignore vsplit hsplit
import type { LayoutId } from '../../sessions/types'
import { LAYOUT_IDS } from './layoutIds'
import {
  createIndexedPaneSlotId,
  PANE_LAYOUT_SCHEMA_VERSION,
  type PaneLayoutDefinition,
  type PaneSlotSpec,
  type TrackSpec,
} from './layoutDefinition'

const columns = (...units: readonly number[]): readonly TrackSpec[] =>
  units.map((unit, index) => ({ id: `c${index}`, units: unit }))

const rows = (...units: readonly number[]): readonly TrackSpec[] =>
  units.map((unit, index) => ({ id: `r${index}`, units: unit }))

const slot = (paneIndex: number, rect: PaneSlotSpec['rect']): PaneSlotSpec => ({
  id: createIndexedPaneSlotId(paneIndex),
  rect,
})

const addOrderFor = (
  slots: readonly PaneSlotSpec[]
): readonly PaneSlotSpec['id'][] => slots.map((paneSlot) => paneSlot.id)

const definePrebuiltLayout = ({
  id,
  title,
  tracks,
  slots,
}: {
  readonly id: LayoutId
  readonly title: string
  readonly tracks: PaneLayoutDefinition['tracks']
  readonly slots: readonly PaneSlotSpec[]
}): PaneLayoutDefinition => ({
  schemaVersion: PANE_LAYOUT_SCHEMA_VERSION,
  id,
  title,
  source: 'builtin',
  tracks,
  slots,
  addOrder: addOrderFor(slots),
})

export const PREBUILT_PANE_LAYOUTS_BY_ID: Record<
  LayoutId,
  PaneLayoutDefinition
> = {
  single: definePrebuiltLayout({
    id: 'single',
    title: 'Single',
    tracks: {
      columns: columns(24),
      rows: rows(24),
    },
    slots: [slot(0, { col: 0, row: 0, colSpan: 1, rowSpan: 1 })],
  }),
  vsplit: definePrebuiltLayout({
    id: 'vsplit',
    title: 'Vertical split',
    tracks: {
      columns: columns(12, 12),
      rows: rows(24),
    },
    slots: [
      slot(0, { col: 0, row: 0, colSpan: 1, rowSpan: 1 }),
      slot(1, { col: 1, row: 0, colSpan: 1, rowSpan: 1 }),
    ],
  }),
  hsplit: definePrebuiltLayout({
    id: 'hsplit',
    title: 'Horizontal split',
    tracks: {
      columns: columns(24),
      rows: rows(12, 12),
    },
    slots: [
      slot(0, { col: 0, row: 0, colSpan: 1, rowSpan: 1 }),
      slot(1, { col: 0, row: 1, colSpan: 1, rowSpan: 1 }),
    ],
  }),
  threeRight: definePrebuiltLayout({
    id: 'threeRight',
    title: 'Main + 2 stack',
    tracks: {
      columns: columns(14, 10),
      rows: rows(12, 12),
    },
    slots: [
      slot(0, { col: 0, row: 0, colSpan: 1, rowSpan: 2 }),
      slot(1, { col: 1, row: 0, colSpan: 1, rowSpan: 1 }),
      slot(2, { col: 1, row: 1, colSpan: 1, rowSpan: 1 }),
    ],
  }),
  quad: definePrebuiltLayout({
    id: 'quad',
    title: 'Quad',
    tracks: {
      columns: columns(12, 12),
      rows: rows(12, 12),
    },
    slots: [
      slot(0, { col: 0, row: 0, colSpan: 1, rowSpan: 1 }),
      slot(1, { col: 1, row: 0, colSpan: 1, rowSpan: 1 }),
      slot(2, { col: 0, row: 1, colSpan: 1, rowSpan: 1 }),
      slot(3, { col: 1, row: 1, colSpan: 1, rowSpan: 1 }),
    ],
  }),
  grid3x2: definePrebuiltLayout({
    id: 'grid3x2',
    title: '3x2 grid',
    tracks: {
      columns: columns(8, 8, 8),
      rows: rows(12, 12),
    },
    slots: [
      slot(0, { col: 0, row: 0, colSpan: 1, rowSpan: 1 }),
      slot(1, { col: 1, row: 0, colSpan: 1, rowSpan: 1 }),
      slot(2, { col: 2, row: 0, colSpan: 1, rowSpan: 1 }),
      slot(3, { col: 0, row: 1, colSpan: 1, rowSpan: 1 }),
      slot(4, { col: 1, row: 1, colSpan: 1, rowSpan: 1 }),
      slot(5, { col: 2, row: 1, colSpan: 1, rowSpan: 1 }),
    ],
  }),
}

export const PREBUILT_PANE_LAYOUTS: readonly PaneLayoutDefinition[] =
  LAYOUT_IDS.map((layoutId) => PREBUILT_PANE_LAYOUTS_BY_ID[layoutId])
