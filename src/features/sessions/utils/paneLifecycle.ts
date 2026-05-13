import type { LayoutId, Pane, Session } from '../types'
import { deriveSessionStatus } from './sessionStatus'

export interface ApplyAddPaneResult {
  sessions: Session[]
  appended: boolean
}

export interface ApplyRemovePaneResult {
  sessions: Session[]
  removedPtyId?: string
  newActivePtyId?: string
}

export const autoShrinkLayoutFor = (
  nextPaneCount: number,
  currentLayoutId: LayoutId
): LayoutId => {
  if (nextPaneCount <= 1) {
    return 'single'
  }

  if (nextPaneCount === 2) {
    return currentLayoutId === 'hsplit' ? 'hsplit' : 'vsplit'
  }

  if (nextPaneCount === 3) {
    return 'threeRight'
  }

  return currentLayoutId
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
    status: deriveSessionStatus(panes),
    workingDirectory: newPane.cwd,
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
  currentLayoutId: LayoutId
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
    newActivePtyId = panes.find((pane) => pane.active)?.ptyId
  }

  const activePane = panes.find((pane) => pane.active)

  const updated: Session = {
    ...session,
    panes,
    layout: autoShrinkLayoutFor(panes.length, currentLayoutId),
    status: deriveSessionStatus(panes),
    workingDirectory: activePane?.cwd ?? session.workingDirectory,
    agentType: activePane?.agentType ?? session.agentType,
  }

  return {
    sessions: [
      ...sessions.slice(0, sessionIndex),
      updated,
      ...sessions.slice(sessionIndex + 1),
    ],
    removedPtyId: closedPane.ptyId,
    newActivePtyId,
  }
}
