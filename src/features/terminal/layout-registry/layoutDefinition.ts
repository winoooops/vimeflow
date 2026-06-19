import type {
  CustomPaneLayoutId,
  LayoutId,
  LayoutSlotId,
  PaneKind,
  PaneLayoutId,
} from '../../sessions/types'
import { LAYOUT_IDS } from './layoutIds'
import type { LayoutRatios } from './ratioModel'

export type BuiltinPaneLayoutId = LayoutId

export type { CustomPaneLayoutId, LayoutSlotId, PaneLayoutId }

export type PaneLayoutSource = 'builtin' | 'workspace'

export type PaneLayoutSchemaVersion = 1

export interface TrackSpec {
  readonly id: string
  readonly units: number
  readonly minPx?: number
}

export interface PaneSlotRect {
  readonly col: number
  readonly row: number
  readonly colSpan: number
  readonly rowSpan: number
}

export interface PaneSlotSpec {
  readonly id: LayoutSlotId
  readonly rect: PaneSlotRect
  readonly accepts?: readonly string[]
}

export interface PaneLayoutDefinition {
  readonly schemaVersion: number
  readonly id: PaneLayoutId
  readonly title: string
  readonly source: PaneLayoutSource
  readonly tracks: {
    readonly columns: readonly TrackSpec[]
    readonly rows: readonly TrackSpec[]
  }
  readonly slots: readonly PaneSlotSpec[]
  readonly addOrder: readonly LayoutSlotId[]
}

export type PaneLayoutValidationCode =
  | 'unsupported-schema-version'
  | 'invalid-id-namespace'
  | 'empty-title'
  | 'invalid-track-count'
  | 'duplicate-track-id'
  | 'invalid-track-id'
  | 'invalid-track-units'
  | 'invalid-track-min-px'
  | 'invalid-slot-count'
  | 'invalid-slot-id'
  | 'duplicate-slot-id'
  | 'duplicate-grid-area'
  | 'invalid-slot-rect'
  | 'slot-out-of-bounds'
  | 'slot-overlap'
  | 'layout-hole'
  | 'invalid-add-order'
  | 'unknown-add-order-slot'
  | 'duplicate-add-order-slot'
  | 'unsupported-pane-kind'

export interface PaneLayoutValidationError {
  readonly code: PaneLayoutValidationCode
  readonly path: string
  readonly message: string
}

export interface PaneLayoutValidationResult {
  readonly ok: boolean
  readonly errors: readonly PaneLayoutValidationError[]
}

export interface PaneLayoutRegistrySnapshot {
  readonly layouts: readonly PaneLayoutDefinition[]
  readonly rejected: readonly RejectedPaneLayoutDefinition[]
}

export interface RejectedPaneLayoutDefinition {
  readonly definition: PaneLayoutDefinition
  readonly errors: readonly PaneLayoutValidationError[]
}

export const CUSTOM_PANE_LAYOUT_ID_PREFIX = 'custom:'

export const LAYOUT_SLOT_ID_PREFIX = 'slot:'

export const PANE_LAYOUT_SCHEMA_VERSION: PaneLayoutSchemaVersion = 1

export const MIN_LAYOUT_TRACKS = 1

export const MAX_LAYOUT_TRACKS = 4

export const MIN_LAYOUT_SLOTS = 1

export const MAX_LAYOUT_SLOTS = 16

const BUILTIN_LAYOUT_IDS = new Set<string>(LAYOUT_IDS)
const PANE_KINDS: readonly PaneKind[] = ['shell', 'browser']

export const isBuiltinPaneLayoutId = (
  value: string
): value is BuiltinPaneLayoutId => BUILTIN_LAYOUT_IDS.has(value)

export const isCustomPaneLayoutId = (
  value: string
): value is CustomPaneLayoutId =>
  value.startsWith(CUSTOM_PANE_LAYOUT_ID_PREFIX) &&
  value.length > CUSTOM_PANE_LAYOUT_ID_PREFIX.length

export const isPaneLayoutId = (value: string): value is PaneLayoutId =>
  isBuiltinPaneLayoutId(value) || isCustomPaneLayoutId(value)

