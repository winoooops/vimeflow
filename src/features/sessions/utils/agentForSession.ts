import { AGENTS, type Agent, type AgentId } from '../../../agents/registry'
import type { Pane, Session } from '../types'

const AGENT_BY_SESSION_TYPE: Record<Session['agentType'], AgentId> = {
  'claude-code': 'claude',
  codex: 'codex',
  kimi: 'kimi',
  opencode: 'opencode',
  aider: 'shell',
  generic: 'shell',
}

export const agentForSession = (session: Session): Agent =>
  AGENTS[AGENT_BY_SESSION_TYPE[session.agentType]]

export const agentForPane = (pane: Pane): Agent =>
  AGENTS[AGENT_BY_SESSION_TYPE[pane.agentType]]
