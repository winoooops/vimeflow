import type {
  CustomPaneLayoutId,
  LayoutSlotId,
  PaneLayoutId,
} from '../../../sessions/types'
import {
  createIndexedPaneSlotId,
  CUSTOM_PANE_LAYOUT_ID_PREFIX,
  MAX_LAYOUT_TRACKS,
  MAX_LAYOUT_SLOTS,
  PANE_LAYOUT_SCHEMA_VERSION,
  validatePaneLayoutDefinition,
  type PaneLayoutDefinition,
  type PaneSlotRect,
} from '../../layout-registry'

export const LAYOUT_CREATOR_UNIT_TOTAL = 24

export const LAYOUT_CREATOR_MIN_UNITS = 1

export type LayoutCreatorCodeFormat = 'json' | 'yaml'

export type DraftLayoutSlot = PaneSlotRect

export interface DraftPaneLayout {
  readonly cols: readonly number[]
  readonly rows: readonly number[]
  readonly slots: readonly DraftLayoutSlot[]
}

export interface DraftLayoutValidation {
  readonly ok: boolean
  readonly emptyCells: number
  readonly overlap: boolean
  readonly overCapacity: boolean
  readonly trackOverCapacity: boolean
  readonly slotCount: number
  readonly maxSlots: number
}

interface LayoutModel {
  readonly tracks: {
    readonly columns: readonly { readonly id: string; readonly units: number }[]
    readonly rows: readonly { readonly id: string; readonly units: number }[]
  }
  readonly slots: readonly {
    readonly id: LayoutSlotId
    readonly rect: DraftLayoutSlot
  }[]
}

type Axis = 'cols' | 'rows'

export const createSingleDraftLayout = (): DraftPaneLayout => ({
  cols: [LAYOUT_CREATOR_UNIT_TOTAL],
  rows: [LAYOUT_CREATOR_UNIT_TOTAL],
  slots: [{ col: 0, row: 0, colSpan: 1, rowSpan: 1 }],
})

export const evenUnits = (trackCount: number): readonly number[] => {
  const count = Math.max(1, Math.min(MAX_LAYOUT_TRACKS, Math.floor(trackCount)))
  const base = Math.floor(LAYOUT_CREATOR_UNIT_TOTAL / count)
  const units = Array.from({ length: count }, () => base)
  let remainder = LAYOUT_CREATOR_UNIT_TOTAL - base * count

  for (let index = 0; remainder > 0; index += 1) {
    units[index] += 1
    remainder -= 1
  }

  return units
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const finiteNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : null
}

const finiteInteger = (value: unknown): number | null => {
  const parsed = finiteNumber(value)

  return parsed === null ? null : Math.round(parsed)
}

const normalizeUnits = (rawUnits: readonly number[]): readonly number[] => {
  if (rawUnits.length === 0) {
    return [LAYOUT_CREATOR_UNIT_TOTAL]
  }

  const positiveUnits = rawUnits.map((unit) =>
    Number.isFinite(unit) && unit > 0 ? unit : LAYOUT_CREATOR_MIN_UNITS
  )
  const total = positiveUnits.reduce((sum, unit) => sum + unit, 0)

  if (total <= 0) {
    return evenUnits(positiveUnits.length)
  }

  const exact = positiveUnits.map(
    (unit) => (unit / total) * LAYOUT_CREATOR_UNIT_TOTAL
  )

  const floors = exact.map((unit) =>
    Math.max(LAYOUT_CREATOR_MIN_UNITS, Math.floor(unit))
  )
  const floorTotal = floors.reduce((sum, unit) => sum + unit, 0)

  if (floorTotal > LAYOUT_CREATOR_UNIT_TOTAL) {
    return evenUnits(positiveUnits.length)
  }

  const rankedRemainders = exact
    .map((unit, index) => ({ index, remainder: unit - Math.floor(unit) }))
    .sort((left, right) => right.remainder - left.remainder)

  const normalized = [...floors]
  let remainder = LAYOUT_CREATOR_UNIT_TOTAL - floorTotal
  for (let index = 0; remainder > 0; index += 1) {
    normalized[rankedRemainders[index % rankedRemainders.length].index] += 1
    remainder -= 1
  }

  return normalized
}

