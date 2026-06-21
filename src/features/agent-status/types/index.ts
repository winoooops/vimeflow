// cspell:ignore worktree
import type { ContextWindowStatus as GeneratedContextWindowStatus } from '../../../bindings/ContextWindowStatus'
import type { CurrentUsage } from '../../../bindings/CurrentUsage'
import type { RateLimits } from '../../../bindings/RateLimits'

// Re-export bindings, but NOT AgentStatusEvent — we override it below
// because ts-rs doesn't map Rust Option<T> to nullable TypeScript fields.
export type {
  AgentCwdEvent,
  AgentToolCallEvent,
  AgentTurnEvent,
  AgentDetectedEvent,
  AgentDisconnectedEvent,
} from '../../../bindings'

// Runtime-accurate override: Rust Option<T> serializes to null,
// but ts-rs generates required fields. This type matches what
// the Tauri event bus actually delivers.
export interface AgentStatusEvent {
  sessionId: string
  agentSessionId: string | null
  modelId: string | null
  modelDisplayName: string | null
  version: string | null
  contextWindow: AgentContextWindowStatus | null
  cost: CostMetrics | null
  rateLimits: RateLimits | null
  // True once kimi's network usage fetch has landed; false for claude/codex
  // and a kimi session that hasn't fetched yet.
  usageFetched: boolean
}

// Runtime-accurate override for ContextWindowStatus. Rust Option<f64>
// serializes to null, but ts-rs currently marks the field optional.
export type AgentContextWindowStatus = Omit<
  GeneratedContextWindowStatus,
  'currentUsage' | 'usedPercentage'
> & {
  currentUsage?: CurrentUsage | null
  usedPercentage: number | null
}

// Runtime-accurate override for CostMetrics. Rust Option<f64> serializes to
// null, but ts-rs generates a required field.
export interface CostMetrics {
  totalCostUsd: number | null
  totalDurationMs: number
  totalApiDurationMs: number
  totalLinesAdded: number
  totalLinesRemoved: number
}

export interface AgentStatus {
  isActive: boolean
  /**
   * True after a previously detected agent disappears while the PTY remains
   * alive. Consumers that render pane chrome use this to return to shell
   * styling immediately, while the activity panel can still hold final
   * metrics during its exit window.
   */
  agentExited: boolean
  agentType:
    | 'claude-code'
    | 'codex'
    | 'kimi'
    | 'opencode'
    | 'aider'
    | 'generic'
    | null
  modelId: string | null
  modelDisplayName: string | null
  version: string | null
  sessionId: string | null
  agentSessionId: string | null
  /**
   * Agent-reported working directory, populated from each adapter's
   * structured cwd channel in its transcript JSONL:
   * - **Claude Code** writes a top-level `cwd` on every entry; transitions
   *   fire as soon as the next line is parsed.
   * - **Codex** writes cwd in two read paths: `session_meta.payload.cwd`
   *   (session start) and `response_item.payload.arguments.workdir` for
   *   `exec_command` function calls (mid-session). `turn_context.cwd`
   *   is intentionally NOT a source — pinned to session-start and would
   *   cause false reverts.
   *
   * `null` before the first transition or for agents that don't expose a
   * transcript. The workspace bridge mirrors this into `pane.cwd` so the
   * Header chip + git branch follow tool-call-driven cwd changes.
   */
  cwd: string | null

  // Budget metrics
  contextWindow: ContextWindowState | null
  cost: CostState | null
  rateLimits: RateLimitsState | null
  // True once kimi's network usage fetch has landed (the kimi usage gate uses
  // this to tell LOADING from ON); false for claude/codex and pre-fetch kimi.
  // Optional so the hook always sets it while consumers default absent to
  // false — no test fixture needs to carry a kimi-only field.
  usageFetched?: boolean

  // Activity
  numTurns: number
  toolCalls: ToolCallState
  recentToolCalls: RecentToolCall[]

  // Latest test run snapshot (null until the first test-run event arrives)
  testRun: TestRunSnapshot | null
}

export type TestRunStatus = 'pass' | 'fail' | 'noTests' | 'error'

export type TestGroupKind = 'file' | 'suite' | 'module'

export type TestGroupStatus = 'pass' | 'fail' | 'skip'

export interface TestGroup {
  label: string
  // Rust serializes Option<String> as null (not omitted). Use string | null
  // so the boundary contract matches the wire shape exactly.
  path: string | null
  kind: TestGroupKind
  passed: number
  failed: number
  skipped: number
  total: number
  status: TestGroupStatus
}

export interface TestRunSummary {
  passed: number
  failed: number
  skipped: number
  total: number
  groups: TestGroup[]
}

export interface TestRunSnapshot {
  sessionId: string // PTY session id
  runner: string
  commandPreview: string
  startedAt: string
  finishedAt: string
  durationMs: number
  status: TestRunStatus
  // Rust serializes Option<String> as null (not omitted).
  outputExcerpt: string | null
  summary: TestRunSummary
}

export interface CurrentUsageState {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
}

export interface ContextWindowState {
  usedPercentage: number | null
  contextWindowSize: number
  totalInputTokens: number
  totalOutputTokens: number
  currentUsage: CurrentUsageState | null
}

export interface CostState {
  totalCostUsd: number | null
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
  startedAt: string
  toolUseId: string
}

export interface RecentToolCall {
  id: string
  tool: string
  args: string
  status: 'done' | 'failed'
  durationMs: number | null
  timestamp: string
  /**
   * True when this entry is a Write/Edit on a path that matches a
   * known test-file convention. Sourced from the originating Rust
   * AgentToolCallEvent — see `crates/backend/src/agent/adapter/claude_code/test_runners/test_file_patterns.rs`.
   */
  isTestFile: boolean
}
