import type { Pane, SessionStatus } from '../types'
import { isBrowserPane, isShellPane } from './paneKind'

/** Aggregate a session's status from its panes.
 *
 *  Empty `panes[]` is a hard invariant violation (every Session must
 *  carry ≥1 pane per the 5a model — see `getActivePane`'s contract).
 *  Returning 'completed' for [] would be vacuously true via
 *  `Array.every` and would silently mask a corrupt session as done.
 *  Return 'errored' so the surface flags the problem instead of
 *  showing a misleading "Restart" affordance for an inert session. */
export const deriveSessionStatus = (panes: Pane[]): SessionStatus => {
  if (panes.length === 0) {
    return 'errored'
  }
  if (panes.some((p) => p.status === 'running')) {
    return 'running'
  }
  if (panes.some((p) => p.status === 'errored')) {
    return 'errored'
  }
  if (panes.every((p) => p.status === 'completed')) {
    return 'completed'
  }

  return 'paused'
}

export const deriveShellSessionStatus = (panes: Pane[]): SessionStatus => {
  // A live browser pane keeps the session 'running' even when its shells are
  // all completed placeholders (a graceful-quit restore). Deriving from shells
  // alone would wrongly read 'completed' and show a Restart affordance for a
  // session whose browser is still live (spec §5 "Restored session status").
  if (panes.some((pane) => isBrowserPane(pane) && pane.status === 'running')) {
    return 'running'
  }

  const shellPanes = panes.filter(isShellPane)

  // No live browser: derive from the shells. With no shells either (an inert
  // browser-only set) fall back to the full pane set so the empty-slice
  // 'errored' guard doesn't misfire.
  return deriveSessionStatus(shellPanes.length > 0 ? shellPanes : panes)
}
