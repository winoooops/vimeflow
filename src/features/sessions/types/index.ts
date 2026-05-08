// Session domain types — owned by src/features/sessions/.

export type SessionStatus = 'running' | 'paused' | 'completed' | 'errored'

export interface Session {
  id: string
  projectId: string
  name: string // user-assigned or derived from prompt
  status: SessionStatus
  workingDirectory: string
  agentType: 'claude-code' | 'codex' | 'aider' | 'generic'
  terminalPid?: number
  currentAction?: string // current action description (e.g., "Creating auth middleware...")
  createdAt: string
  lastActivityAt: string
  activity: AgentActivity
}

export interface AgentActivity {
  fileChanges: FileChange[]
  toolCalls: ToolCall[]
  testResults: TestResult[]
  contextWindow: ContextWindowStatus
  usage: UsageMetrics
}

export interface FileChange {
  id: string
  path: string
  type: 'new' | 'modified' | 'deleted'
  linesAdded: number
  linesRemoved: number
  timestamp: string
}

export interface ToolCall {
  id: string
  tool: string // e.g., 'Read', 'Write', 'Edit', 'Bash', 'Grep'
  args: string // summary of arguments
  status: 'running' | 'done' | 'failed'
  timestamp: string
  duration?: number // milliseconds
}

export interface TestResult {
  id: string
  file: string
  passed: number
  failed: number
  total: number
  failures: TestFailure[]
  timestamp: string
}

export interface TestFailure {
  id: string
  name: string
  file: string
  line: number
  message: string
}

export interface ContextWindowStatus {
  used: number
  total: number
  percentage: number
  emoji: '😊' | '😐' | '😟' | '🥵' // matches Claude Code's UX
}

export interface UsageMetrics {
  sessionDuration: number // seconds
  turnCount: number
  messages: {
    sent: number
    limit: number // 5-hour window limit
  }
  tokens: {
    input: number
    output: number
    total: number
  }
  cost?: {
    amount: number
    currency: string
  }
}
