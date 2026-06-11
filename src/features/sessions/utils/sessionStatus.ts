import type { Pane, SessionStatus } from '../types'
import { isBrowserPane, isShellPane } from './paneKind'

// precedence high → low; exhaustive Record — a new SessionStatus must be ranked
const STATUS_PRECEDENCE: Record<SessionStatus, number> = {
  errored: 0,
  awaiting: 1,
  running: 2,
  idle: 3,
  completed: 4,
}

// terminal = exited; exhaustive Record so a new status must classify itself
const TERMINAL: Record<SessionStatus, boolean> = {
  running: false,
  awaiting: false,
  idle: false,
  completed: true,
  errored: true,
}

export const isTerminalStatus = (s: SessionStatus): boolean => TERMINAL[s]

export const isLiveStatus = (s: SessionStatus): boolean => !TERMINAL[s]

// Pane-level liveness for visibility/guards: the aggregate status is
// errored-dominant (display), so check panes, not the rolled-up status.
export const hasLivePane = (panes: Pane[]): boolean =>
  panes.some((pane) => isLiveStatus(pane.status))

export const deriveSessionStatus = (panes: Pane[]): SessionStatus => {
  // empty panes is an invariant violation; flag it errored, not vacuously completed
  if (panes.length === 0) {
    return 'errored'
  }

  return panes.reduce<SessionStatus>(
    (top, pane) =>
      STATUS_PRECEDENCE[pane.status] < STATUS_PRECEDENCE[top]
        ? pane.status
        : top,
    'completed'
  )
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
