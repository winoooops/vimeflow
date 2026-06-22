import {
  createIndexedPaneSlotId,
  createPaneSlotId,
  CUSTOM_PANE_LAYOUT_ID_PREFIX,
  PANE_LAYOUT_SCHEMA_VERSION,
  type LayoutSlotId,
  type PaneLayoutDefinition,
  type PaneSlotSpec,
  type TrackSpec,
} from './layoutDefinition'

/**
 * Starter layouts surfaced in the LayoutCreator gallery. Each entry is a fully
 * valid {@link PaneLayoutDefinition} minted by a factory below — they are NOT
 * builtin layouts (no `LAYOUT_IDS` / `PREBUILT_PANE_LAYOUTS_BY_ID` entry) and
 * render through the same registry / glyph / grid paths as user-authored custom
 * layouts. The creator discards the seed `custom:` id and mints a fresh one on
 * save, so these stable ids are only ever used as gallery seeds.
 */

/** Track-unit budget per axis — the 24-unit mental model from VIM-164. */
const TRACK_UNIT_BUDGET = 24

/** Even split of the 24-unit budget across `count` tracks (ratios summing to 24). */
const evenTrackUnits = (count: number): readonly number[] =>
  Array.from({ length: count }, () => TRACK_UNIT_BUDGET / count)

const tracksFromUnits = (
  prefix: string,
  units: readonly number[]
): readonly TrackSpec[] =>
  units.map((unit, index) => ({ id: `${prefix}${index}`, units: unit }))

const addOrderFor = (slots: readonly PaneSlotSpec[]): readonly LayoutSlotId[] =>
  slots.map((slot) => slot.id)

const buildDefinition = ({
  id,
  title,
  columns,
  rows,
  slots,
}: {
  readonly id: string
  readonly title: string
  readonly columns: readonly TrackSpec[]
  readonly rows: readonly TrackSpec[]
  readonly slots: readonly PaneSlotSpec[]
}): PaneLayoutDefinition => ({
  schemaVersion: PANE_LAYOUT_SCHEMA_VERSION,
  id: `${CUSTOM_PANE_LAYOUT_ID_PREFIX}${id}`,
  title,
  source: 'workspace',
  tracks: { columns, rows },
  slots,
  addOrder: addOrderFor(slots),
})

/**
 * Even N-column by M-row grid: `colCount` columns wide and `rowCount` rows tall,
 * with one single-cell slot per cell numbered row-major (left-to-right,
 * top-to-bottom). A 2x3 grid is therefore 2 columns and 3 rows = 6 slots, with
 * `slot:p0` top-left and `slot:p5` bottom-right.
 */
export const createGridTemplate = (
  colCount: number,
  rowCount: number
): PaneLayoutDefinition => {
  const columns = tracksFromUnits('c', evenTrackUnits(colCount))
  const rows = tracksFromUnits('r', evenTrackUnits(rowCount))

  const slots: PaneSlotSpec[] = []
  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < colCount; col += 1) {
      slots.push({
        id: createIndexedPaneSlotId(slots.length),
        rect: { col, row, colSpan: 1, rowSpan: 1 },
      })
    }
  }

  return buildDefinition({
    id: `template-${colCount}x${rowCount}`,
    title: `${colCount} × ${rowCount} grid`,
    columns,
    rows,
    slots,
  })
}

/**
 * Wide main column on the left spanning all rows, with a right column of three
 * stacked slots. Columns use a 16/8 split so the main pane reads as the focus.
 */
export const createMainRightStackTemplate = (): PaneLayoutDefinition => {
  const columns: readonly TrackSpec[] = [
    { id: 'main', units: 16 },
    { id: 'side', units: 8 },
  ]
  const rows = tracksFromUnits('r', evenTrackUnits(3))

  const slots: readonly PaneSlotSpec[] = [
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
  ]

  return buildDefinition({
    id: 'template-main-right-stack',
    title: 'Main + right stack',
    columns,
    rows,
    slots,
  })
}

/**
 * Tall main row across the top spanning all columns, with a bottom row of three
 * side-by-side slots. Rows use a 16/8 split so the main pane reads as the focus.
 */
export const createMainBottomRowTemplate = (): PaneLayoutDefinition => {
  const columns = tracksFromUnits('c', evenTrackUnits(3))

  const rows: readonly TrackSpec[] = [
    { id: 'main', units: 16 },
    { id: 'row', units: 8 },
  ]

  const slots: readonly PaneSlotSpec[] = [
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
  ]

  return buildDefinition({
    id: 'template-main-bottom-row',
    title: 'Main + bottom row',
    columns,
    rows,
    slots,
  })
}

/**
 * Ordered starter templates the gallery maps over (array order is display order).
 * Each is a plain {@link PaneLayoutDefinition}; the gallery reads `.id`/`.title`
 * directly, so no wrapper type is needed.
 */
export const STARTER_LAYOUT_TEMPLATES: readonly PaneLayoutDefinition[] = [
  createGridTemplate(2, 3),
  createGridTemplate(3, 3),
  createGridTemplate(4, 4),
  createMainRightStackTemplate(),
  createMainBottomRowTemplate(),
]
