import type { Pane, Session } from '../types'

/** Non-throwing variant — returns `undefined` when the session has zero
 *  panes or anything other than exactly one active pane. Use this in
 *  render bodies and effect callbacks where a transient invariant
 *  violation must not crash the React tree.
 *
 *  See `getActivePane` below for the throwing variant used at
 *  mutation-site guards (createSession / restartSession / removeSession /
 *  updatePaneCwd / updatePaneAgentType) where invariant violations
 *  represent a programmer bug to surface immediately. */
export const findActivePane = (session: Session): Pane | undefined => {
  const actives = session.panes.filter((p) => p.active)

  return actives.length === 1 ? actives[0] : undefined
}

/** Return the active pane in a session. Throws on invariant violations.
 *  Reserved for mutation-site guards only. Render + effect call sites
 *  should use `findActivePane` so a transient violation does not crash
 *  the component tree. */
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

/** Flip the active pane inside one session and re-derive materialized
 * session fields from the new active pane.
 *
 * Pure helper — no side effects. No-op branches (missing session,
 * missing pane, already-active target) return the same `sessions`
 * array reference so callers can drop this directly into a React
 * state updater without forcing a re-render. The manager surfaces
 * any operator-visible warnings BEFORE invoking this function so
 * `setSessions(prev => applyActivePane(prev, …))` stays pure under
 * StrictMode's double-invocation contract.
 */
export const applyActivePane = (
  sessions: Session[],
  sessionId: string,
  paneId: string
): Session[] => {
  const sessionIndex = sessions.findIndex((session) => session.id === sessionId)
  if (sessionIndex === -1) {
    return sessions
  }

  const session = sessions[sessionIndex]
  const target = session.panes.find((pane) => pane.id === paneId)
  if (!target) {
    return sessions
  }

  if (target.active) {
    return sessions
  }

  // Preserve object identity for panes whose `active` flag does not
  // change so a future `React.memo(TerminalPane)` (or any prop-
  // equality optimization) doesn't see false-positive churn from
  // the bulk active-flag reset across all panes in the session.
  const panes = session.panes.map((pane) => {
    const shouldBeActive = pane.id === paneId

    return pane.active === shouldBeActive
      ? pane
      : { ...pane, active: shouldBeActive }
  })

  const updatedSession: Session = {
    ...session,
    panes,
    workingDirectory: target.cwd,
    agentType: target.agentType,
  }

  return [
    ...sessions.slice(0, sessionIndex),
    updatedSession,
    ...sessions.slice(sessionIndex + 1),
  ]
}