export const isLayoutSlotId = (value: string): value is LayoutSlotId =>
  value.startsWith(LAYOUT_SLOT_ID_PREFIX) &&
  value.length > LAYOUT_SLOT_ID_PREFIX.length

export const createPaneSlotId = (suffix: string): LayoutSlotId =>
  `${LAYOUT_SLOT_ID_PREFIX}${suffix}`

export const createIndexedPaneSlotId = (index: number): LayoutSlotId =>
  createPaneSlotId(`p${index}`)

export const getPaneLayoutCapacity = (
  definition: PaneLayoutDefinition
): number => definition.slots.length

/**
 * Returns the raw track units from a layout definition. For prebuilt layouts
 * these are normalized to the same scale as the canonical default ratios; for
 * custom layouts they reflect the values supplied by the caller. Callers that
 * need the canonical default ratios for drag-state initialization should read
 * `layout.defaultRatios` instead.
 */
export const getPaneLayoutRatios = (
  definition: PaneLayoutDefinition
): LayoutRatios => ({
  cols: definition.tracks.columns.map((track) => track.units),
  rows: definition.tracks.rows.map((track) => track.units),
})

export const gridAreaNameForSlotId = (slotId: LayoutSlotId): string => {
  const suffix = slotId.slice(LAYOUT_SLOT_ID_PREFIX.length)
  if (/^p\d+$/.test(suffix)) {
    return suffix
  }

  const sanitized = suffix.replace(/[^a-zA-Z0-9_-]/g, '-')

  return `slot-${sanitized}`
}

const validationError = (
  code: PaneLayoutValidationCode,
  path: string,
  message: string
): PaneLayoutValidationError => ({ code, path, message })

const isFinitePositive = (value: number): boolean =>
  Number.isFinite(value) && value > 0

const isFiniteNonNegative = (value: number): boolean =>
  Number.isFinite(value) && value >= 0

const isSupportedPaneKind = (value: string): value is PaneKind =>
  (PANE_KINDS as readonly string[]).includes(value)

const validateSourceAndId = (
  definition: PaneLayoutDefinition
): readonly PaneLayoutValidationError[] => {
  if (
    definition.source === 'workspace' &&
    !isCustomPaneLayoutId(definition.id)
  ) {
    return [
      validationError(
        'invalid-id-namespace',
        'id',
        'Workspace layouts must use custom:<id> ids.'
      ),
    ]
  }

  if (
    definition.source === 'builtin' &&
    !isBuiltinPaneLayoutId(definition.id)
  ) {
    return [
      validationError(
        'invalid-id-namespace',
        'id',
        'Builtin layouts must use a known prebuilt layout id.'
      ),
    ]
  }

  return []
}

const validateTracks = (
  axis: 'columns' | 'rows',
  tracks: readonly TrackSpec[]
): readonly PaneLayoutValidationError[] => {
  const errors: PaneLayoutValidationError[] = []

  if (tracks.length < MIN_LAYOUT_TRACKS || tracks.length > MAX_LAYOUT_TRACKS) {
    errors.push(
      validationError(
        'invalid-track-count',
        `tracks.${axis}`,
        `Layouts must have ${MIN_LAYOUT_TRACKS}-${MAX_LAYOUT_TRACKS} ${axis}.`
      )
    )
  }

  const seen = new Set<string>()
  tracks.forEach((track, index) => {
    const path = `tracks.${axis}.${index}`

    if (track.id.trim().length === 0) {
      errors.push(
        validationError(
          'invalid-track-id',
          `${path}.id`,
          'Track id must not be empty.'
        )
      )
    }

    if (seen.has(track.id)) {
      errors.push(
        validationError(
          'duplicate-track-id',
          `${path}.id`,
          `Duplicate ${axis} track id: ${track.id}.`
        )
      )
    }
    seen.add(track.id)

    if (!isFinitePositive(track.units)) {
      errors.push(
        validationError(
          'invalid-track-units',
          `${path}.units`,
          'Track units must be a finite positive number.'
        )
      )
    }

    if (track.minPx !== undefined && !isFiniteNonNegative(track.minPx)) {
      errors.push(
        validationError(
          'invalid-track-min-px',
          `${path}.minPx`,
          'Track minimum size must be finite and non-negative.'
        )
      )
    }
  })

  return errors
}

