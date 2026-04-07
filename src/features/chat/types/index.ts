// DEPRECATED: Chat feature removed in Phase 2
// These types are stubs to prevent type errors in old layout components
// that will be replaced with workspace components

export interface ConversationItem {
  id: string
  title: string
  lastMessage: string
  timestamp: string
  category?: string
  pinned?: boolean
  unread?: boolean
  active?: boolean
  hasSubThreads?: boolean
}

export interface Message {
  id: string
  content: string
  sender: 'user' | 'agent'
  timestamp: string
}

export interface AgentStatus {
  model: string
  modelName?: string
  status: 'idle' | 'thinking' | 'responding'
  contextWindow: number
  maxContextWindow: number
  progress?: number
  latency?: number
  tokens?: number
}

export interface RecentAction {
  id: string
  action: string
  status: 'success' | 'pending' | 'error'
  timestamp: string
}
