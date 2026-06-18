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
import { DEFAULT_BROWSER_URL } from '../../browser/types'
import { isKnownLayoutId } from '../../terminal/layout-registry/layoutRegistry'
import { createLogger } from '../../../lib/log'
import { emptyActivity } from '../constants'
import type { LayoutId, Pane, Session } from '../types'
import type {
  PersistedWorkspaceShape,
  PersistedWorkspaceSessionShape,
  PersistedShellPaneShape,
} from '../workspaceLayoutBridge'
import { readActivityPanelCollapsed } from './activityPanelCollapsedStore'
import { sessionFromInfo } from './sessionFromInfo'
import { deriveShellSessionStatus } from './sessionStatus'
import { tabName } from './tabName'

const log = createLogger('sessions')

type AgentType = Pane['agentType']

const KNOWN_AGENT_TYPES: readonly AgentType[] = [
  'claude-code',
  'codex',
  'kimi',
  'aider',
  'generic',
]

const toAgentType = (value: string): AgentType =>
  (KNOWN_AGENT_TYPES as readonly string[]).includes(value)
    ? (value as AgentType)
    : 'generic'

const toLayoutId = (value: string): LayoutId =>
  isKnownLayoutId(value) ? value : 'single'

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
    shell: info.shell,
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

  const rawPanes: Pane[] = ordered.map((entry) =>
    buildPane(
      entry.info,
      entry.grouping.paneId,
      toAgentType(entry.grouping.agentType),
      entry.grouping.active
    )
  )

  // Invariant: exactly one active pane. The cache may briefly hold zero or
  // multiple active flags during a push race; fix it up locally so the
  // SplitView's `getActivePane` doesn't throw. The fix-up is a single
  // immutable `map` pass per the project immutability rule (`rules/typescript/
  // coding-style/CLAUDE.md`): when no pane is flagged active, pane 0 wins;
  // when one or more are flagged, the first flagged pane wins and the rest
  // are cleared.
  const firstActiveIdx = rawPanes.findIndex((pane) => pane.active)

  const panes: Pane[] = rawPanes.map((pane, i) => ({
    ...pane,
    active: firstActiveIdx === -1 ? i === 0 : i === firstActiveIdx,
  }))

  const activePane = panes.find((pane) => pane.active) ?? panes[0]
  const now = new Date().toISOString()

  // Read the stable session baseline cwd from any pane's grouping (the
  // backend writes it onto every pane in the bucket so we can pick the
  // first non-null value here without a separate workspace lookup). When
  // the cache predates the field, fall back to the active pane's cwd —
  // same behavior as before the field existed (Codex P2 on PR #290
  // cycle 7).
  const workspaceDirectory =
    ordered.find((entry) => entry.grouping.workspaceDirectory !== undefined)
      ?.grouping.workspaceDirectory ?? activePane.cwd

  return {
    id: workspaceId,
    projectId: 'proj-1',
    name: tabName(workspaceDirectory, fallbackIndex),
    status: deriveShellSessionStatus(panes),
    workingDirectory: workspaceDirectory,
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
    // `info.grouping` is `PaneGrouping | undefined` at runtime — the IPC
    // emits the field omitted (not `null`) when ungrouped, thanks to
    // `serde(skip_serializing_if = "Option::is_none")` in `types.rs`.
    const { grouping } = info
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
        // Self-healing: the layout recorded on any pane wins. If different
        // panes disagree (rare race), the first non-`single` wins so a quad
        // workspace doesn't collapse to single because one pane was pushed
        // before the layout change.
        const incomingLayout = toLayoutId(grouping.layout)
        buckets.set(key, {
          ...bucket,
          entries: [...bucket.entries, { info, grouping }],
          layout:
            bucket.layout === 'single' && incomingLayout !== 'single'
              ? incomingLayout
              : bucket.layout,
        })
      }
    } else {
      const key = `__solo:${info.id}`
      // Mirror the grouped path's `!buckets.has` guard so a duplicate
      // `info.id` (from a corrupted cache `session_order` with repeated
      // PTY ids) does not produce two solo buckets keyed `__solo:<id>`.
      // Without this guard, the duplicate would surface as two restored
      // Sessions sharing one ptyId; both call `registerPtySession`, the
      // second overwrites the first, and one pane stays blank
      // forever. Codex review on PR #290 cycle 11 (Claude MEDIUM).
      if (!buckets.has(key)) {
        buckets.set(key, {
          kind: 'ungrouped',
          id: info.id,
          entries: [info],
          layout: 'single',
        })
        order.push(key)
      }
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

// Trust the backend's `activeSessionId` as the canonical active PTY after a
// reload: `set_active_session` lands immediately while a grouping snapshot can
// carry stale `pane.active` flags (or fail to land). Recompute the active pane
// flag plus the session fields that follow it. `workingDirectory` / `name` are
// LEFT ALONE — they come from the persisted workspace baseline, not a pane's
// live cwd — except the legacy back-compat case where no pane recorded a
// persisted baseline, where the fallback `panes[0].cwd` may be the wrong pane.
const reconcileActivePane = (
  grouped: Session[],
  infos: readonly SessionInfo[],
  activePtyId: string | null
): Session[] => {
  if (!activePtyId) {
    return grouped
  }

  const workspacesWithPersistedBaseline = new Set(
    infos.flatMap((info) =>
      info.grouping?.workspaceDirectory !== undefined
        ? [info.grouping.workspaceSessionId]
        : []
    )
  )

  return grouped.map((session, sessionIndex) => {
    const newActivePane = session.panes.find(
      (pane) => pane.ptyId === activePtyId
    )
    if (!newActivePane) {
      return session
    }

    const overrideBaseline = !workspacesWithPersistedBaseline.has(session.id)

    return {
      ...session,
      panes: session.panes.map((pane) => ({
        ...pane,
        active: pane.ptyId === activePtyId,
      })),
      agentType: newActivePane.agentType,
      ...(overrideBaseline
        ? {
            workingDirectory: newActivePane.cwd,
            name: tabName(newActivePane.cwd, sessionIndex),
          }
        : {}),
    }
  })
}

// An alive shell pane reattaches via the existing replay protocol — `buildPane`
// reads the live cwd + replay snapshot off the live `SessionInfo`, keyed by the
// store pane's `paneId` / `agentType` / `active`.
const buildReattachedShellPane = (
  live: SessionInfo,
  shape: PersistedShellPaneShape
): Pane =>
  buildPane(live, shape.paneId, toAgentType(shape.agentType), shape.active)

// A shell pane whose PTY is gone (graceful quit / crash) returns as a
// restartable `completed` placeholder seeded with the persisted cwd + agent —
// the existing Restart UX spawns a fresh shell there.
const buildPlaceholderShellPane = (shape: PersistedShellPaneShape): Pane => ({
  id: shape.paneId,
  ptyId: shape.ptyId,
  cwd: shape.cwd,
  agentType: toAgentType(shape.agentType),
  status: 'completed',
  active: shape.active,
})

// A browser pane returns as a runtime browser `Pane` with a fresh pseudo-ptyId;
// main restores its tabs/history when the renderer triggers the restore create.
const buildRestoredBrowserPane = (
  paneId: string,
  active: boolean,
  workingDirectory: string
): Pane => ({
  kind: 'browser',
  id: paneId,
  ptyId: `browser:${crypto.randomUUID()}`,
  cwd: workingDirectory,
  agentType: 'generic',
  status: 'idle',
  active,
  browserUrl: DEFAULT_BROWSER_URL,
})

const buildStoreSession = (
  shape: PersistedWorkspaceSessionShape,
  liveByPtyId: Map<string, SessionInfo>,
  fallbackIndex: number
): Session => {
  const ordered = [...shape.panes].sort((a, b) => a.paneIndex - b.paneIndex)

  const rawPanes: Pane[] = ordered.map((pane) => {
    if (pane.kind === 'browser') {
      return buildRestoredBrowserPane(
        pane.paneId,
        pane.active,
        shape.workingDirectory
      )
    }
    const live = liveByPtyId.get(pane.ptyId)

    return live?.status.kind === 'Alive'
      ? buildReattachedShellPane(live, pane)
      : buildPlaceholderShellPane(pane)
  })

  // Exactly one active pane (mirrors `buildGroupedSession`): the first flagged
  // pane wins, else pane 0.
  const firstActiveIdx = rawPanes.findIndex((pane) => pane.active)

  const panes: Pane[] = rawPanes.map((pane, i) => ({
    ...pane,
    active: firstActiveIdx === -1 ? i === 0 : i === firstActiveIdx,
  }))
  const activePane = panes.find((pane) => pane.active) ?? panes[0]
  const now = new Date().toISOString()

  return {
    id: shape.id,
    projectId: shape.projectId,
    name: tabName(shape.workingDirectory, fallbackIndex),
    status: deriveShellSessionStatus(panes),
    workingDirectory: shape.workingDirectory,
    agentType: activePane.agentType,
    layout: toLayoutId(shape.layout),
    activityPanelCollapsed: readActivityPanelCollapsed(shape.id),
    panes,
    createdAt: now,
    lastActivityAt: now,
    activity: { ...emptyActivity },
  }
}

// Store-driven workspace reconstruction (spec §5). The durable workspace store
// is the authoritative shape; live PTYs are an overlay matched by `ptyId`. When
// the store is absent/empty/discarded, fall back entirely to the PTY-driven
// `groupSessionsFromInfos` (+ active-pane reconcile) so a reload with no store
// behaves exactly like #290.
export const reconstructWorkspace = (
  storeShape: PersistedWorkspaceShape | null,
  liveSessions: readonly SessionInfo[],
  activeSessionId: string | null
): Session[] => {
  if (!storeShape || storeShape.sessions.length === 0) {
    return reconcileActivePane(
      groupSessionsFromInfos(liveSessions),
      liveSessions,
      activeSessionId
    )
  }

  const validStoreSessions = storeShape.sessions.filter((session) => {
    if (session.panes.length === 0) {
      log.warn(`Skipping persisted session with zero panes: ${session.id}`)

      return false
    }

    return true
  })

  const liveByPtyId = new Map(liveSessions.map((info) => [info.id, info]))
  const referencedPtyIds = new Set<string>()
  for (const session of validStoreSessions) {
    for (const pane of session.panes) {
      if (pane.kind === 'shell') {
        referencedPtyIds.add(pane.ptyId)
      }
    }
  }

  const storeSessions = validStoreSessions.map((session, index) =>
    buildStoreSession(session, liveByPtyId, index)
  )
  const storeSessionIds = new Set(validStoreSessions.map((s) => s.id))

  // Union, never drop live PTYs: any live PTY the store doesn't reference is
  // reconstructed #290-style (a session created since the last store write).
  const unreferencedLive = liveSessions.filter(
    (info) => !referencedPtyIds.has(info.id)
  )

  // A reconstructed live-only session can collide with a store session id when
  // the live cache is newer than the store (a pane added just before the store
  // write committed). The store wins on shape, but the live PTY must NOT be
  // dropped — re-key the collider to its first PTY (the #290 solo convention,
  // a distinct id space from store UUIDs) so the running agent keeps a tab.
  const liveOnly = reconcileActivePane(
    groupSessionsFromInfos(unreferencedLive),
    unreferencedLive,
    activeSessionId
  ).map((session) =>
    storeSessionIds.has(session.id)
      ? { ...session, id: session.panes[0].ptyId }
      : session
  )

  return [...storeSessions, ...liveOnly]
}
