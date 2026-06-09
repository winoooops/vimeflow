// Session domain types — owned by src/features/sessions/.
// cspell:ignore vsplit hsplit

export type SessionStatus =
  | 'running'
  | 'awaiting'
  | 'idle'
  | 'completed'
  | 'errored'

export type SessionCloseResult = false | void

export type LayoutId = 'single' | 'vsplit' | 'hsplit' | 'threeRight' | 'quad'

export type PaneKind = 'shell' | 'browser'

export interface Pane {
  /**
   * Pane renderer kind. Undefined means the legacy shell pane so restored
   * sessions, older tests, and existing serialized state keep their behavior.
   */
  kind?: PaneKind

  /** Session-scoped pane id, e.g. `'p0'`, `'p1'`. Stable across renders;
   * used to address the pane within `Session.panes`. NOT a Rust handle. */
  id: string

  /** Rust PTY handle. Equals what the Rust IPC layer calls `sessionId` on
   * the wire. Used for every PTY operation. Browser panes use a stable
   * `browser:<uuid>` pseudo-handle so existing pane identity plumbing can
   * remain additive. */
  ptyId: string

  /** Initial/current browser URL for browser panes. Ignored by shell panes. */
  browserUrl?: string

  /** Per-pane working directory. */
  cwd: string

  /** Resolved shell path for shell panes, e.g. `/bin/zsh`. */
  shell?: string

  /** Detected agent CLI for this pane. */
  agentType: 'claude-code' | 'codex' | 'aider' | 'generic'

  /**
   * Title emitted by the agent for the agent session bound to this PTY.
   * `undefined` when no agent has emitted a title yet for this pane.
   * Source layer is the `agent-session-title` event.
   */
  agentTitle?: string

  /**
   * Where the current `agentTitle` came from. Undefined iff `agentTitle`
   * is undefined.
   */
  agentTitleSource?: 'ai-generated' | 'user-renamed'

  /**
   * User-set per-pane label, written by the `Ctrl+:` → `r` chord
   * (`usePaneRenameChord`). Always set on submit regardless of pane
   * type:
   *
   * - For `claude-code` / `codex` panes the chord ALSO writes
   *   `/rename` via the `rename_agent_session` IPC so the agent's
   *   transcript stays in sync; both `agentTitle` and `userLabel`
   *   converge on the new value.
   * - For other pane types (`aider`, `generic`, shell sessions with
   *   no detected agent) the chord ONLY sets `userLabel` — no IPC,
   *   no PTY write. `agentTitle` stays undefined.
   *
   * Header precedence: `userLabel ?? agentTitle ?? session.name`.
   * `userLabel` wins because it represents the user's explicit
   * intent; the agent's later auto-title generations do not
   * overwrite a user-set label.
   *
   * Not persisted across reload (consistent with the spec's
   * "no persistence beyond what the agent persists" non-goal).
   */
  userLabel?: string

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
  /** Stable session/project cwd used as the baseline for new panes. */
  workingDirectory: string
  /** Stable native-browser owner key. Defaults to the first shell PTY for
   *  older in-memory sessions, but once set it survives shell pane restarts
   *  and close/reorder operations so WebContentsView partition/control keys
   *  stay stable for the lifetime of the Vimeflow session. */
  browserSessionId?: string
  /** Derived from `getActivePane(session).agentType`; retained for existing chrome. */
  agentType: 'claude-code' | 'codex' | 'aider' | 'generic'
  /** Per-session canvas layout. Default 'single' in step 5a. */
  layout: LayoutId
  /** Session-scoped collapse state for the right agent activity panel.
   *  Shared by every pane so switching pane within a session never
   *  jumps the bar. UI-only: hydrated from localStorage by session id
   *  and persisted there on toggle. Default `false` (expanded). */
  activityPanelCollapsed: boolean
  /** At least one pane per session. Step 5a creates single-pane sessions. */
  panes: Pane[]
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
