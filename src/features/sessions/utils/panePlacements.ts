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
