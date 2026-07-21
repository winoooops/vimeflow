import type { ActivityEvent } from '../types/activityEvent'
import type { ActiveToolCall, AgentStatus, RecentToolCall } from '../types'
import { classifyToolCall } from './toolCallProfiles'

export const toolCallsToEvents = (
  agentType: AgentStatus['agentType'],
  active: ActiveToolCall | null,
  recent: RecentToolCall[]
): ActivityEvent[] => {
  const events: ActivityEvent[] = []

  if (active) {
    const presentation = classifyToolCall(agentType, active.tool)

    events.push({
      // Use the Anthropic tool_use_id so this entry's React key stays
      // stable across the running → done transition. Otherwise React
      // unmounts the synthetic `active-${tool}` row and mounts a fresh
      // `toolu_XXX` row on completion — correct today (no local state),
      // but it silently breaks any future CSS transition animation on
      // the state change.
      id: active.toolUseId,
      kind: presentation.kind,
      tool: active.tool,
      label: presentation.label,
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
    const presentation = classifyToolCall(agentType, r.tool)

    events.push({
      id: r.id,
      kind: presentation.kind,
      tool: r.tool,
      label: presentation.label,
      body: r.args,
      timestamp: r.timestamp,
      status: r.status,
      durationMs: r.durationMs,
      isTestFile: r.isTestFile,
    })
  }

  return events
}
