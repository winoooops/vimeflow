export const ORCHESTRATOR_RUN_STATUSES = [
  'queued',
  'claimed',
  'preparing_workspace',
  'rendering_prompt',
  'running',
  'retry_scheduled',
  'succeeded',
  'failed',
  'stopped',
  'released',
] as const

export type RunStatus = (typeof ORCHESTRATOR_RUN_STATUSES)[number]

export interface OrchestratorIssue {
  id: string
  identifier: string
  title: string
  description: string | null
  state: string
  url: string | null
  labels: string[]
  priority: number | null
  updatedAt: string | null
}

export interface QueueIssue {
  issue: OrchestratorIssue
  status: RunStatus
  runId: string | null
  attemptNumber: number | null
  nextRetryAt: string | null
  lastError: string | null
}

export interface OrchestratorRun {
  runId: string
  processId: number | null
  issueId: string
  issueIdentifier: string
  attemptNumber: number
  status: RunStatus
  workspacePath: string
  stdoutLogPath: string | null
  stderrLogPath: string | null
  startedAt: string
  lastEvent: string | null
}

export interface RetryEntry {
  issueId: string
  issueIdentifier: string
  attemptNumber: number
  nextRetryAt: string
  lastError: string
}

export interface OrchestratorSnapshot {
  paused: boolean
  queue: QueueIssue[]
  running: OrchestratorRun[]
  retryQueue: RetryEntry[]
}

export interface OrchestratorEvent {
  timestamp: string
  workflowPath: string
  issueId: string
  issueIdentifier: string
  runId: string | null
  attemptNumber: number | null
  status: RunStatus
  workspacePath: string | null
  message: string | null
  error: string | null
}

export interface WorkspacePlan {
  issueId: string
  issueIdentifier: string
  workspaceSlug: string
  path: string
  baseRef: string
  branchName: string
  promptFile: string
}

export interface AgentRun {
  runId: string
  processId: number | null
  stdoutLogPath: string | null
  stderrLogPath: string | null
}

export interface DispatchedRun {
  issue: OrchestratorIssue
  attemptNumber: number
  workspace: WorkspacePlan
  run: AgentRun
}

export interface DispatchFailure {
  issue: OrchestratorIssue
  attemptNumber: number
  workspacePath: string | null
  error: string
}

export interface DispatchBatch {
  snapshot: OrchestratorSnapshot
  claimed: QueueIssue[]
  started: DispatchedRun[]
  failed: DispatchFailure[]
  events: OrchestratorEvent[]
}

export interface ControlBatch {
  snapshot: OrchestratorSnapshot
  events: OrchestratorEvent[]
}
