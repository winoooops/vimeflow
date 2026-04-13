// Re-export relevant bindings
export type {
  AgentStatusEvent,
  AgentToolCallEvent,
  AgentDetectedEvent,
  AgentDisconnectedEvent,
} from '../../../bindings'

export interface AgentStatus {
  isActive: boolean
  agentType: 'claude-code' | 'codex' | 'aider' | 'generic' | null
  modelId: string | null
  modelDisplayName: string | null
  version: string | null
  sessionId: string | null
  agentSessionId: string | null

  // Budget metrics
  contextWindow: ContextWindowState | null
  cost: CostState | null
  rateLimits: RateLimitsState | null

  // Activity
  toolCalls: ToolCallState
  recentToolCalls: RecentToolCall[]
}

export interface ContextWindowState {
  usedPercentage: number
  contextWindowSize: number
  totalInputTokens: number
  totalOutputTokens: number
}

export interface CostState {
  totalCostUsd: number
  totalDurationMs: number
  totalApiDurationMs: number
  totalLinesAdded: number
  totalLinesRemoved: number
}

export interface RateLimitsState {
  fiveHour: { usedPercentage: number; resetsAt: number }
  sevenDay?: { usedPercentage: number; resetsAt: number }
}

export interface ToolCallState {
  total: number
  byType: Record<string, number>
  active: ActiveToolCall | null
}

export interface ActiveToolCall {
  tool: string
  args: string
}

export interface RecentToolCall {
  id: string
  tool: string
  args: string
  status: 'done' | 'failed'
  durationMs: number | null
  timestamp: string
}
