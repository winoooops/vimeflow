import type { Pane, Session } from '../types'

/** Return the active pane in a session. Throws on invariant violations. */
export const getActivePane = (session: Session): Pane => {
  if (session.panes.length === 0) {
    throw new Error(
      `getActivePane: session ${session.id} has at least one pane invariant violated (panes.length === 0)`
    )
  }

  const actives = session.panes.filter((p) => p.active)
  if (actives.length !== 1) {
    throw new Error(
      `getActivePane: session ${session.id} must have exactly one active pane (found ${actives.length})`
    )
  }

  return actives[0]
}
