import type { AgentStatus } from '../types'

const AGENT_TYPE_MAP = {
  claudeCode: 'claude-code',
  codex: 'codex',
  aider: 'aider',
  generic: 'generic',
} as const

const isKnownAgentType = (
  value: string
): value is keyof typeof AGENT_TYPE_MAP =>
  Object.prototype.hasOwnProperty.call(AGENT_TYPE_MAP, value)

export const mapDetectedAgentType = (
  value: string
): NonNullable<AgentStatus['agentType']> =>
  isKnownAgentType(value) ? AGENT_TYPE_MAP[value] : 'generic'

export const createDefaultAgentStatus = (
  sessionId: string | null
): AgentStatus => ({
  isActive: false,
  agentExited: false,
  agentType: null,
  modelId: null,
  modelDisplayName: null,
  version: null,
  sessionId,
  agentSessionId: null,
  cwd: null,
  contextWindow: null,
  cost: null,
  rateLimits: null,
  numTurns: 0,
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
  testRun: null,
})