const normalizeSlot = (
  slot: DraftLayoutSlot,
  colCount: number,
  rowCount: number
): DraftLayoutSlot => {
  const col = Math.max(0, Math.min(slot.col, colCount - 1))
  const row = Math.max(0, Math.min(slot.row, rowCount - 1))
  const colSpan = Math.max(1, Math.min(slot.colSpan, colCount - col))
  const rowSpan = Math.max(1, Math.min(slot.rowSpan, rowCount - row))

  return { col, row, colSpan, rowSpan }
}

export const normalizeDraftLayout = (
  draft: DraftPaneLayout
): DraftPaneLayout => {
  const cols = normalizeUnits(draft.cols)
  const rows = normalizeUnits(draft.rows)

  return {
    cols,
    rows,
    slots: draft.slots.map((slot) =>
      normalizeSlot(slot, cols.length, rows.length)
    ),
  }
}

export const occupancy = (
  colCount: number,
  rowCount: number,
  slots: readonly DraftLayoutSlot[],
  ignoreIndex: number | null = null
): readonly (readonly number[])[] => {
  const grid = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => -1)
  )

  slots.forEach((slot, slotIndex) => {
    if (slotIndex === ignoreIndex) {
      return
    }

    for (let row = slot.row; row < slot.row + slot.rowSpan; row += 1) {
      for (let col = slot.col; col < slot.col + slot.colSpan; col += 1) {
        if (row >= 0 && row < rowCount && col >= 0 && col < colCount) {
          grid[row][col] = slotIndex
        }
      }
    }
  })

  return grid
}

export const rectFree = (
  colCount: number,
  rowCount: number,
  slots: readonly DraftLayoutSlot[],
  rect: DraftLayoutSlot,
  ignoreIndex: number | null = null
): boolean => {
  const grid = occupancy(colCount, rowCount, slots, ignoreIndex)

  for (let row = rect.row; row < rect.row + rect.rowSpan; row += 1) {
    for (let col = rect.col; col < rect.col + rect.colSpan; col += 1) {
      if (row < 0 || row >= rowCount || col < 0 || col >= colCount) {
        return false
      }

      if (grid[row][col] !== -1) {
        return false
      }
    }
  }

  return true
}

export const validateDraftLayout = (
  draft: DraftPaneLayout
): DraftLayoutValidation => {
  const colCount = draft.cols.length
  const rowCount = draft.rows.length

  const grid = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => -1)
  )
  let overlap = false

  for (const [slotIndex, slot] of draft.slots.entries()) {
    for (let row = slot.row; row < slot.row + slot.rowSpan; row += 1) {
      for (let col = slot.col; col < slot.col + slot.colSpan; col += 1) {
        if (row < 0 || row >= rowCount || col < 0 || col >= colCount) {
          overlap = true

          continue
        }

        if (grid[row][col] !== -1) {
          overlap = true
        }

        grid[row][col] = slotIndex
      }
    }
  }

  const emptyCells = grid.reduce(
    (sum, row) => sum + row.filter((cell) => cell === -1).length,
    0
  )

  const trackOverCapacity =
    draft.cols.length > MAX_LAYOUT_TRACKS ||
    draft.rows.length > MAX_LAYOUT_TRACKS

  return {
    ok:
      !overlap &&
      emptyCells === 0 &&
      draft.slots.length <= MAX_LAYOUT_SLOTS &&
      !trackOverCapacity,
    emptyCells,
    overlap,
    overCapacity: draft.slots.length > MAX_LAYOUT_SLOTS,
    trackOverCapacity,
    slotCount: draft.slots.length,
    maxSlots: MAX_LAYOUT_SLOTS,
  }
}

