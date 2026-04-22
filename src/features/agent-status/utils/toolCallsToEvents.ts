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
      // Use the Anthropic tool_use_id so this entry's React key stays
      // stable across the running → done transition. Otherwise React
      // unmounts the synthetic `active-${tool}` row and mounts a fresh
      // `toolu_XXX` row on completion — correct today (no local state),
      // but it silently breaks any future CSS transition animation on
      // the state change.
      id: active.toolUseId,
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
  //
  // Malformed timestamps (unparseable ISO strings slipping through the
  // Rust boundary) make Date.getTime() return NaN. An NaN comparator
  // result is implementation-defined — V8 produces platform-dependent
  // ordering for every pair involving the bad entry. Sink malformed
  // entries to the bottom with explicit NaN sentinels so the rest of
  // the feed stays ordered. Matches the defensive posture in
  // relativeTime.ts.
  const sortedRecent = [...recent].sort((a, b) => {
    const ta = new Date(a.timestamp).getTime()
    const tb = new Date(b.timestamp).getTime()
    if (Number.isNaN(ta)) {
      return 1
    }
    if (Number.isNaN(tb)) {
      return -1
    }

    return tb - ta
  })

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
