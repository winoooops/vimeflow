import type { Session, SessionStatus } from '../types'

const OPEN_STATUSES: ReadonlySet<SessionStatus> = new Set(['running', 'paused'])

export const isOpenSessionStatus = (status: SessionStatus): boolean =>
  OPEN_STATUSES.has(status)

/**
 * Pick the next visible session id when the user removes the currently
 * active session. Mirrors the SessionTabs `open` semantics — the strip
 * keeps the active session visible even after its PTY exits, so the
 * candidate list is `running/paused ∪ {activeSessionId}`. The next id
 * is the visually adjacent tab to the right (wrapping left when the
 * removed session is last). Returns `undefined` when there is no other
 * visible session — caller should fall back to whatever the session
 * manager picks.
 */
export const pickNextVisibleSessionId = (
  sessions: Session[],
  removedId: string,
  activeSessionId: string | null
): string | undefined => {
  const visible = sessions.filter(
    (s) => isOpenSessionStatus(s.status) || s.id === activeSessionId
  )
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
