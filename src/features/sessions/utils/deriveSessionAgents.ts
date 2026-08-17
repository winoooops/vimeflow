import type { Agent } from '../../../agents/registry'
import type { Pane, Session, SessionStatus } from '../types'
import { agentForPane } from './agentForSession'
import { isShellPane } from './paneKind'

export interface SessionAgentEntry {
  paneId: string
  ptyId: string
  agent: Agent
  status: SessionStatus
  label: string
}

const cwdBasename = (cwd: string): string => {
  const parts = cwd.split('/').filter(Boolean)

  return parts[parts.length - 1] ?? cwd
}

// Pane-header precedence (userLabel ?? agentTitle), then a friendly cwd
// descriptor instead of a bare pane id.
const paneLabel = (pane: Pane): string =>
  pane.userLabel ?? pane.agentTitle ?? `working on ${cwdBasename(pane.cwd)}`

// status 'running' only means the PTY is alive — restore/spawn paths hardcode
// it and a stale agent never emits a corrective lifecycle event. The row only
// claims "running" on the watcher's word (agentPhase); live OSC progress can
// re-upgrade the idle result in AgentRow.
const rowStatus = (pane: Pane): SessionStatus =>
  pane.status === 'running' && pane.agentPhase !== 'running'
    ? 'idle'
    : pane.status

/**
 * Coding-agent panes of a session, in pane order. Plain shells (generic,
 * aider — both registry-mapped to 'shell') and browser panes are excluded:
 * the sidebar rows are an agent status surface, not a pane manifest.
 */
export const deriveSessionAgents = (
  session: Pick<Session, 'panes'>
): SessionAgentEntry[] =>
  session.panes
    .filter(isShellPane)
    .map((pane) => ({ pane, agent: agentForPane(pane) }))
    .filter(({ agent }) => agent.id !== 'shell')
    .map(({ pane, agent }) => ({
      paneId: pane.id,
      ptyId: pane.ptyId,
      agent,
      status: rowStatus(pane),
      label: paneLabel(pane),
    }))
