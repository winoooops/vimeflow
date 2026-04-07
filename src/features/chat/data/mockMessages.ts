// DEPRECATED: Chat feature removed in Phase 2
// This is a stub to prevent type errors in old layout components

import type { ConversationItem, AgentStatus, RecentAction } from '../types'

export const mockConversations: ConversationItem[] = []

export const mockRecentActions: RecentAction[] = []

export const mockAgentStatus: AgentStatus = {
  model: 'claude-sonnet-4',
  modelName: 'Claude 3.5 Sonnet',
  status: 'idle',
  contextWindow: 134000,
  maxContextWindow: 200000,
  progress: 67,
  latency: 142,
  tokens: 12847,
}