export const rectFromCells = (
  start: { readonly col: number; readonly row: number },
  end: { readonly col: number; readonly row: number }
): DraftLayoutSlot => {
  const col = Math.min(start.col, end.col)
  const row = Math.min(start.row, end.row)
  const colSpan = Math.abs(start.col - end.col) + 1
  const rowSpan = Math.abs(start.row - end.row) + 1

  return { col, row, colSpan, rowSpan }
}

const repairSlotsForTrackCount = (
  slots: readonly DraftLayoutSlot[],
  colCount: number,
  rowCount: number
): readonly DraftLayoutSlot[] => {
  const repairedSlots: DraftLayoutSlot[] = []

  slots.forEach((slot) => {
    if (slot.col >= colCount || slot.row >= rowCount) {
      return
    }

    const normalizedSlot = normalizeSlot(slot, colCount, rowCount)
    if (rectFree(colCount, rowCount, repairedSlots, normalizedSlot)) {
      repairedSlots.push(normalizedSlot)
    }
  })

  return repairedSlots.length > 0
    ? repairedSlots
    : [{ col: 0, row: 0, colSpan: 1, rowSpan: 1 }]
}

export const setTrackCount = (
  draft: DraftPaneLayout,
  axis: Axis,
  count: number
): DraftPaneLayout => {
  const shrinking =
    axis === 'cols' ? count < draft.cols.length : count < draft.rows.length

  const next = {
    cols: axis === 'cols' ? evenUnits(count) : draft.cols,
    rows: axis === 'rows' ? evenUnits(count) : draft.rows,
    slots: draft.slots,
  }

  const normalized = normalizeDraftLayout(next)

  if (!shrinking) {
    return normalized
  }

  return {
    ...normalized,
    slots: repairSlotsForTrackCount(
      draft.slots,
      normalized.cols.length,
      normalized.rows.length
    ),
  }
}

const updateBoundaryUnits = (
  tracks: readonly number[],
  boundaryIndex: number,
  boundaryRatio: number
): readonly number[] => {
  if (boundaryIndex < 0 || boundaryIndex >= tracks.length - 1) {
    return tracks
  }

  const next = [...tracks]
  const left = next[boundaryIndex]
  const right = next[boundaryIndex + 1]

  const total = next.reduce((sum, unit) => sum + unit, 0)

  const fixedLeading = next
    .slice(0, boundaryIndex)
    .reduce((sum, unit) => sum + unit, 0)
  const pairTotal = left + right
  const rawLeft = Math.round(boundaryRatio * total - fixedLeading)

  const nextLeft = Math.min(
    Math.max(rawLeft, LAYOUT_CREATOR_MIN_UNITS),
    pairTotal - LAYOUT_CREATOR_MIN_UNITS
  )

  next[boundaryIndex] = nextLeft
  next[boundaryIndex + 1] = pairTotal - nextLeft

  return next
}

export const updateTrackBoundary = (
  draft: DraftPaneLayout,
  axis: Axis,
  boundaryIndex: number,
  boundaryRatio: number
): DraftPaneLayout => {
  if (axis === 'cols') {
    return {
      ...draft,
      cols: updateBoundaryUnits(draft.cols, boundaryIndex, boundaryRatio),
    }
  }

  return {
    ...draft,
    rows: updateBoundaryUnits(draft.rows, boundaryIndex, boundaryRatio),
  }
}

export const addFirstFreeSlot = (draft: DraftPaneLayout): DraftPaneLayout => {
  if (draft.slots.length >= MAX_LAYOUT_SLOTS) {
    return draft
  }

  const grid = occupancy(draft.cols.length, draft.rows.length, draft.slots)

  for (let row = 0; row < draft.rows.length; row += 1) {
    for (let col = 0; col < draft.cols.length; col += 1) {
      if (grid[row][col] === -1) {
        return {
          ...draft,
          slots: [...draft.slots, { col, row, colSpan: 1, rowSpan: 1 }],
        }
      }
    }
  }

  return draft
}

