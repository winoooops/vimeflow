import type { ActivityEvent, ActivityEventKind } from '../types/activityEvent'
import type { ActiveToolCall, RecentToolCall } from '../types'

const toolToKind = (tool: string): ActivityEventKind => {
  switch (tool) {
    case 'Edit':
    case 'MultiEdit':
      return 'edit'
    case 'Write':
    case 'NotebookEdit':
      return 'write'
    case 'Read':
      return 'read'
    case 'Bash':
      return 'bash'
    case 'Grep':
      return 'grep'
    case 'Glob':
      return 'glob'
    default:
      return 'meta'
  }
}

export const toolCallsToEvents = (
  active: ActiveToolCall | null,
  recent: RecentToolCall[]
): ActivityEvent[] => {
  const events: ActivityEvent[] = []

  if (active) {
    events.push({
      id: `active-${active.tool}`,
      kind: toolToKind(active.tool),
      tool: active.tool,
      body: active.args,
      timestamp: active.startedAt,
      status: 'running',
      durationMs: null,
    })
  }

  // Sort recent by timestamp descending. The Rust parser appends to the
  // list in arrival order, which is approximately — but not strictly —
  // chronological (batch catch-up, transcript edits, clock skew can all
  // reorder). The feed's only meaningful order is by event time, so we
  // sort explicitly here rather than trust arrival order.
  const sortedRecent = [...recent].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  for (const r of sortedRecent) {
    events.push({
      id: r.id,
      kind: toolToKind(r.tool),
      tool: r.tool,
      body: r.args,
      timestamp: r.timestamp,
      status: r.status,
      durationMs: r.durationMs,
    })
  }

  return events
}