const validateSlotRect = (
  slot: PaneSlotSpec,
  index: number,
  colCount: number,
  rowCount: number,
  occupiedCells: Map<string, LayoutSlotId>
): readonly PaneLayoutValidationError[] => {
  const errors: PaneLayoutValidationError[] = []
  const { rect } = slot
  const path = `slots.${index}.rect`

  const rectValues = [rect.col, rect.row, rect.colSpan, rect.rowSpan]
  if (!rectValues.every(Number.isInteger)) {
    errors.push(
      validationError(
        'invalid-slot-rect',
        path,
        'Slot rect values must be integers.'
      )
    )

    return errors
  }

  if (rect.col < 0 || rect.row < 0 || rect.colSpan <= 0 || rect.rowSpan <= 0) {
    errors.push(
      validationError(
        'invalid-slot-rect',
        path,
        'Slot rect must start in bounds and use positive spans.'
      )
    )

    return errors
  }

  const colEnd = rect.col + rect.colSpan
  const rowEnd = rect.row + rect.rowSpan
  if (colEnd > colCount || rowEnd > rowCount) {
    errors.push(
      validationError(
        'slot-out-of-bounds',
        path,
        'Slot rect must fit within the declared tracks.'
      )
    )

    return errors
  }

  for (let row = rect.row; row < rowEnd; row += 1) {
    for (let col = rect.col; col < colEnd; col += 1) {
      const cellKey = `${col}:${row}`
      const existing = occupiedCells.get(cellKey)
      if (existing) {
        errors.push(
          validationError(
            'slot-overlap',
            path,
            `Slot ${slot.id} overlaps ${existing} at ${cellKey}.`
          )
        )
      } else {
        occupiedCells.set(cellKey, slot.id)
      }
    }
  }

  return errors
}

const validateSlots = (
  definition: PaneLayoutDefinition
): readonly PaneLayoutValidationError[] => {
  const errors: PaneLayoutValidationError[] = []
  const { slots } = definition
  const colCount = definition.tracks.columns.length
  const rowCount = definition.tracks.rows.length

  if (slots.length < MIN_LAYOUT_SLOTS || slots.length > MAX_LAYOUT_SLOTS) {
    errors.push(
      validationError(
        'invalid-slot-count',
        'slots',
        `Layouts must have ${MIN_LAYOUT_SLOTS}-${MAX_LAYOUT_SLOTS} slots.`
      )
    )
  }

  const seenSlots = new Set<LayoutSlotId>()
  const occupiedCells = new Map<string, LayoutSlotId>()
  const seenGridAreas = new Map<string, LayoutSlotId>()

  slots.forEach((slot, index) => {
    const path = `slots.${index}`
    if (!isLayoutSlotId(slot.id)) {
      errors.push(
        validationError(
          'invalid-slot-id',
          `${path}.id`,
          'Slot ids must use the slot:<id> namespace.'
        )
      )
    }

    if (seenSlots.has(slot.id)) {
      errors.push(
        validationError(
          'duplicate-slot-id',
          `${path}.id`,
          `Duplicate slot id: ${slot.id}.`
        )
      )
    }
    seenSlots.add(slot.id)

    if (isLayoutSlotId(slot.id)) {
      const gridArea = gridAreaNameForSlotId(slot.id)
      const existing = seenGridAreas.get(gridArea)
      if (existing !== undefined) {
        errors.push(
          validationError(
            'duplicate-grid-area',
            `${path}.id`,
            `Slot ${slot.id} produces the same grid area as ${existing} after sanitization.`
          )
        )
      }
      seenGridAreas.set(gridArea, slot.id)
    }

    for (const paneKind of slot.accepts ?? []) {
      if (!isSupportedPaneKind(paneKind)) {
        errors.push(
          validationError(
            'unsupported-pane-kind',
            `${path}.accepts`,
            `Unsupported pane kind: ${paneKind}.`
          )
        )
      }
    }

    errors.push(
      ...validateSlotRect(slot, index, colCount, rowCount, occupiedCells)
    )
  })

  const expectedCellCount = colCount * rowCount
  if (occupiedCells.size < expectedCellCount) {
    errors.push(
      validationError(
        'layout-hole',
        'slots',
        'Slots must cover every grid cell in v1 layouts.'
      )
    )
  }

  return errors
}

