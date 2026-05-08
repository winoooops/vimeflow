import type { Session, SessionStatus } from '../../sessions/types'

const OPEN_STATUSES: ReadonlySet<SessionStatus> = new Set(['running', 'paused'])

export const isOpenSessionStatus = (status: SessionStatus): boolean =>
  OPEN_STATUSES.has(status)

/**
 * Returns the sessions visible in the SessionTabs strip — running or
 * paused sessions plus the currently active one (so a just-exited
 * active session keeps its tab even after status flips to
 * completed/errored). This is the single source of truth for "open"
 * semantics; both `SessionTabs` and `pickNextVisibleSessionId`
 * consume it so the visible-set definition can never drift between
 * the strip's render and the close-fallback navigation.
 */
export const getVisibleSessions = (
  sessions: Session[],
  activeSessionId: string | null
): Session[] =>
  sessions.filter(
    (s) => isOpenSessionStatus(s.status) || s.id === activeSessionId
  )

/**
 * Pick the next visible session id when the user removes the currently
 * active session. The next id is the visually adjacent tab to the right
 * (wrapping left when the removed session is last). Returns
 * `undefined` when there is no other visible session — caller should
 * fall back to whatever the session manager picks.
 */
export const pickNextVisibleSessionId = (
  sessions: Session[],
  removedId: string,
  activeSessionId: string | null
): string | undefined => {
  const visible = getVisibleSessions(sessions, activeSessionId)
  if (visible.length <= 1) {
    return undefined
  }
  const ids = visible.map((s) => s.id)
  const idx = ids.indexOf(removedId)
  if (idx === -1) {
    return undefined
  }

  return idx === ids.length - 1 ? ids[idx - 1] : ids[idx + 1]
}
