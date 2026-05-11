// Session domain types — owned by src/features/sessions/.
// cspell:ignore vsplit hsplit

export type SessionStatus = 'running' | 'paused' | 'completed' | 'errored'

export type LayoutId = 'single' | 'vsplit' | 'hsplit' | 'threeRight' | 'quad'

export interface Pane {
  /** Session-scoped pane id, e.g. `'p0'`, `'p1'`. Stable across renders;
   * used to address the pane within `Session.panes`. NOT a Rust handle. */
  id: string

  /** Rust PTY handle. Equals what the Rust IPC layer calls `sessionId` on
   * the wire. Used for every PTY operation. */
  ptyId: string

  /** Per-pane working directory. */
  cwd: string

  /** Detected agent CLI for this pane. */
  agentType: 'claude-code' | 'codex' | 'aider' | 'generic'

  /** Materialized pane status. */
  status: SessionStatus

  /** Restoration buffer for buffered-event drain. */
  restoreData?: import('../../terminal/types').RestoreData

  /** OS process id of the PTY. */
  pid?: number

  /** Exactly one pane per session has `active === true`. */
  active: boolean
}

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
