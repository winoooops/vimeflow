import type { Session, SessionCloseResult } from '../types'
import { pickNextVisibleSessionId } from './pickNextVisibleSessionId'

export interface CloseSessionDeps {
  sessions: Session[]
  activeSessionId: string | null
  removeSession: (id: string) => SessionCloseResult
  activateSession: (id: string) => void
  focusSuccessor?: (id: string) => void
}

// Successor is computed before removal; the guard's `false` sentinel cancels activation and focus.
export const closeSessionWithSuccessor = (
  sessionId: string,
  {
    sessions,
    activeSessionId,
    removeSession,
    activateSession,
    focusSuccessor,
  }: CloseSessionDeps
): void => {
  const nextId =
    sessionId === activeSessionId
      ? pickNextVisibleSessionId(sessions, sessionId, activeSessionId)
      : undefined

  const didRemove = removeSession(sessionId)
  if (didRemove === false) {
    return
  }

  if (nextId !== undefined) {
    activateSession(nextId)
    focusSuccessor?.(nextId)
  }
}
