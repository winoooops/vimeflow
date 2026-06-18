import type { Session } from '../types'
import { isOpenSession } from './sessionStatus'

/**
 * Returns the sessions visible in the SessionTabs strip — sessions with a
 * open pane plus the currently active one (so a just-exited active session
 * keeps its tab even after status flips to completed/errored). Open state is
 * pane-level liveness plus restore-time lazy placeholders, not the
 * errored-dominant aggregate status. Single source of truth for "open" semantics; both
 * `SessionTabs` and `pickNextVisibleSessionId` consume it so the visible-set
 * definition can never drift between render and close-fallback navigation.
 */
export const getVisibleSessions = (
  sessions: Session[],
  activeSessionId: string | null
): Session[] =>
  sessions.filter((s) => isOpenSession(s) || s.id === activeSessionId)

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