export const addSlotRect = (
  draft: DraftPaneLayout,
  rect: DraftLayoutSlot
): DraftPaneLayout => {
  if (draft.slots.length >= MAX_LAYOUT_SLOTS) {
    return draft
  }

  if (
    !rectFree(draft.cols.length, draft.rows.length, draft.slots, rect, null)
  ) {
    return draft
  }

  return { ...draft, slots: [...draft.slots, rect] }
}

export const moveSlot = (
  draft: DraftPaneLayout,
  slotIndex: number,
  rect: DraftLayoutSlot
): DraftPaneLayout => {
  if (slotIndex < 0 || slotIndex >= draft.slots.length) {
    return draft
  }

  const normalizedRect = normalizeSlot(
    rect,
    draft.cols.length,
    draft.rows.length
  )

  if (
    !rectFree(
      draft.cols.length,
      draft.rows.length,
      draft.slots,
      normalizedRect,
      slotIndex
    )
  ) {
    return draft
  }

  return {
    ...draft,
    slots: draft.slots.map((slot, index) =>
      index === slotIndex ? normalizedRect : slot
    ),
  }
}

export const removeSlot = (
  draft: DraftPaneLayout,
  slotIndex: number
): DraftPaneLayout => {
  if (draft.slots.length <= 1) {
    return draft
  }

  return {
    ...draft,
    slots: draft.slots.filter((_, index) => index !== slotIndex),
  }
}

const draftToModel = (draft: DraftPaneLayout): LayoutModel => ({
  tracks: {
    columns: draft.cols.map((unit, index) => ({
      id: `col-${index}`,
      units: unit,
    })),
    rows: draft.rows.map((unit, index) => ({
      id: `row-${index}`,
      units: unit,
    })),
  },
  slots: draft.slots.map((slot, index) => ({
    id: createIndexedPaneSlotId(index),
    rect: { ...slot },
  })),
})

export const serializeDraftLayout = (
  draft: DraftPaneLayout,
  format: LayoutCreatorCodeFormat
): string => {
  const model = draftToModel(draft)
  if (format === 'json') {
    return JSON.stringify(model, null, 2)
  }

  const lines: string[] = ['tracks:', '  columns:']
  model.tracks.columns.forEach((track) => {
    lines.push(`    - id: ${track.id}`)
    lines.push(`      units: ${track.units}`)
  })
  lines.push('  rows:')
  model.tracks.rows.forEach((track) => {
    lines.push(`    - id: ${track.id}`)
    lines.push(`      units: ${track.units}`)
  })
  lines.push('slots:')
  model.slots.forEach((slot) => {
    lines.push(`  - id: ${slot.id}`)
    lines.push(
      `    rect: { col: ${slot.rect.col}, row: ${slot.rect.row}, colSpan: ${slot.rect.colSpan}, rowSpan: ${slot.rect.rowSpan} }`
    )
  })

  return lines.join('\n')
}

const readTrackUnits = (value: unknown): readonly number[] => {
  if (!Array.isArray(value)) {
    throw new Error('Track axis must be an array')
  }

  const units = value.map((track) => {
    if (!isRecord(track)) {
      throw new Error('Each track must be an object')
    }

    const parsedUnits = finiteInteger(track.units)
    if (parsedUnits === null || parsedUnits <= 0) {
      throw new Error('Track units must be positive numbers')
    }

    return parsedUnits
  })

  if (units.length === 0) {
    throw new Error('Need at least one column and row')
  }

  return units
}

