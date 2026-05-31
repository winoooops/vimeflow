import type { Session, SessionStatus } from '../types'
import { isBrowserPane } from './paneKind'

const OPEN_STATUSES: ReadonlySet<SessionStatus> = new Set(['running', 'paused'])

export const isOpenSessionStatus = (status: SessionStatus): boolean =>
  OPEN_STATUSES.has(status)

/**
 * A session is reachable while any browser pane is still running, even if its
 * shells have exited. Session `status` is deliberately shell-driven (so an
 * always-on browser pane can't mask agent completion / the Restart affordance —
 * see `deriveShellSessionStatus`), which means a session with a live browser
 * pane but no live shell reads as `completed`. Visibility must not follow that:
 * dropping its tab would orphan a live native view with no way back to it.
 */
const hasLiveBrowserPane = (session: Session): boolean =>
  session.panes.some((pane) => isBrowserPane(pane) && pane.status === 'running')

/**
 * Whether a single session is visible in the SessionTabs strip — running or
 * paused, has a live browser pane, or is the currently active one (so a
 * just-exited active session keeps its tab even after status flips to
 * completed/errored).
 *
 * This is the single source of truth for "is this session's tab visible".
 * Every visibility surface MUST consume it — `getVisibleSessions` (the strip +
 * close-fallback navigation) and `TerminalZone` (the tabpanel-to-tab aria
 * linkage) — so the tab and its panel can never disagree about whether the tab
 * exists.
 */
export const isSessionVisible = (
  session: Session,
  activeSessionId: string | null
): boolean =>
  isOpenSessionStatus(session.status) ||
  hasLiveBrowserPane(session) ||
  session.id === activeSessionId

/**
 * Returns the sessions visible in the SessionTabs strip. Thin wrapper over
 * `isSessionVisible` so the strip and `pickNextVisibleSessionId` share one
 * predicate.
 */
export const getVisibleSessions = (
  sessions: Session[],
  activeSessionId: string | null
): Session[] => sessions.filter((s) => isSessionVisible(s, activeSessionId))

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
