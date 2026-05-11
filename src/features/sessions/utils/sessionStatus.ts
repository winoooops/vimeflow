import type { Pane, SessionStatus } from '../types'

/** Aggregate a session's status from its panes. */
export const deriveSessionStatus = (panes: Pane[]): SessionStatus => {
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
