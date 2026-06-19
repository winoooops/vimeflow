import type { Pane, PaneLayoutId, Session } from '../types'
import {
  BUILTIN_PANE_LAYOUT_REGISTRY,
  autoShrinkLayoutFor,
  type PaneLayoutRegistry,
} from '../../terminal/layout-registry/layoutRegistry'
import { deriveShellSessionStatus } from './sessionStatus'
import { isShellPane } from './paneKind'
import { normalizePanePlacements } from './panePlacements'

export { autoShrinkLayoutFor } from '../../terminal/layout-registry/layoutRegistry'

export interface ApplyAddPaneResult {
  sessions: Session[]
  appended: boolean
}

export interface ApplyRemovePaneResult {
  sessions: Session[]
  removedPtyId?: string
  newActivePtyId?: string
}

export const pickNextActivePaneId = (
  panes: readonly Pane[],
  closedIdx: number
): string | null => {
  if (closedIdx > 0) {
    return panes[closedIdx - 1].id
  }

  if (closedIdx + 1 < panes.length) {
    return panes[closedIdx + 1].id
  }

  return null
}

export const nextFreePaneId = (panes: readonly Pane[]): string => {
  const ids = new Set(panes.map((pane) => pane.id))
  let index = 0

  while (ids.has(`p${index}`)) {
    index += 1
  }

  return `p${index}`
}

export const applyAddPane = (
  sessions: Session[],
  sessionId: string,
  newPane: Pane,
  capacity: number
): ApplyAddPaneResult => {
  const sessionIndex = sessions.findIndex((session) => session.id === sessionId)
  if (sessionIndex === -1) {
    return { sessions, appended: false }
  }

  const session = sessions[sessionIndex]
  if (session.panes.length >= capacity) {
    return { sessions, appended: false }
  }

  if (session.panes.some((pane) => pane.id === newPane.id)) {
    return { sessions, appended: false }
  }

  const panes: Pane[] = [
    ...session.panes.map((pane) =>
      pane.active ? { ...pane, active: false } : pane
    ),
    { ...newPane, active: true },
  ]

  const updated: Session = {
    ...session,
    panes,
    status: deriveShellSessionStatus(panes),
    agentType: newPane.agentType,
  }

  return {
    sessions: [
      ...sessions.slice(0, sessionIndex),
      updated,
      ...sessions.slice(sessionIndex + 1),
    ],
    appended: true,
  }
}

export const applyRemovePane = (
  sessions: Session[],
  sessionId: string,
  paneId: string,
  currentLayoutId: PaneLayoutId,
  layoutRegistry: PaneLayoutRegistry = BUILTIN_PANE_LAYOUT_REGISTRY
): ApplyRemovePaneResult => {
  const sessionIndex = sessions.findIndex((session) => session.id === sessionId)
  if (sessionIndex === -1) {
    return { sessions }
  }

  const session = sessions[sessionIndex]
  const closedIndex = session.panes.findIndex((pane) => pane.id === paneId)
  if (closedIndex === -1 || session.panes.length <= 1) {
    return { sessions }
  }

  const closedPane = session.panes[closedIndex]

  const remaining = [
    ...session.panes.slice(0, closedIndex),
    ...session.panes.slice(closedIndex + 1),
  ]

  let panes = remaining
  let newActivePtyId: string | undefined

  if (closedPane.active) {
    const nextActiveId = pickNextActivePaneId(session.panes, closedIndex)
    panes = remaining.map((pane) =>
      pane.id === nextActiveId ? { ...pane, active: true } : pane
    )
    const activePane = panes.find((pane) => pane.active)
    newActivePtyId =
      activePane && isShellPane(activePane) ? activePane.ptyId : undefined
  }

  const activePane = panes.find((pane) => pane.active)

  const layout = autoShrinkLayoutFor(
    panes.length,
    currentLayoutId,
    layoutRegistry
  )

  const updated: Session = {
    ...session,
    panes,
    layout,
    placements: normalizePanePlacements(
      panes,
      layoutRegistry.getFallbackLayout(layout),
      session.placements?.filter((placement) => placement.paneId !== paneId)
    ),
    status: deriveShellSessionStatus(panes),
    agentType: activePane?.agentType ?? session.agentType,
  }

  return {
    sessions: [
      ...sessions.slice(0, sessionIndex),
      updated,
      ...sessions.slice(sessionIndex + 1),
    ],
    removedPtyId: isShellPane(closedPane) ? closedPane.ptyId : undefined,
    newActivePtyId,
  }
}
