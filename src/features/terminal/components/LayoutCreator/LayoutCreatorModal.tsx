import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
import { Button } from '@/components/Button'
import { IconButton } from '@/components/IconButton'
import { SegmentedControl } from '@/components/SegmentedControl'
import type { CustomPaneLayoutId } from '../../../sessions/types'
import {
  MAX_LAYOUT_TRACKS,
  type PaneLayoutDefinition,
} from '../../layout-registry'
import {
  addFirstFreeSlot,
  addSlotRect,
  createSingleDraftLayout,
  definitionFromDraft,
  draftFromDefinition,
  formatDraftMeta,
  LAYOUT_CREATOR_UNIT_TOTAL,
  moveSlot,
  occupancy,
  parseDraftLayoutText,
  rectFromCells,
  rectFree,
  removeSlot,
  serializeDraftLayout,
  setTrackCount,
  updateTrackBoundary,
  validateDraftLayout,
  type DraftLayoutSlot,
  type DraftPaneLayout,
  type LayoutCreatorCodeFormat,
} from './layoutCreatorModel'

export interface LayoutCreatorModalProps {
  isOpen: boolean
  existingLayouts: readonly PaneLayoutDefinition[]
  seedLayout?: PaneLayoutDefinition | undefined
  editLayout?: PaneLayoutDefinition | undefined
  onSave: (definition: PaneLayoutDefinition) => void
  onCancel: () => void
}

interface GridCell {
  readonly col: number
  readonly row: number
}

interface DragState {
  readonly mode: 'paint' | 'move' | 'resize' | 'gutter'
  readonly start: GridCell
  readonly slotIndex?: number
  readonly originalSlot?: DraftLayoutSlot
  readonly edge?: ResizeEdge
  readonly axis?: 'cols' | 'rows'
  readonly boundaryIndex?: number
}

interface GridCanvasProps {
  draft: DraftPaneLayout
  onDraftChange: (next: DraftPaneLayout) => void
}

const codeFormatOptions = [
  { value: 'json', label: 'JSON', icon: 'data_object' },
  { value: 'yaml', label: 'YAML', icon: 'notes' },
] as const satisfies readonly {
  readonly value: LayoutCreatorCodeFormat
  readonly label: string
  readonly icon: string
}[]

const creatorHintItems = [
  { action: 'Click cells', detail: 'add panes' },
  { action: 'Drag', detail: 'span an area' },
  { action: 'Drag panes', detail: 'move' },
  { action: 'Edges', detail: 'resize pane' },
  { action: 'Outer grips', detail: 'resize tracks' },
  { action: 'Right-click', detail: 'remove pane' },
  { action: 'Esc', detail: 'close' },
] as const

const trackTemplate = (units: readonly number[]): string =>
  units.map((unit) => `minmax(0, ${unit}fr)`).join(' ')

const cellKey = ({ col, row }: GridCell): string => `${col}:${row}`

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'se'

const paneHues = [
  'var(--color-agent-claude-accent)',
  'var(--color-agent-codex-accent)',
  'var(--color-agent-kimi-accent)',
  'var(--color-agent-shell-accent)',
] as const

const hueForSlot = (slotIndex: number): string =>
  paneHues[slotIndex % paneHues.length]

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0)

const trackOffset = (
  tracks: readonly number[],
  start: number,
  span: number
): { readonly offset: number; readonly size: number } => {
  const total = sum(tracks) || 1
  const offset = tracks.slice(0, start).reduce((acc, unit) => acc + unit, 0)

  const size = tracks
    .slice(start, start + span)
    .reduce((acc, unit) => acc + unit, 0)

  return { offset: offset / total, size: size / total }
}

const slotGridStyleFor = (slot: DraftLayoutSlot): CSSProperties => ({
  gridColumn: `${slot.col + 1} / span ${slot.colSpan}`,
  gridRow: `${slot.row + 1} / span ${slot.rowSpan}`,
})

