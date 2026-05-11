import type { Pane, SessionStatus } from '../types'

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
