// Reconstruct workspace `Session`s from the flat `SessionInfo[]` that
// `list_sessions` returns, honoring the optional `grouping` metadata so a
// multi-pane workspace restores as ONE session with its original layout
// instead of fragmenting into N single-pane sessions.
//
// Grouped PTYs (those whose `info.grouping` is set) collapse into one Session
// per `workspaceSessionId`, ordered by `paneIndex`, with the recorded layout
// and active pane. Ungrouped PTYs (legacy cache entries or PTYs spawned
// before the frontend pushed a grouping snapshot) fall back to the existing
// `sessionFromInfo` single-pane shape — strict back-compat, so a half-rolled-
// out cache still restores correctly. Iteration follows cache order: the
// position of each workspace in the returned list equals the position of its
// first encountered PTY in `infos`.

import type { PaneGrouping, SessionInfo } from '../../../bindings'
import { emptyActivity } from '../constants'
import type { LayoutId, Pane, Session } from '../types'
import { readActivityPanelCollapsed } from './activityPanelCollapsedStore'
import { sessionFromInfo } from './sessionFromInfo'
import { deriveSessionStatus } from './sessionStatus'
import { tabName } from './tabName'

type AgentType = Pane['agentType']

const KNOWN_AGENT_TYPES: readonly AgentType[] = [
  'claude-code',
  'codex',
  'aider',
  'generic',
]

const KNOWN_LAYOUT_IDS: readonly LayoutId[] = [
  'single',
  'vsplit',
  'hsplit',
  'threeRight',
  'quad',
]

const toAgentType = (value: string): AgentType =>
  (KNOWN_AGENT_TYPES as readonly string[]).includes(value)
    ? (value as AgentType)
    : 'generic'

const toLayoutId = (value: string): LayoutId =>
  (KNOWN_LAYOUT_IDS as readonly string[]).includes(value)
    ? (value as LayoutId)
    : 'single'

interface GroupedEntry {
  info: SessionInfo
  grouping: PaneGrouping
}

// Discriminated union: `kind` is the discriminator, `entries` carries the
// matching element type per arm. With this shape, narrowing on `bucket.kind`
// also narrows `bucket.entries`, so the call sites need no `as` casts and a
// future refactor that adds a new `kind` or reorders arms fails at compile
// time instead of silently widening into wrong-shape entries at runtime.
type Bucket =
  | { kind: 'grouped'; id: string; entries: GroupedEntry[]; layout: LayoutId }
  | { kind: 'ungrouped'; id: string; entries: SessionInfo[]; layout: LayoutId }

const buildPane = (
  info: SessionInfo,
  paneId: string,
  agentType: AgentType,
  active: boolean
): Pane => {
  const status = info.status.kind === 'Alive' ? 'running' : 'completed'

  const base = {
    id: paneId,
    ptyId: info.id,
    cwd: info.cwd,
    agentType,
    status,
    active,
  } satisfies Pane

  if (info.status.kind !== 'Alive') {
    return base
  }

  return {
    ...base,
    pid: info.status.pid,
    restoreData: {
      sessionId: info.id,
      cwd: info.cwd,
      pid: info.status.pid,
      replayData: info.status.replay_data,
      replayEndOffset: Number(info.status.replay_end_offset),
      bufferedEvents: [],
    },
  }
}

const buildGroupedSession = (
  workspaceId: string,
  layout: LayoutId,
  entries: GroupedEntry[],
  fallbackIndex: number
): Session => {
  // Stable ordering by paneIndex; ties broken by first-seen order.
  const ordered = [...entries].sort(
    (a, b) => a.grouping.paneIndex - b.grouping.paneIndex
  )

  const panes: Pane[] = ordered.map((entry) =>
    buildPane(
      entry.info,
      entry.grouping.paneId,
      toAgentType(entry.grouping.agentType),
      entry.grouping.active
    )
  )

  // Invariant: exactly one active pane. The cache may briefly hold zero or
  // multiple active flags during a push race; fix it up locally so the
  // SplitView's `getActivePane` doesn't throw.
  const activeIndex = panes.findIndex((pane) => pane.active)
  if (activeIndex === -1 && panes.length > 0) {
    panes[0] = { ...panes[0], active: true }
  } else if (activeIndex !== -1) {
    for (let i = 0; i < panes.length; i += 1) {
      if (i !== activeIndex && panes[i].active) {
        panes[i] = { ...panes[i], active: false }
      }
    }
  }

  const activePane = panes.find((pane) => pane.active) ?? panes[0]
  const now = new Date().toISOString()

  return {
    id: workspaceId,
    projectId: 'proj-1',
    name: tabName(activePane.cwd, fallbackIndex),
    status: deriveSessionStatus(panes),
    workingDirectory: activePane.cwd,
    agentType: activePane.agentType,
    layout,
    activityPanelCollapsed: readActivityPanelCollapsed(workspaceId),
    panes,
    createdAt: now,
    lastActivityAt: now,
    activity: { ...emptyActivity },
  }
}

export const groupSessionsFromInfos = (
  infos: readonly SessionInfo[]
): Session[] => {
  // First pass: bucket by workspace id (or singleton for ungrouped). Use a
  // Map keyed by bucket key for stable insertion order, so the bucket order
  // mirrors the cache's PTY order.
  const order: string[] = []
  const buckets = new Map<string, Bucket>()

  for (const info of infos) {
    const grouping = info.grouping ?? undefined
    if (grouping) {
      const key = grouping.workspaceSessionId
      if (!buckets.has(key)) {
        buckets.set(key, {
          kind: 'grouped',
          id: key,
          entries: [],
          layout: toLayoutId(grouping.layout),
        })
        order.push(key)
      }
      const bucket = buckets.get(key)
      if (bucket?.kind === 'grouped') {
        bucket.entries.push({ info, grouping })
        // Self-healing: the layout recorded on any pane wins. If different
        // panes disagree (rare race), the first non-`single` wins so a quad
        // workspace doesn't collapse to single because one pane was pushed
        // before the layout change.
        if (bucket.layout === 'single' && grouping.layout !== 'single') {
          bucket.layout = toLayoutId(grouping.layout)
        }
      }
    } else {
      const key = `__solo:${info.id}`
      buckets.set(key, {
        kind: 'ungrouped',
        id: info.id,
        entries: [info],
        layout: 'single',
      })
      order.push(key)
    }
  }

  return order.map((key, index) => {
    const bucket = buckets.get(key)
    if (!bucket) {
      throw new Error(`groupSessionsFromInfos: missing bucket ${key}`)
    }
    if (bucket.kind === 'ungrouped') {
      // Preserve the exact legacy single-pane shape via the existing helper.
      return sessionFromInfo(bucket.entries[0], index)
    }

    return buildGroupedSession(bucket.id, bucket.layout, bucket.entries, index)
  })
}
