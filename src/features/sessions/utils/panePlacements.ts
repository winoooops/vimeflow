import type { LayoutShape } from '../../terminal/layout-registry'
import type { LayoutSlotId, Pane, PanePlacement } from '../types'

export interface PaneSlotAssignment {
  readonly pane: Pane
  readonly slotId: LayoutSlotId
}

export interface PanePlacementResolution {
  readonly assignments: readonly PaneSlotAssignment[]
  readonly placements: readonly PanePlacement[]
  readonly emptySlotIds: readonly LayoutSlotId[]
}

const uniquePaneIds = (panes: readonly Pane[]): ReadonlySet<string> =>
  new Set(panes.map((pane) => pane.id))

const validLayoutSlotIds = (layout: LayoutShape): ReadonlySet<LayoutSlotId> =>
  new Set(layout.definition.addOrder)

export const normalizePanePlacements = (
  panes: readonly Pane[],
  layout: LayoutShape,
  placements: readonly PanePlacement[] | undefined
): PanePlacement[] => {
  const paneIds = uniquePaneIds(panes)
  const slotIds = validLayoutSlotIds(layout)
  const usedPaneIds = new Set<string>()
  const usedSlotIds = new Set<LayoutSlotId>()
  const normalized: PanePlacement[] = []

  for (const placement of placements ?? []) {
    if (
      !paneIds.has(placement.paneId) ||
      !slotIds.has(placement.slotId) ||
      usedPaneIds.has(placement.paneId) ||
      usedSlotIds.has(placement.slotId)
    ) {
      continue
    }

    usedPaneIds.add(placement.paneId)
    usedSlotIds.add(placement.slotId)
    normalized.push({
      paneId: placement.paneId,
      slotId: placement.slotId,
    })
  }

  const availableSlotIds = layout.definition.addOrder.filter(
    (slotId) => !usedSlotIds.has(slotId)
  )

  for (const pane of panes) {
    if (usedPaneIds.has(pane.id)) {
      continue
    }

    const slotId = availableSlotIds.shift()
    if (!slotId) {
      break
    }

    usedPaneIds.add(pane.id)
    usedSlotIds.add(slotId)
    normalized.push({ paneId: pane.id, slotId })
  }

  return normalized
}

/**
 * Swap the slot assignments of two visible panes (VIM-167 drag-into-slot).
 *
 * Returns a fully-explicit, normalized `PanePlacement[]` capturing the slot of
 * EVERY visible pane — not just the two swapped — so the result is stable
 * regardless of `layout.definition.addOrder`. A later add/remove that shifts
 * addOrder can no longer silently re-order the panes the user has arranged.
 *
 * No-op (returns the normalized current placements) when either id is unknown
 * or both ids are equal. Slot-accepts gating is the caller's responsibility;
 * this helper is a pure rearrangement.
 */
export const swapPanePlacements = (
  panes: readonly Pane[],
  layout: LayoutShape,
  placements: readonly PanePlacement[] | undefined,
  paneIdA: string,
  paneIdB: string
): PanePlacement[] => {
  const normalized = normalizePanePlacements(panes, layout, placements)
  if (paneIdA === paneIdB) {
    return normalized
  }

  const slotA = normalized.find(
    (placement) => placement.paneId === paneIdA
  )?.slotId

  const slotB = normalized.find(
    (placement) => placement.paneId === paneIdB
  )?.slotId
  if (slotA === undefined || slotB === undefined) {
    return normalized
  }

  return normalized.map((placement) => {
    if (placement.paneId === paneIdA) {
      return { paneId: paneIdA, slotId: slotB }
    }

    if (placement.paneId === paneIdB) {
      return { paneId: paneIdB, slotId: slotA }
    }

    return placement
  })
}

/**
 * Move a visible pane to a target slot (VIM-167 drag-into-slot).
 *
 * - Empty target slot: the pane moves there and its previous slot becomes
 *   empty.
 * - Occupied target slot: the pane and the occupant swap (delegates to
 *   {@link swapPanePlacements}), so a drop on another pane is order-stable.
 *
 * Like the swap helper, the result captures explicit placements for every
 * visible pane. No-op (normalized current placements) when the pane id is
 * unknown or the target slot is not part of the layout. Accepts gating is the
 * caller's responsibility.
 */
export const movePaneToSlot = (
  panes: readonly Pane[],
  layout: LayoutShape,
  placements: readonly PanePlacement[] | undefined,
  paneId: string,
  targetSlotId: LayoutSlotId
): PanePlacement[] => {
  const normalized = normalizePanePlacements(panes, layout, placements)

  if (!layout.definition.addOrder.includes(targetSlotId)) {
    return normalized
  }

  const current = normalized.find((placement) => placement.paneId === paneId)
  if (!current) {
    return normalized
  }

  if (current.slotId === targetSlotId) {
    return normalized
  }

  const occupant = normalized.find(
    (placement) => placement.slotId === targetSlotId
  )
  if (occupant) {
    return swapPanePlacements(
      panes,
      layout,
      normalized,
      paneId,
      occupant.paneId
    )
  }

  return normalized.map((placement) =>
    placement.paneId === paneId ? { paneId, slotId: targetSlotId } : placement
  )
}

export const resolvePanePlacement = (
  panes: readonly Pane[],
  layout: LayoutShape,
  placements: readonly PanePlacement[] | undefined
): PanePlacementResolution => {
  const normalized = normalizePanePlacements(panes, layout, placements)

  const slotByPaneId = new Map(
    normalized.map((placement) => [placement.paneId, placement.slotId])
  )

  const occupiedSlotIds = new Set(
    normalized.map((placement) => placement.slotId)
  )

  return {
    assignments: panes.flatMap((pane) => {
      const slotId = slotByPaneId.get(pane.id)

      return slotId ? [{ pane, slotId }] : []
    }),
    placements: normalized,
    emptySlotIds: layout.definition.addOrder.filter(
      (slotId) => !occupiedSlotIds.has(slotId)
    ),
  }
}