const validateAddOrder = (
  definition: PaneLayoutDefinition
): readonly PaneLayoutValidationError[] => {
  const errors: PaneLayoutValidationError[] = []
  const slotIds = new Set(definition.slots.map((slot) => slot.id))
  const seen = new Set<LayoutSlotId>()

  if (definition.addOrder.length !== definition.slots.length) {
    errors.push(
      validationError(
        'invalid-add-order',
        'addOrder',
        'Add order must include every slot exactly once.'
      )
    )
  }

  definition.addOrder.forEach((slotId, index) => {
    const path = `addOrder.${index}`
    if (!slotIds.has(slotId)) {
      errors.push(
        validationError(
          'unknown-add-order-slot',
          path,
          `Add order references unknown slot: ${slotId}.`
        )
      )
    }

    if (seen.has(slotId)) {
      errors.push(
        validationError(
          'duplicate-add-order-slot',
          path,
          `Add order repeats slot: ${slotId}.`
        )
      )
    }
    seen.add(slotId)
  })

  return errors
}

export const validatePaneLayoutDefinition = (
  definition: PaneLayoutDefinition
): PaneLayoutValidationResult => {
  const errors: PaneLayoutValidationError[] = []

  if (definition.schemaVersion !== PANE_LAYOUT_SCHEMA_VERSION) {
    errors.push(
      validationError(
        'unsupported-schema-version',
        'schemaVersion',
        `Unsupported pane layout schema version: ${definition.schemaVersion}.`
      )
    )
  }

  errors.push(...validateSourceAndId(definition))

  if (definition.title.trim().length === 0) {
    errors.push(
      validationError('empty-title', 'title', 'Layout title must not be empty.')
    )
  }

  errors.push(
    ...validateTracks('columns', definition.tracks.columns),
    ...validateTracks('rows', definition.tracks.rows),
    ...validateSlots(definition),
    ...validateAddOrder(definition)
  )

  return {
    ok: errors.length === 0,
    errors,
  }
}

export const assemblePaneLayoutRegistry = ({
  prebuilt,
  custom,
}: {
  readonly prebuilt: readonly PaneLayoutDefinition[]
  readonly custom: readonly PaneLayoutDefinition[]
}): PaneLayoutRegistrySnapshot => {
  const layouts: PaneLayoutDefinition[] = []
  const rejected: RejectedPaneLayoutDefinition[] = []
  const prebuiltIds = new Set(prebuilt.map((definition) => definition.id))
  const acceptedIds = new Set<PaneLayoutId>()

  const acceptOrReject = (definition: PaneLayoutDefinition): void => {
    const validation = validatePaneLayoutDefinition(definition)

    const shadowErrors =
      definition.source === 'workspace' && prebuiltIds.has(definition.id)
        ? [
            validationError(
              'invalid-id-namespace',
              'id',
              'Custom layouts must not shadow prebuilt layout ids.'
            ),
          ]
        : []

    const duplicateErrors = acceptedIds.has(definition.id)
      ? [
          validationError(
            'invalid-id-namespace',
            'id',
            `Duplicate layout id: ${definition.id}.`
          ),
        ]
      : []

    const errors = [...validation.errors, ...shadowErrors, ...duplicateErrors]
    if (errors.length > 0) {
      rejected.push({ definition, errors })

      return
    }

    layouts.push(definition)
    acceptedIds.add(definition.id)
  }

  prebuilt.forEach(acceptOrReject)
  custom.forEach(acceptOrReject)

  return { layouts, rejected }
}