const readSlotRect = (value: unknown): DraftLayoutSlot => {
  if (!isRecord(value)) {
    throw new Error('Each slot must be an object')
  }

  const rectValue = isRecord(value.rect) ? value.rect : value
  const col = finiteInteger(rectValue.col)
  const row = finiteInteger(rectValue.row)
  const colSpan = finiteInteger(rectValue.colSpan)
  const rowSpan = finiteInteger(rectValue.rowSpan)

  if (
    col === null ||
    row === null ||
    colSpan === null ||
    rowSpan === null ||
    colSpan <= 0 ||
    rowSpan <= 0
  ) {
    throw new Error('Slot rects require col, row, colSpan, and rowSpan')
  }

  return { col, row, colSpan, rowSpan }
}

const modelToDraft = (value: unknown): DraftPaneLayout => {
  if (!isRecord(value) || !isRecord(value.tracks)) {
    throw new Error('Expected { tracks: { columns, rows }, slots }')
  }

  const cols = readTrackUnits(value.tracks.columns)
  const rows = readTrackUnits(value.tracks.rows)
  if (!Array.isArray(value.slots)) {
    throw new Error('Slots must be an array')
  }

  const draft = normalizeDraftLayout({
    cols,
    rows,
    slots: value.slots.map(readSlotRect),
  })

  const validation = validateDraftLayout(draft)
  if (!validation.ok) {
    throw new Error(
      validation.trackOverCapacity
        ? `Imported layout has too many tracks (max ${MAX_LAYOUT_TRACKS})`
        : validation.overCapacity
          ? `Imported layout supports up to ${validation.maxSlots} panes`
          : validation.overlap
            ? 'Imported layout has overlapping panes'
            : 'Imported layout must cover every grid cell'
    )
  }

  return draft
}

const parseYamlModel = (text: string): LayoutModel => {
  const columns: { id: string; units: number }[] = []
  const rows: { id: string; units: number }[] = []
  const slots: { id: LayoutSlotId; rect: DraftLayoutSlot }[] = []
  let section: 'columns' | 'rows' | 'slots' | null = null
  let currentTrack: { id?: string; units?: number } | null = null
  let currentSlot: { id?: LayoutSlotId; rect?: DraftLayoutSlot } | null = null

  const commitTrack = (): void => {
    if (currentTrack === null || section === 'slots') {
      return
    }

    const units = currentTrack.units
    if (units === undefined) {
      return
    }

    const target = section === 'columns' ? columns : rows
    target.push({ id: currentTrack.id ?? `${section}-${target.length}`, units })
  }

  const commitSlot = (): void => {
    if (currentSlot?.rect === undefined) {
      return
    }

    slots.push({
      id: currentSlot.id ?? createIndexedPaneSlotId(slots.length),
      rect: currentSlot.rect,
    })
  }

  text
    .replace(/\r/g, '')
    .split('\n')
    .forEach((rawLine) => {
      const line = rawLine.trim()
      if (line.length === 0 || line.startsWith('#') || line === 'tracks:') {
        return
      }

      if (line === 'columns:' || line === 'rows:' || line === 'slots:') {
        if (section === 'slots') {
          commitSlot()
          currentSlot = null
        } else {
          commitTrack()
          currentTrack = null
        }
        section = line.slice(0, -1) as 'columns' | 'rows' | 'slots'

        return
      }

      const itemBody = line.startsWith('- ') ? line.slice(2).trim() : line
      if (line.startsWith('- ')) {
        if (section === 'slots') {
          commitSlot()
          currentSlot = {}
        } else {
          commitTrack()
          currentTrack = {}
        }
      }

      const [key, ...rest] = itemBody.split(':')
      if (!key || rest.length === 0) {
        return
      }

      const value = rest.join(':').trim()
      if (section === 'slots') {
        currentSlot ??= {}
        if (key === 'id') {
          currentSlot.id = value as LayoutSlotId
        }
        if (key === 'rect') {
          const rectValues = new Map(
            value
              .replace(/[{}]/g, '')
              .split(',')
              .map((pair) => pair.split(':').map((part) => part.trim()))
              .filter((pair): pair is [string, string] => pair.length === 2)
          )
          currentSlot.rect = readSlotRect({
            col: rectValues.get('col'),
            row: rectValues.get('row'),
            colSpan: rectValues.get('colSpan'),
            rowSpan: rectValues.get('rowSpan'),
          })
        }

        return
      }

      currentTrack ??= {}
      if (key === 'id') {
        currentTrack.id = value
      }
      if (key === 'units') {
        const units = finiteInteger(value)
        if (units !== null) {
          currentTrack.units = units
        }
      }
    })

  commitSlot()
  commitTrack()

  return {
    tracks: { columns, rows },
    slots,
  }
}

