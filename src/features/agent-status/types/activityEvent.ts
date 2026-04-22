export type ActivityEventKind =
  | 'edit'
  | 'bash'
  | 'read'
  | 'write'
  | 'grep'
  | 'glob'
  | 'think'
  | 'user'
  | 'meta'

export interface BaseActivityEvent {
  id: string
  kind: ActivityEventKind
  timestamp: string
  status: 'running' | 'done' | 'failed'
  body: string
}

export interface ToolActivityEvent extends BaseActivityEvent {
  kind: 'edit' | 'bash' | 'read' | 'write' | 'grep' | 'glob' | 'meta'
  tool: string
  durationMs: number | null
  diff?: { added: number; removed: number }
  bashResult?: { passed: number; total: number }
}

export interface ThinkActivityEvent extends BaseActivityEvent {
  kind: 'think'
}

export interface UserActivityEvent extends BaseActivityEvent {
  kind: 'user'
}

export type ActivityEvent =
  | ToolActivityEvent
  | ThinkActivityEvent
  | UserActivityEvent
