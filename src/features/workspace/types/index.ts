// Workspace domain types for Phase 2 CLI agent workspace

// ============================================================================
// Navigation Types (Phase 2v2)
// ============================================================================

export interface NavigationItem {
  id: string
  name: string
  icon: string // Material Symbols icon name
  color: string // Tailwind color class (e.g., 'bg-emerald-500')
  onClick: () => void
}

// ============================================================================
// Project Types
// ============================================================================

export interface Project {
  id: string
  name: string
  abbreviation: string // 2-letter abbreviation for icon rail
  path: string // working directory path
  color?: string // optional custom color for avatar
  sessions: Session[]
  createdAt: string
  lastAccessedAt: string
}

// ============================================================================
// Session Types
// ============================================================================

// SessionStatus aligns with docs/design/tokens.ts SessionState per UNIFIED.md §4.1
// Five-state agent session model: running | awaiting | completed | errored | idle
export type SessionStatus =
  | 'running'
  | 'awaiting'
  | 'completed'
  | 'errored'
  | 'idle'

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

// ============================================================================
// Agent Activity Types
// ============================================================================

// ActivityEvent types per UNIFIED.md §5.2 - timeline event representation
export type ActivityEventType = 'edit' | 'bash' | 'read' | 'think' | 'user'

export interface ActivityEventBadge {
  kind: 'live' | 'ok' | 'failed' | 'diff'
  text: string // e.g. "LIVE", "OK", "FAILED 1/4", "+12 -2"
}

export interface ActivityEvent {
  id: string
  type: ActivityEventType
  body: string
  at: string // ISO timestamp; UI formats relatively
  badge?: ActivityEventBadge
}

export interface AgentActivity {
  fileChanges: FileChange[]
  toolCalls: ToolCall[]
  testResults: TestResult[]
  contextWindow: ContextWindowStatus
  usage: UsageMetrics
  events?: ActivityEvent[] // Timeline events for new ActivityFeed component
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

// ============================================================================
// Context Panel Types
// ============================================================================

export type ContextPanelType = 'files' | 'editor' | 'diff'

export interface ContextPanelState {
  active: ContextPanelType
  sidebarWidth: number // 260px default, can be resized
  isExpanded: boolean // true when using full-width overlay
}

// ============================================================================
// Terminal Types
// ============================================================================

export interface Terminal {
  id: string
  sessionId: string
  type: 'agent' | 'shell'
  label: string // tab label
  pid?: number
  createdAt: string
}

// ============================================================================
// UI State Types
// ============================================================================

export interface WorkspaceState {
  activeProjectId: string | null
  activeSessionId: string | null
  activeTerminalId: string | null
  sidebarCollapsed: boolean
  activityPanelCollapsed: boolean
  contextPanel: ContextPanelState
}