export const parseDraftLayoutText = (
  text: string,
  format: LayoutCreatorCodeFormat
): DraftPaneLayout => {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    throw new Error('Nothing to import')
  }

  if (format === 'yaml') {
    let yamlError: unknown = null
    try {
      return modelToDraft(parseYamlModel(trimmed))
    } catch (error) {
      yamlError = error
      // JSON is a useful fallback because pasted JSON is common and valid YAML.
    }

    try {
      const parsed: unknown = JSON.parse(trimmed)

      return modelToDraft(parsed)
    } catch {
      if (yamlError instanceof Error) {
        throw yamlError
      }

      throw new Error('Invalid YAML')
    }
  }

  const parsed: unknown = JSON.parse(trimmed)

  return modelToDraft(parsed)
}

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const createCustomPaneLayoutId = (
  title: string,
  existingIds: ReadonlySet<PaneLayoutId>
): CustomPaneLayoutId => {
  const slug = slugify(title) || 'layout'

  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Date.now().toString(36)
  let candidate =
    `${CUSTOM_PANE_LAYOUT_ID_PREFIX}${slug}-${suffix}` as CustomPaneLayoutId
  let counter = 2

  while (existingIds.has(candidate)) {
    candidate =
      `${CUSTOM_PANE_LAYOUT_ID_PREFIX}${slug}-${suffix}-${counter}` as CustomPaneLayoutId
    counter += 1
  }

  return candidate
}

export const definitionFromDraft = ({
  title,
  draft,
  existingIds,
  existingId = undefined,
}: {
  readonly title: string
  readonly draft: DraftPaneLayout
  readonly existingIds: ReadonlySet<PaneLayoutId>
  readonly existingId?: CustomPaneLayoutId | undefined
}): PaneLayoutDefinition => {
  const normalizedDraft = normalizeDraftLayout(draft)
  const id = existingId ?? createCustomPaneLayoutId(title, existingIds)

  const slots = normalizedDraft.slots.map((slot, index) => ({
    id: createIndexedPaneSlotId(index),
    rect: { ...slot },
  }))

  const definition: PaneLayoutDefinition = {
    schemaVersion: PANE_LAYOUT_SCHEMA_VERSION,
    id,
    title: title.trim(),
    source: 'workspace',
    tracks: {
      columns: normalizedDraft.cols.map((units, index) => ({
        id: `col-${index}`,
        units,
      })),
      rows: normalizedDraft.rows.map((units, index) => ({
        id: `row-${index}`,
        units,
      })),
    },
    slots,
    addOrder: slots.map((slot) => slot.id),
  }

  const validation = validatePaneLayoutDefinition(definition)
  if (!validation.ok) {
    throw new Error(validation.errors[0]?.message ?? 'Invalid layout')
  }

  return definition
}

export const draftFromDefinition = (
  definition: PaneLayoutDefinition | undefined
): DraftPaneLayout => {
  if (definition === undefined) {
    return createSingleDraftLayout()
  }

  return normalizeDraftLayout({
    cols: definition.tracks.columns.map((track) => track.units),
    rows: definition.tracks.rows.map((track) => track.units),
    slots: definition.slots.map((slot) => ({ ...slot.rect })),
  })
}

export const formatDraftMeta = (draft: DraftPaneLayout): string =>
  `${draft.cols.length}x${draft.rows.length} grid · cols ${draft.cols.join(
    '/'
  )} · rows ${draft.rows.join('/')}`
