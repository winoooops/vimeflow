import type { ContextWindowStatus } from '../../../bindings/ContextWindowStatus'
import type { CostMetrics } from '../../../bindings/CostMetrics'
import type { RateLimits } from '../../../bindings/RateLimits'

// Re-export bindings, but NOT AgentStatusEvent — we override it below
// because ts-rs doesn't map Rust Option<T> to nullable TypeScript fields.
export type {
  AgentToolCallEvent,
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
  contextWindow: ContextWindowStatus | null
  cost: CostMetrics | null
  rateLimits: RateLimits | null
}

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
  usedPercentage: number
  contextWindowSize: number
  totalInputTokens: number
  totalOutputTokens: number
  currentUsage: CurrentUsageState | null
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
   * AgentToolCallEvent — see `src-tauri/src/agent/test_runners/test_file_patterns.rs`.
   */
  isTestFile: boolean
}