const innerBoundaryPosition = (ratio: number): string =>
  `calc(${ratio * 100}% + ${0.5 - ratio}rem)`

const gridTemplateStyleFor = (draft: DraftPaneLayout): CSSProperties => ({
  gridTemplateColumns: trackTemplate(draft.cols),
  gridTemplateRows: trackTemplate(draft.rows),
})

const outsideGutterButtonBaseClass =
  'absolute z-20 grid place-items-center rounded-full border border-primary/20 bg-surface-container/85 text-primary/70 shadow-[0_8px_24px_color-mix(in_srgb,var(--color-primary)_14%,transparent)] backdrop-blur outline-none transition hover:border-primary/45 hover:bg-primary/10 hover:text-primary focus-visible:ring-1 focus-visible:ring-primary'

const outsideColumnGutterButtonClass = `${outsideGutterButtonBaseClass} h-5 w-8`

const outsideRowGutterButtonClass = `${outsideGutterButtonBaseClass} h-8 w-5`

const paneStyleFor = (
  slot: DraftLayoutSlot,
  slotIndex: number
): CSSProperties => {
  const accent = hueForSlot(slotIndex)

  return {
    ...slotGridStyleFor(slot),
    borderColor: `color-mix(in srgb, ${accent} 50%, transparent)`,
    background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 16%, transparent), color-mix(in srgb, ${accent} 7%, transparent))`,
    boxShadow: `0 10px 28px color-mix(in srgb, ${accent} 14%, transparent)`,
  }
}

const resizeRectFromCell = (
  original: DraftLayoutSlot,
  edge: ResizeEdge,
  cell: GridCell
): DraftLayoutSlot => {
  const right = original.col + original.colSpan - 1
  const bottom = original.row + original.rowSpan - 1
  let nextCol = original.col
  let nextRow = original.row
  let nextColSpan = original.colSpan
  let nextRowSpan = original.rowSpan

  if (edge.includes('e')) {
    const nextRight = Math.max(cell.col, original.col)
    nextColSpan = nextRight - original.col + 1
  }

  if (edge.includes('s')) {
    const nextBottom = Math.max(cell.row, original.row)
    nextRowSpan = nextBottom - original.row + 1
  }

  if (edge.includes('w')) {
    nextCol = Math.min(cell.col, right)
    nextColSpan = right - nextCol + 1
  }

  if (edge.includes('n')) {
    nextRow = Math.min(cell.row, bottom)
    nextRowSpan = bottom - nextRow + 1
  }

  return {
    col: nextCol,
    row: nextRow,
    colSpan: nextColSpan,
    rowSpan: nextRowSpan,
  }
}

const trackIndexFromPosition = (
  positionPx: number,
  totalPx: number,
  tracks: readonly number[]
): number | null => {
  if (totalPx <= 0 || tracks.length === 0) {
    return null
  }

  const boundedRatio = Math.min(Math.max(positionPx / totalPx, 0), 0.999_999)
  const target = boundedRatio * sum(tracks)
  let cursor = 0

  for (let index = 0; index < tracks.length; index += 1) {
    cursor += tracks[index]
    if (target < cursor) {
      return index
    }
  }

  return tracks.length - 1
}

const gridCellFromPointer = (
  event: ReactPointerEvent<HTMLElement> | PointerEvent,
  gridElement: HTMLElement | null,
  draft: DraftPaneLayout
): GridCell | null => {
  const rect = gridElement?.getBoundingClientRect()
  if (rect === undefined) {
    return null
  }

  const col = trackIndexFromPosition(
    event.clientX - rect.left,
    rect.width,
    draft.cols
  )

  const row = trackIndexFromPosition(
    event.clientY - rect.top,
    rect.height,
    draft.rows
  )

  return col === null || row === null ? null : { col, row }
}

const boundaryRatioFromPointer = (
  event: ReactPointerEvent<HTMLElement> | PointerEvent,
  gridElement: HTMLElement | null,
  axis: 'cols' | 'rows'
): number | null => {
  const rect = gridElement?.getBoundingClientRect()
  if (rect === undefined) {
    return null
  }

  const size = axis === 'cols' ? rect.width : rect.height
  if (size <= 0) {
    return null
  }

  const offset =
    axis === 'cols' ? event.clientX - rect.left : event.clientY - rect.top

  return Math.min(Math.max(offset / size, 0), 1)
}

const GridCanvas = ({
  draft,
  onDraftChange,
}: GridCanvasProps): ReactElement => {
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [previewRect, setPreviewRect] = useState<DraftLayoutSlot | null>(null)
  const colCount = draft.cols.length
  const rowCount = draft.rows.length

  const occupied = useMemo(
    () => occupancy(colCount, rowCount, draft.slots),
    [colCount, draft.slots, rowCount]
  )

  const previewValid =
    previewRect === null ||
    rectFree(colCount, rowCount, draft.slots, previewRect, null)

  useEffect(() => {
    if (drag === null) {
      return undefined
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (
        drag.mode === 'gutter' &&
        drag.axis !== undefined &&
        drag.boundaryIndex !== undefined
      ) {
        const boundaryRatio = boundaryRatioFromPointer(
          event,
          gridRef.current,
          drag.axis
        )
        if (boundaryRatio !== null) {
          onDraftChange(
            updateTrackBoundary(
              draft,
              drag.axis,
              drag.boundaryIndex,
              boundaryRatio
            )
          )
        }

        return
      }

      const cell = gridCellFromPointer(event, gridRef.current, draft)
      if (cell === null) {
        return
      }

      if (drag.mode === 'paint') {
        setPreviewRect(rectFromCells(drag.start, cell))

        return
      }

      const originalSlot = drag.originalSlot
      const slotIndex = drag.slotIndex
      if (originalSlot === undefined || slotIndex === undefined) {
        return
      }

      const nextRect =
        drag.mode === 'resize' && drag.edge !== undefined
          ? resizeRectFromCell(originalSlot, drag.edge, cell)
          : {
              ...originalSlot,
              col: cell.col,
              row: cell.row,
            }

      onDraftChange(moveSlot(draft, slotIndex, nextRect))
    }

    const handlePointerUp = (event: PointerEvent): void => {
      const cell = gridCellFromPointer(event, gridRef.current, draft)
      if (drag.mode === 'paint' && cell !== null) {
        onDraftChange(addSlotRect(draft, rectFromCells(drag.start, cell)))
      }

      setDrag(null)
      setPreviewRect(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })

    return (): void => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [draft, drag, onDraftChange])

  const startPaint = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) {
      return
    }

    const cell = gridCellFromPointer(event, gridRef.current, draft)
    if (cell === null) {
      return
    }

    setDrag({ mode: 'paint', start: cell })
    setPreviewRect({ ...cell, colSpan: 1, rowSpan: 1 })
  }

  const startMove = (
    event: ReactPointerEvent<HTMLElement>,
    slotIndex: number
  ): void => {
    if (event.button !== 0) {
      return
    }

    event.stopPropagation()
    const slot = draft.slots[slotIndex]

    setDrag({
      mode: 'move',
      start: { col: slot.col, row: slot.row },
      slotIndex,
      originalSlot: slot,
    })
  }

  const startResize = (
    event: ReactPointerEvent<HTMLElement>,
    slotIndex: number,
    edge: ResizeEdge
  ): void => {
    if (event.button !== 0) {
      return
    }

    event.stopPropagation()
    const slot = draft.slots[slotIndex]

    setDrag({
      mode: 'resize',
      start: { col: slot.col, row: slot.row },
      slotIndex,
      originalSlot: slot,
      edge,
    })
  }

  const startGutter = (
    event: ReactPointerEvent<HTMLElement>,
    axis: 'cols' | 'rows',
    boundaryIndex: number
  ): void => {
    if (event.button !== 0) {
      return
    }

    event.stopPropagation()
    setDrag({
      mode: 'gutter',
      start: { col: 0, row: 0 },
      axis,
      boundaryIndex,
    })
  }

  const remove = (slotIndex: number): void => {
    onDraftChange(removeSlot(draft, slotIndex))
  }

  const preventContextMenu = (event: ReactMouseEvent): void => {
    event.preventDefault()
  }

  return (
    <div className="mx-auto w-full max-w-[760px]">
      <div
        className="relative aspect-[8/5] overflow-visible rounded-[16px] border border-outline-variant/30 bg-surface-container-lowest/70 p-2 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-on-surface)_8%,transparent)]"
        onContextMenu={preventContextMenu}
      >
        <div
          ref={gridRef}
          className="absolute inset-2 grid gap-1.5"
          style={gridTemplateStyleFor(draft)}
        >
          {Array.from({ length: rowCount }).flatMap((_, row) =>
            Array.from({ length: colCount }).map((__, col) => {
              const empty = occupied[row]?.[col] === -1

              return (
                <button
                  key={cellKey({ col, row })}
                  type="button"
                  aria-label={`Add pane at column ${col + 1}, row ${row + 1}`}
                  data-layout-creator-cell={cellKey({ col, row })}
                  tabIndex={empty ? 0 : -1}
                  className={`group relative rounded-lg outline-none transition focus-visible:ring-1 focus-visible:ring-primary/60 ${
                    empty
                      ? 'border border-dashed border-outline-variant/45 bg-surface-container/30 hover:border-primary/45 hover:bg-primary/10'
                      : 'border border-transparent bg-transparent'
                  }`}
                  onPointerDown={empty ? startPaint : undefined}
                >
                  <span
                    className={`pointer-events-none absolute inset-0 items-center justify-center text-primary/80 ${
                      empty ? 'hidden group-hover:flex' : 'hidden'
                    }`}
                  >
                    <span
                      className="material-symbols-outlined rounded-lg border border-primary/30 bg-primary/15 p-1 text-[18px]"
                      aria-hidden="true"
                    >
                      add
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>

        {previewRect !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-2 grid gap-1.5"
            style={gridTemplateStyleFor(draft)}
          >
            <div
              className={`rounded-[11px] border border-dashed ${
                previewValid
                  ? 'border-primary/70 bg-primary/15'
                  : 'border-error bg-error/15'
              }`}
              style={slotGridStyleFor(previewRect)}
            />
          </div>
        )}

        <div
          className="pointer-events-none absolute inset-2 grid gap-1.5"
          style={gridTemplateStyleFor(draft)}
        >
          {draft.slots.map((slot, slotIndex) => (
            <div
              key={`${slot.col}:${slot.row}:${slot.colSpan}:${slot.rowSpan}:${slotIndex}`}
              className="group relative select-none rounded-[12px] border transition-shadow pointer-events-auto"
              style={paneStyleFor(slot, slotIndex)}
              onPointerDown={(event): void => startMove(event, slotIndex)}
              onContextMenu={(event): void => {
                event.preventDefault()
                event.stopPropagation()
                remove(slotIndex)
              }}
            >
              <div className="flex h-full w-full items-center justify-center rounded-[11px] border border-surface/30">
                <span
                  className="font-mono text-[clamp(0.8rem,2vw,1.35rem)] font-semibold"
                  style={{ color: hueForSlot(slotIndex) }}
                >
                  p{slotIndex}
                </span>
              </div>
              {(['n', 's', 'e', 'w', 'se'] as const).map((edge) => (
                <span
                  key={edge}
                  aria-hidden="true"
                  className={`absolute opacity-0 transition-opacity group-hover:opacity-100 ${
                    edge === 'n'
                      ? 'left-3 right-3 top-[-5px] h-2 cursor-n-resize'
                      : edge === 's'
                        ? 'bottom-[-5px] left-3 right-3 h-2 cursor-s-resize'
                        : edge === 'e'
                          ? 'bottom-3 right-[-5px] top-3 w-2 cursor-e-resize'
                          : edge === 'w'
                            ? 'bottom-3 left-[-5px] top-3 w-2 cursor-w-resize'
                            : 'bottom-[-5px] right-[-5px] h-3 w-3 cursor-se-resize rounded-full bg-surface-container/80 ring-1 ring-primary/40'
                  }`}
                  onPointerDown={(event): void =>
                    startResize(event, slotIndex, edge)
                  }
                />
              ))}
              {draft.slots.length > 1 && (
                <span
                  className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                  onPointerDown={(event): void => event.stopPropagation()}
                >
                  <IconButton
                    icon="close"
                    label={`Remove pane p${slotIndex}`}
                    size="sm"
                    className="h-5 w-5 bg-surface-container/85 text-on-surface-muted hover:text-error"
                    onClick={(event): void => {
                      event.stopPropagation()
                      remove(slotIndex)
                    }}
                  />
                </span>
              )}
            </div>
          ))}
        </div>
        {draft.cols.slice(0, -1).map((_, boundaryIndex) => {
          const boundary = trackOffset(draft.cols, 0, boundaryIndex + 1)
          const left = innerBoundaryPosition(boundary.size)

          return (
            <div
              key={`col-gutter-${boundaryIndex}`}
              className="pointer-events-none absolute bottom-[-1.1rem] top-[-1.1rem] z-10 -translate-x-1/2"
              style={{ left }}
            >
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-0 block h-4 w-px -translate-x-1/2 bg-gradient-to-b from-primary/45 to-transparent"
              />
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-1/2 block h-4 w-px -translate-x-1/2 bg-gradient-to-t from-primary/45 to-transparent"
              />
              <button
                type="button"
                aria-label={`Resize column ${boundaryIndex + 1} from top edge`}
                className={`${outsideColumnGutterButtonClass} pointer-events-auto left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-col-resize`}
                onPointerDown={(event): void =>
                  startGutter(event, 'cols', boundaryIndex)
                }
              >
                <span className="block h-2.5 w-0.5 rounded-full bg-current shadow-[0_0_10px_currentColor]" />
              </button>
              <button
                type="button"
                aria-label={`Resize column ${boundaryIndex + 1} from bottom edge`}
                className={`${outsideColumnGutterButtonClass} pointer-events-auto bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-col-resize`}
                onPointerDown={(event): void =>
                  startGutter(event, 'cols', boundaryIndex)
                }
              >
                <span className="block h-2.5 w-0.5 rounded-full bg-current shadow-[0_0_10px_currentColor]" />
              </button>
            </div>
          )
        })}
        {draft.rows.slice(0, -1).map((_, boundaryIndex) => {
          const boundary = trackOffset(draft.rows, 0, boundaryIndex + 1)
          const top = innerBoundaryPosition(boundary.size)

          return (
            <div
              key={`row-gutter-${boundaryIndex}`}
              className="pointer-events-none absolute left-[-1.1rem] right-[-1.1rem] z-10 -translate-y-1/2"
              style={{ top }}
            >
              <span
                aria-hidden="true"
                className="absolute left-0 top-1/2 block h-px w-4 -translate-y-1/2 bg-gradient-to-r from-primary/45 to-transparent"
              />
              <span
                aria-hidden="true"
                className="absolute right-0 top-1/2 block h-px w-4 -translate-y-1/2 bg-gradient-to-l from-primary/45 to-transparent"
              />
              <button
                type="button"
                aria-label={`Resize row ${boundaryIndex + 1} from left edge`}
                className={`${outsideRowGutterButtonClass} pointer-events-auto left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-row-resize`}
                onPointerDown={(event): void =>
                  startGutter(event, 'rows', boundaryIndex)
                }
              >
                <span className="block h-0.5 w-2.5 rounded-full bg-current shadow-[0_0_10px_currentColor]" />
              </button>
              <button
                type="button"
                aria-label={`Resize row ${boundaryIndex + 1} from right edge`}
                className={`${outsideRowGutterButtonClass} pointer-events-auto right-0 top-1/2 -translate-y-1/2 translate-x-1/2 cursor-row-resize`}
                onPointerDown={(event): void =>
                  startGutter(event, 'rows', boundaryIndex)
                }
              >
                <span className="block h-0.5 w-2.5 rounded-full bg-current shadow-[0_0_10px_currentColor]" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface TrackStepperProps {
  label: string
  value: number
  onChange: (next: number) => void
}

const TrackStepper = ({
  label,
  value,
  onChange,
}: TrackStepperProps): ReactElement => (
  <div className="inline-flex items-center gap-2 rounded-full bg-surface-container/50 px-2 py-1 font-mono text-[11px] text-on-surface-variant">
    <span className="uppercase tracking-[0.12em]">{label}</span>
    <IconButton
      icon="remove"
      label={`Remove ${label}`}
      size="sm"
      disabled={value <= 1}
      className="h-5 w-5"
      onClick={(): void => onChange(value - 1)}
    />
    <span className="min-w-5 text-center text-on-surface">{value}</span>
    <IconButton
      icon="add"
      label={`Add ${label}`}
      size="sm"
      disabled={value >= MAX_LAYOUT_TRACKS}
      className="h-5 w-5"
      onClick={(): void => onChange(value + 1)}
    />
  </div>
)

export const LayoutCreatorModal = ({
  isOpen,
  existingLayouts,
  seedLayout = undefined,
  editLayout = undefined,
  onSave,
  onCancel,
}: LayoutCreatorModalProps): ReactElement | null => {
  const titleId = useId()
  const descriptionId = useId()
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [name, setName] = useState('')
  const [draft, setDraft] = useState<DraftPaneLayout>(createSingleDraftLayout)
  const [codeOpen, setCodeOpen] = useState(false)
  const [codeFormat, setCodeFormat] = useState<LayoutCreatorCodeFormat>('json')
  const [codeText, setCodeText] = useState('')
  const [codeDirty, setCodeDirty] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)

  const validation = useMemo(() => validateDraftLayout(draft), [draft])
  const canSave = validation.ok && name.trim().length > 0

  const existingIds = useMemo(
    () => new Set(existingLayouts.map((layout) => layout.id)),
    [existingLayouts]
  )

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const sourceLayout = editLayout ?? seedLayout
    setName(editLayout?.title ?? '')
    setDraft(draftFromDefinition(sourceLayout))
    setCodeOpen(false)
    setCodeFormat('json')
    setCodeDirty(false)
    setCodeError(null)
  }, [editLayout, isOpen, seedLayout])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    nameInputRef.current?.focus()

    return (): void => {
      previousFocusRef.current?.focus()
      previousFocusRef.current = null
    }
  }, [isOpen])

  useEffect(() => {
    if (!codeDirty) {
      setCodeText(serializeDraftLayout(draft, codeFormat))
    }
  }, [codeDirty, codeFormat, draft])

  const updateDraft = useCallback((next: DraftPaneLayout): void => {
    setDraft(next)
    setCodeDirty(false)
    setCodeError(null)
  }, [])

  const handleSave = useCallback((): void => {
    if (!canSave) {
      return
    }

    const existingId =
      editLayout?.id !== undefined
        ? (editLayout.id as CustomPaneLayoutId)
        : undefined

    try {
      onSave(
        definitionFromDraft({
          title: name,
          draft,
          existingIds,
          existingId,
        })
      )
      setCodeError(null)
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : 'Invalid layout')
    }
  }, [canSave, draft, editLayout?.id, existingIds, name, onSave])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCancel()

        return
      }

      if (event.key === 'Enter' && event.metaKey && canSave) {
        event.preventDefault()
        handleSave()

        return
      }

      if (event.key !== 'Tab' || !panelRef.current) {
        return
      }

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(
        (element) =>
          element.offsetParent !== null &&
          element.getAttribute('aria-hidden') !== 'true'
      )

      if (focusable.length === 0) {
        return
      }

      const currentIndex = focusable.indexOf(
        document.activeElement as HTMLElement
      )
      const delta = event.shiftKey ? -1 : 1
      let nextIndex: number

      if (currentIndex === -1) {
        nextIndex = event.shiftKey ? focusable.length - 1 : 0
      } else {
        nextIndex = (currentIndex + delta + focusable.length) % focusable.length
      }

      event.preventDefault()
      focusable[nextIndex]?.focus()
    }

    document.addEventListener('keydown', handleKeyDown)

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [canSave, handleSave, isOpen, onCancel])

  const applyCode = (): void => {
    try {
      const parsedDraft = parseDraftLayoutText(codeText, codeFormat)
      setDraft(parsedDraft)
      setCodeDirty(false)
      setCodeError(null)
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : 'Invalid layout')
    }
  }

  const copyCode = (): void => {
    try {
      void navigator.clipboard.writeText(codeText)
    } catch {
      // Clipboard is unavailable in some test/webview contexts; copying is optional.
    }
  }

  const stopPropagation = (event: ReactMouseEvent): void => {
    event.stopPropagation()
  }

  if (!isOpen) {
    return null
  }

  const title = editLayout === undefined ? 'Layout Creator' : 'Edit layout'
  const saveLabel = editLayout === undefined ? 'Save & apply' : 'Save changes'

  const validationMessage = validation.ok
    ? `Valid · ${validation.slotCount} panes, fully tiled`
    : validation.trackOverCapacity
      ? `Too many tracks · ${draft.cols.length}×${draft.rows.length} exceeds ${MAX_LAYOUT_TRACKS}×${MAX_LAYOUT_TRACKS}`
      : validation.overCapacity
        ? `Too many panes · ${validation.slotCount}/${validation.maxSlots} max`
        : validation.overlap
          ? 'Panes overlap'
          : `${validation.emptyCells} empty cells · fill or remove gaps`

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-workspace-overlay-id="layout-creator"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-surface-container-lowest/60 p-7 backdrop-blur-[14px]"
      onMouseDown={onCancel}
    >
      <div
        ref={panelRef}
        className="flex max-h-[92vh] w-full max-w-[960px] flex-col overflow-hidden rounded-2xl border border-primary/25 bg-surface-container/95 shadow-[0_30px_80px_color-mix(in_srgb,var(--color-scrim)_60%,transparent)]"
        onMouseDown={stopPropagation}
      >
        <div className="flex items-center gap-3 border-b border-outline-variant/25 px-5 py-3.5">
          <span
            className="material-symbols-outlined text-[20px] text-primary"
            aria-hidden="true"
          >
            dashboard_customize
          </span>
          <h2
            id={titleId}
            className="font-label text-sm font-semibold text-on-surface"
          >
            {title}
          </h2>
          <span aria-hidden="true" className="h-5 w-px bg-outline-variant/40" />
          <input
            ref={nameInputRef}
            value={name}
            aria-label="Layout name"
            className="min-w-0 flex-1 rounded-lg border border-outline-variant/35 bg-surface-container-lowest/70 px-3 py-2 text-sm text-on-surface outline-none transition focus:border-primary/60"
            onChange={(event): void => setName(event.target.value)}
            onKeyDown={(event): void => {
              if (event.key === 'Enter' && canSave) {
                handleSave()
              }
            }}
          />
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            leadingIcon="check"
            disabled={!canSave}
            onClick={handleSave}
          >
            {saveLabel}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-3 py-3">
          <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto overflow-x-hidden rounded-xl px-2 py-1 pr-3 [scrollbar-gutter:stable] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-outline-variant/35 [&::-webkit-scrollbar-thumb]:bg-clip-padding">
            <p id={descriptionId} className="sr-only">
              Compose a terminal pane layout from tracks and pane slots.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                leadingIcon="add_box"
                disabled={draft.slots.length >= validation.maxSlots}
                onClick={(): void => updateDraft(addFirstFreeSlot(draft))}
              >
                Add pane
              </Button>
              <TrackStepper
                label="Cols"
                value={draft.cols.length}
                onChange={(next): void =>
                  updateDraft(setTrackCount(draft, 'cols', next))
                }
              />
              <TrackStepper
                label="Rows"
                value={draft.rows.length}
                onChange={(next): void =>
                  updateDraft(setTrackCount(draft, 'rows', next))
                }
              />
              <Button
                variant="ghost"
                size="sm"
                leadingIcon="restart_alt"
                onClick={(): void => updateDraft(createSingleDraftLayout())}
              >
                Reset
              </Button>
              <span className="ml-auto font-mono text-[11px] text-on-surface-muted">
                {LAYOUT_CREATOR_UNIT_TOTAL}-unit tracks
              </span>
            </div>

            <GridCanvas draft={draft} onDraftChange={updateDraft} />

            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-container-lowest/55 px-3 py-2 font-mono text-[11px]">
              <span
                className={`material-symbols-outlined text-[16px] ${
                  validation.ok ? 'text-success' : 'text-error'
                }`}
                aria-hidden="true"
              >
                {validation.ok ? 'check_circle' : 'error'}
              </span>
              <span className={validation.ok ? 'text-success' : 'text-error'}>
                {validationMessage}
              </span>
              <span className="text-on-surface-muted">
                {formatDraftMeta(draft)}
              </span>
            </div>

            <div className="border-t border-outline-variant/20 pt-3">
              <Button
                variant="ghost"
                size="sm"
                leadingIcon="data_object"
                onClick={(): void => setCodeOpen((open) => !open)}
              >
                Code · JSON/YAML
              </Button>
            </div>

            {codeOpen && (
              <div className="rounded-xl border border-outline-variant/25 bg-surface-container-lowest/60 p-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-outline-variant/20 bg-surface-container/70 p-1 pl-2 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-on-surface)_8%,transparent)]">
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-[15px] text-primary/75"
                    >
                      data_object
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-on-surface-muted">
                      Format
                    </span>
                    <SegmentedControl
                      aria-label="Code format"
                      variant="toolbar"
                      className="rounded-full bg-surface-container-lowest/65 p-0.5"
                      value={codeFormat}
                      options={codeFormatOptions}
                      buttonClassName="h-6 w-auto min-w-[58px] gap-1.5 rounded-full px-2.5 font-mono text-[10px] uppercase tracking-[0.08em]"
                      iconClassName="material-symbols-outlined text-[13px]"
                      onChange={(next): void => {
                        setCodeFormat(next)
                        setCodeDirty(false)
                        setCodeError(null)
                      }}
                    />
                  </div>
                  <span className="flex-1" />
                  <Button variant="ghost" size="sm" onClick={copyCode}>
                    Copy
                  </Button>
                  <Button variant="primary" size="sm" onClick={applyCode}>
                    Apply
                  </Button>
                </div>
                <textarea
                  value={codeText}
                  className="min-h-[180px] w-full resize-y rounded-lg border border-outline-variant/30 bg-surface-container/65 p-3 font-mono text-[11px] leading-relaxed text-on-surface outline-none focus:border-primary/60"
                  onChange={(event): void => {
                    setCodeText(event.target.value)
                    setCodeDirty(true)
                    setCodeError(null)
                  }}
                />
                {codeError !== null && (
                  <p className="mt-2 font-mono text-[11px] text-error">
                    {codeError}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-outline-variant/20 bg-surface-container-lowest/35 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-outline-variant/18 bg-surface-container/45 p-1.5 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-on-surface)_7%,transparent)]">
            {creatorHintItems.map((item) => (
              <span
                key={item.action}
                className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container-lowest/55 px-2 py-1 font-mono text-[10px] text-on-surface-muted"
              >
                <span className="font-semibold text-on-surface-variant">
                  {item.action}
                </span>
                <span>{item.detail}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
