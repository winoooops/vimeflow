---
title: Step 5a — Pane model refactor (per-session canvas)
date: 2026-05-10
status: draft
issue: TBD (sibling of #164; 5b inherits #164)
owners: [winoooops]
related:
  - docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md
  - docs/superpowers/specs/2026-05-08-step-4-terminal-pane-handoff-design.md
  - docs/design/handoff/README.md
  - docs/design/handoff/prototype/src/splitview.jsx
  - docs/roadmap/progress.yaml
---

# Step 5a — Pane model refactor (per-session canvas)

## Context

Step 5 of the UI Handoff Migration ([#164](https://github.com/winoooops/vimeflow/issues/164))
was originally scoped as "SplitView grid + LayoutSwitcher + ⌘1-4 / ⌘\". During
brainstorming, the rendering work surfaced a deeper architectural shift: the
handoff prototype models each session as a workspace container with its own
layout + panes, and each pane runs its own PTY (potentially a different agent
CLI per pane). This matches the "1 session : many panes" framing — a single
session ("auth refactor") can run Claude in one pane, Codex in another, and a
plain shell in a third, all under the same session tab.

In the current code, a `Session` is 1:1 with a Rust PTY: `useSessionManager`
manages each session as a single terminal, `TerminalZone` does
`sessions.map(s => <TerminalPane sessionId={s.id} />)` and hides
non-active panes with `display:none`. Adopting the prototype's model
requires moving PTY ownership from session-level to pane-level, with a
session now holding `panes: Pane[]` (≥1).

To keep PR review tractable, step 5 is split:

- **5a (this spec)** — refactor the data + IPC model so each session owns
  `panes[]` and each pane owns a PTY. No visual change; existing single-pane
  sessions migrate seamlessly to "1-pane sessions".
- **5b (separate spec)** — render the 5 canonical layouts as a CSS Grid
  `SplitView`, plus `LayoutSwitcher` and ⌘1-4 / ⌘\ wiring. Builds on 5a.

This spec covers 5a only.

## Goals

1. Each `Session` owns `layout: LayoutId` + `panes: Pane[]` (≥1). Workspace
   state holds only `sessions[]` and `activeSessionId` — no workspace-level
   panes/layout.
2. Each `Pane` carries: `id` (session-scoped string, e.g. `'p0'` — used by
   React to address the pane within its session), `ptyId` (the Rust-side
   PTY handle — equals what Rust IPC calls `sessionId`), `cwd` (per-pane
   working directory, drives chrome's `useGitBranch`/`useGitStatus`
   derivations), `agentType`, `status`, `restoreData`.
3. Existing single-pane sessions continue to work unchanged. Migration is
   one-shot at the data-model level — old sessions become 1-pane sessions
   whose `panes[0]` adopts the session's previous PTY.
4. Rust IPC layer remains "PTY-handle-keyed" with **NO RENAME on the wire**.
   The Rust codebase already treats `sessionId` AS the PTY handle. The IPC
   payload field names, Tauri command parameter names, and ts-rs generated
   types continue to use `sessionId`. The React-side `Pane.ptyId` is the
   value that flows through those wire fields — `Rust IPC's sessionId
parameter receives pane.ptyId at every call site`. **`Session.id` (a
   React-side UUID) is independent**: existing IPCs that historically
   received `session.id` (because it equalled the PTY handle in the old
   1:1 model) now receive `getActivePane(session).ptyId` instead.
5. `useSessionManager` evolves into a workspace-level orchestrator that
   delegates pane PTY lifecycle to a per-session pane manager.
6. Public API of `TerminalPane/index.tsx` (the chrome wrapper from step 4)
   gains a `pane: Pane` prop while keeping its existing `session: Session`
   prop for chrome data. Existing per-pane git derivations (`useGitBranch`,
   `useGitStatus`, `aggregateLineDelta`) re-target from
   `session.workingDirectory` to `pane.cwd` — so each pane in a multi-cwd
   session shows its own branch + ±changes. The chrome's IPC handle (was
   `session.id`, now `pane.ptyId`) is a one-line site swap.

## Non-goals

1. SplitView grid rendering — **5b**.
2. LayoutSwitcher UI / ⌘1-4 / ⌘\ — **5b**.
3. "Add pane to existing session" user-facing UI — deferred. 5b's
   LayoutSwitcher is the entry point for changing pane count.
4. Per-pane agent picker (rebinding `pane.agentType` post-spawn) — deferred.
5. Per-session shared state (env vars, .env file, etc.) — deferred.
6. Removing `TerminalZone`'s `display:none` rule for non-active **sessions**
   — still applies. Within the active session, panes render normally per 5b.

## Decisions (resolved during brainstorming)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Per-session canvas (M3) — each session owns layout + panes                                                                                                                                                                                                                                                                                                                                                                                                | User: "the layout and pane should be independent in each session, workspace only holds session info." 1 session : many panes only makes sense if each pane is its own PTY.                                                                                                                                                                                                                                                                                                     |
| 2   | Pane owns PTY-derived state (`cwd`, `agentType`, `status`, `restoreData`, `ptyId`)                                                                                                                                                                                                                                                                                                                                                                        | Each pane is a separate process; collocating its lifecycle state on the pane removes the "primary PTY" ambiguity on Session.                                                                                                                                                                                                                                                                                                                                                   |
| 3   | Session has no own PTY; ≥1 pane invariant                                                                                                                                                                                                                                                                                                                                                                                                                 | Avoids ambiguity. `createSession` creates session-with-1-pane atomically.                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4   | Rust IPC keeps PTY-handle terminology with **NO RENAME on the wire**. Field names stay `sessionId` in Rust, IPC payloads, ts-rs types, and existing service methods (`service.kill({sessionId})` etc.). React-side `Pane.ptyId` aliases the same value.                                                                                                                                                                                                   | Smallest possible diff. Avoids `#[serde(rename)]` annotations and prevents bifurcation between wire format and React types. The "ptyId" name is a React-side semantic clarification, not an IPC change.                                                                                                                                                                                                                                                                        |
| 5   | Migration is one-shot (no feature flag, no dual-mode)                                                                                                                                                                                                                                                                                                                                                                                                     | Cleaner. Cached "Alive" PTYs from prior runs restore as 1-pane sessions in a single startup migration.                                                                                                                                                                                                                                                                                                                                                                         |
| 6   | Session.panes pre-populates pane state at creation time                                                                                                                                                                                                                                                                                                                                                                                                   | User pick: "create-time pre-fill all pane state". `createSession` for layout=single → `panes=[{id:'p0', active:true, …}]`. Avoids `?? default` scattered through derive logic.                                                                                                                                                                                                                                                                                                 |
| 7   | Active pane within session = `session.panes.find(p => p.active === true)`. **Invariant: EXACTLY one pane per session has `active === true`** at all times.                                                                                                                                                                                                                                                                                                | Per-session focus baked onto session itself (no `Map<sessionId, paneId>`). Tab switch reads `panes.find(active)`. The exactly-one invariant is enforced at session creation, migration, pane add/remove, and set-active operations — the derive helper does NOT need a fallback because invariant violations are bugs at the write site, not states to silently absorb.                                                                                                        |
| 8   | createSession spawns 1 pane (`layout='single'`) by default                                                                                                                                                                                                                                                                                                                                                                                                | 5a is data-model-only; multi-pane creation flows are 5b's concern.                                                                                                                                                                                                                                                                                                                                                                                                             |
| 9   | `TerminalPane/index.tsx` (step-4 chrome) takes new `pane: Pane` prop alongside `session`. Per-pane chrome metadata (`branch`, `±changes`) derives from `pane.cwd`, NOT from a session-level cwd (which no longer exists per Decision #2).                                                                                                                                                                                                                 | Step-4 chrome consumed session-level cwd via `useGitBranch(session.workingDirectory)` + `useGitStatus(session.workingDirectory)`. After 5a these become `useGitBranch(pane.cwd)` + `useGitStatus(pane.cwd)`, so each pane in a multi-cwd session shows its own branch + ±changes. Session-level chrome (name, lastActivityAt, status-aggregate) still flows from `session`.                                                                                                    |
| 10  | Rust agent-bridge directory naming stays `${cwd}/.vimeflow/sessions/${ptyId}/`                                                                                                                                                                                                                                                                                                                                                                            | Keeps backward compat with already-shipped `.vimeflow/sessions/` cache files. The directory name "sessions" was always a misnomer (the dirs are per-PTY); renaming to `panes/` would invalidate user disk state without payoff. Defer naming cleanup.                                                                                                                                                                                                                          |
| 11  | Two layers of callbacks, two key types: **(a) Rust-IPC callbacks** (`service.kill({sessionId})`, `service.onData((sessionId, data, off, len) => ...)`, `service.onExit((sessionId) => ...)`, `notifyPaneReady(sessionId, handler)` — all use `pane.ptyId` since the wire calls it `sessionId`); **(b) Public manager mutations** (`removeSession(sessionId)`, `restartSession(sessionId)`, `setActiveSessionId(sessionId)` — all use React `Session.id`). | Internal `useSessionManager` body translates between layers (`getActivePane(session).ptyId` for Rust-IPC sites). External chrome API (`TerminalPane.onCwdChange(cwd)`, `TerminalPane.onRestart(sessionId)` — Session.id) flows UP to `TerminalZone` → `WorkspaceView` → manager mutations using Session.id. `pane.id` (`'p0'`) is session-scoped layout-slot id, used neither in Rust IPC nor in workspace mutations — only in `session.panes` indexing and (5b) layout slots. |

## §1 Architecture — types + module decomposition

### Type shape: before vs after

**Before** — `src/features/sessions/types/index.ts`

```ts
// Existing — retained verbatim from src/features/sessions/types/index.ts (kebab-case AgentType — distinct from
// src/bindings/AgentType.ts which uses 'claudeCode'). The translation from binding-side 'claudeCode' to
// session-model 'claude-code' happens in the agent-status pipeline; 5a does not change it.
export type SessionStatus = 'running' | 'paused' | 'completed' | 'errored'
export type AgentType = 'claude-code' | 'codex' | 'aider' | 'generic'

export interface Session {
  id: string
  projectId: string
  name: string
  status: SessionStatus
  workingDirectory: string // [moves to Pane]
  agentType: AgentType // [moves to Pane]
  terminalPid?: number // [moves to Pane.pid]
  currentAction?: string // [stays on Session — aggregated across panes]
  createdAt: string
  lastActivityAt: string
  activity: AgentActivity
}
```

**After** — same file (`SessionStatus` + `AgentType` unchanged from current)

```ts
export type SessionStatus = 'running' | 'paused' | 'completed' | 'errored'
export type AgentType = 'claude-code' | 'codex' | 'aider' | 'generic'
export type LayoutId = 'single' | 'vsplit' | 'hsplit' | 'threeRight' | 'quad'

export interface Pane {
  /** Session-scoped pane id, e.g. `'p0'`, `'p1'`. Stable across re-renders;
   *  used to address the pane within `Session.panes`. NOT a Rust handle. */
  id: string

  /** Rust PTY handle. Equals what the Rust IPC layer calls `sessionId` on
   *  the wire. Used for every PTY operation: `kill`, `write`, `resize`,
   *  `restart`, `cwd_change`, etc. */
  ptyId: string

  /** Per-pane working directory. Drives chrome's `useGitBranch(pane.cwd)`
   *  and `useGitStatus(pane.cwd)`. Updated on OSC 7 events, mirrored to
   *  Rust via `updatePaneCwd(sessionId, paneId, cwd)` which internally
   *  calls `service.updateSessionCwd(pane.ptyId, cwd)`. */
  cwd: string

  /** Detected agent CLI for this pane, set by the agent-status detector
   *  (per-PTY). Stored in the session model's kebab-case form
   *  (`'claude-code'` etc.); the bindings-to-model translation lives in
   *  the agent-status hook. Reset to `'generic'` on PTY exit (see §3
   *  onExit flow). */
  agentType: AgentType

  /** Materialized pane status. Set ONLY at well-defined lifecycle
   *  transitions:
   *    - `'running'` at createSession + restartSession + restore (Alive)
   *    - `'completed'` at PTY exit (`usePtyExitListener` flow, §2)
   *    - `'completed'` at restore (Exited)
   *  5a does NOT continuously mirror `useTerminal().status` into
   *  `pane.status` — that hook's transient `'idle'` / `'error'` states
   *  stay local to the chrome's `pipStatus` derivation (step-4
   *  `ptyStatusToSessionStatus.ts`). `Session.status` (derived from
   *  `panes[]`) inherits the same {running, completed, errored}-mostly
   *  reality of the current code.
   *  See §4 risks for the deferred "fully-reactive pane.status" path. */
  status: SessionStatus

  /** Restoration buffer for buffered-event drain. Populated at restore time
   *  and on createSession. Consumed by the pane's `<Body>` when it mounts. */
  restoreData?: RestoreData

  /** OS process id of the PTY (was `Session.terminalPid?`). Optional —
   *  not all backends populate this (e.g., the in-browser MockTerminalService). */
  pid?: number

  /** Exactly one pane per session has `active === true` (Decision #7). */
  active: boolean
}

export interface Session {
  id: string
  projectId: string
  name: string

  /** Aggregate status. Derived from `panes[]` per
   *  `src/features/sessions/utils/sessionStatus.ts`:
   *    if any pane is 'running' → 'running'
   *    else if any pane is 'errored' → 'errored'
   *    else if every pane is 'completed' → 'completed'
   *    else → 'paused'
   *  Materialized on the session for sidebar/tab-strip rendering speed. */
  status: SessionStatus

  /** Per-session canvas layout. Default 'single' on createSession. */
  layout: LayoutId

  /** ≥1 pane per session (Decision #3). Created with one entry by
   *  `createSession`; layout grow/shrink (5b) maintains the count. */
  panes: Pane[]

  /** Existing field — retained at session level. Aggregated across
   *  panes (most-recent action wins) for the sidebar's "current action"
   *  hint. 5a doesn't change behaviour; 5b/6 may revisit. */
  currentAction?: string

  createdAt: string
  lastActivityAt: string
  activity: AgentActivity
}
```

### What moves, what stays

| Field                                 | Before  | After                                                                                             |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `Session.workingDirectory`            | session | **REMOVED** — accessed via `getActivePane(session).cwd`                                           |
| `Session.agentType`                   | session | **REMOVED** — `pane.agentType` per pane                                                           |
| `Session.terminalPid?`                | session | **MOVES** — `Pane.pid?` (per-PTY)                                                                 |
| `Session.currentAction?`              | session | **STAYS** on Session (aggregated across panes; 5a no behaviour change)                            |
| `Session.status`                      | session | **DERIVED** from panes (formula above)                                                            |
| `Session.id`                          | session | unchanged                                                                                         |
| `Session.name`                        | session | unchanged                                                                                         |
| `Session.{createdAt, lastActivityAt}` | session | unchanged (`lastActivityAt` aggregates panes' activity)                                           |
| `Session.activity`                    | session | unchanged for now (5a does NOT split per-pane activity tracking — out of scope; 5b/6 may revisit) |
| `RestoreData` map                     | manager | **MOVES** — `pane.restoreData?: RestoreData` (one-per-pane, naturally co-located)                 |

> Note: `Session.activity` (`AgentActivity`) stays session-level for 5a.
> Tool calls / file changes / test results are aggregated across all panes
> in the session for now. Splitting them per-pane is a 5b/6 refactor; not
> in scope here.

### Module decomposition — extracting `useSessionManager.ts`

`useSessionManager.ts` (~1247 LOC) currently conflates five distinct
concerns: mount-time restore, pty-data buffer drain, active-session
selection, auto-create-on-empty, and PTY exit handling — all alongside
the public mutation API (`createSession`, `removeSession`, etc.). Per
`rules/common/design-philosophy.md` (Deep Modules), each concern is
extracted to a sub-hook with a small interface that hides substantial,
coherent behavior. The remaining `useSessionManager` becomes a thin
composition + public API surface (~450 LOC).

This decomposition rides in the 5a PR because (a) the manager is
already being refactored end-to-end for the pane model, (b) the
extracted sub-hooks have clean seams in the existing code (each is a
self-contained `useEffect` block + its associated refs), and (c) post-5a
maintenance of the file is materially easier with concerns separated.
The pure utilities (`tabName`, `sessionFromInfo`, `sessionStatus`,
`activeSessionPane`, `emptyActivity`) extract to `utils/` and
`constants.ts`.

#### Sub-hooks (coherent concepts → small interfaces)

| Hook                         | Coherent concept                                                                           | Hidden complexity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Approx LOC |
| ---------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `usePtyBufferDrain`          | Per-PTY buffering accounting for pty-data between spawn and pane subscription              | Per-PTY gating (`pendingPanesRef` / `readyPanesRef`), `notifyPaneReady` with cleanup re-arm on StrictMode unmount, hidden-pane offset guards, drain ordering, race with `removeSession` during in-flight kill_pty. **Owns `bufferEvent`, `notifyPaneReady`, `registerPending`, `getBufferedSnapshot`, `dropAllForPty`** but **NOT** the `service.onData` listener — that lives in `useSessionRestore` so the listener-before-list_sessions ordering is enforceable.                                                                                                                                                                                                                                                                                                                                                                          | ~180       |
| `useSessionRestore`          | Restore session list from Rust cache on mount; attach buffer listener BEFORE list_sessions | Awaits `service.onData(buffer.bufferEvent)` BEFORE calling `service.listSessions()` (without this await, events arriving during listener-attach are lost from BOTH `replay_data` AND the buffer). Cancellation on unmount, restoreData seeding for Alive PTYs (calls `buffer.registerPending(ptyId)` + reads `buffer.getBufferedSnapshot(ptyId)` for the snapshot). **Merge-by-ptyId dedup** for the race-window between optimistic `createSession` (which may have spawned a PTY whose handle the in-flight `list_sessions` ALSO returns): when merging restored sessions with the in-memory state, if any restored ptyId equals an in-memory pane's `ptyId`, drop the restored entry — the optimistic in-memory session represents the user's most recent intent and already has a fresh React Session.id. Depends on `usePtyBufferDrain`. | ~180       |
| `useActiveSessionController` | Active-session selector with rollback safety                                               | Monotonic request-id token (`activeRequestIdRef`) so out-of-order IPC failures don't clobber newer user picks (Round 9 F4), `activeSessionIdRef` for closure-captured-stale guard against tab-switch-during-await. **Translates `setActiveSessionId(reactSessionId)` to `service.setActiveSession(getActivePane(session).ptyId)`** — Rust IPC continues to receive a PTY handle. Exposes `setActiveSessionIdRaw(reactSessionId)` for the restore-time write that bypasses the IPC roundtrip (Rust already has the right active value; this just syncs React state).                                                                                                                                                                                                                                                                          | ~95        |
| `useAutoCreateOnEmpty`       | Seed one session on clean launch                                                           | Once-after-restore policy with ref guard, post-failure re-fire when manual spawn fails (Round 12 F1: `pendingSpawns` is state, not ref), exit-status policy (post-crash all-Exited cache also triggers seed).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ~50        |
| `usePtyExitListener`         | Translate PTY exit events into pane status flips                                           | Subscription lifecycle, mapping arbitrary exit cause → `pane.status: 'completed'` (or `'errored'` once exit-status mapping lands per step-4 spec Open Question §exit-status — out of 5a scope). Hook signature: `({ service, onExit: (ptyId: string) => void })`. The hook passes only `ptyId` (matches `service.onExit` event). The manager-supplied `onExit` callback generates `exitedAt = new Date().toISOString()` at handler time (no timestamp on service event), finds the session containing the matching ptyId, flips that pane's status + resets `agentType` to `'generic'`, and re-derives `Session.status`.                                                                                                                                                                                                                     | ~35        |

After extraction, `useSessionManager` retains the public `SessionManager`
interface (~12 fields) and composes the sub-hooks. The mutation methods
(`createSession`, `removeSession`, `restartSession`, `renameSession`,
`reorderSessions`, `updatePaneCwd`, `updatePaneAgentType`) all live in
the manager because they coordinate React state + IPC + pane bookkeeping
and don't form an independent coherent concept worth extracting.

> Why these and not others. The five sub-hooks above each have ≥30 LOC
> of internal state + effect lifetime they own; their callers don't need
> to sequence the steps. Pulling out single 5-line helpers would be the
> shallow fragmentation `design-philosophy.md` warns against.

#### Public API of `useSessionManager` after decomposition

```ts
export const useSessionManager = (
  service: ITerminalService,
  options: UseSessionManagerOptions = {}
): SessionManager => {
  const [sessions, setSessions] = useState<Session[]>([])
  const sessionsRef = useRef(sessions); sessionsRef.current = sessions

  // Buffer FIRST — restore depends on it (listener-attach calls buffer.bufferEvent).
  const buffer = usePtyBufferDrain({ service })
  // Restore receives the cached active ptyId from Rust and resolves it to a
  // React Session.id (lookup: which session has a pane with that ptyId).
  // Communicates the resolved React Session.id via onActiveResolved.
  const restore = useSessionRestore({
    service,
    buffer,
    onRestore: setSessions,
    onActiveResolved: (sessionId) => active.setActiveSessionIdRaw(sessionId),
  })
  const active = useActiveSessionController({ service, sessionsRef })

  usePtyExitListener({
    service,
    onExit: (sessionId) => setSessions(prev => /* flip status to completed */),
  })

  // Manager-owned: pane-keyed mutations.
  const createSession = useCallback(/* … */, [service, active.setActiveSessionId])
  const removeSession = useCallback(/* … */, [service, active.setActiveSessionId])
  // … restartSession / renameSession / reorderSessions / updatePaneCwd / updatePaneAgentType …

  useAutoCreateOnEmpty({
    enabled: options.autoCreateOnEmpty ?? true,
    loading: restore.loading,
    hasLiveSession: sessions.some(s => s.status === 'running'),
    pendingSpawns,
    createSession,
  })

  return {
    sessions,
    activeSessionId: active.activeSessionId,
    setActiveSessionId: active.setActiveSessionId,
    createSession, removeSession, restartSession, renameSession,
    reorderSessions, updatePaneCwd, updatePaneAgentType,
    loading: restore.loading,
    notifyPaneReady: buffer.notifyPaneReady,
  }
}
```

The interface stays at 12 fields (renamed `updateSessionCwd` →
`updatePaneCwd`, `updateSessionAgentType` → `updatePaneAgentType` to
reflect the pane-keyed parameters). `restoreData: Map<sessionId,
RestoreData>` is REMOVED from the public surface — `restoreData` is now
an internal field of `Pane`, accessed via `pane.restoreData`. Consumers
(`TerminalZone`) read `pane.restoreData` directly instead of looking up
in a manager-exposed map.

### File-level scope

| File                                                                  | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | LOC delta               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `src/features/sessions/types/index.ts`                                | Add `Pane`, `LayoutId`. Modify `Session` (remove `workingDirectory`, `agentType`; add `layout`, `panes`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | +~50, -~5               |
| `src/features/sessions/constants.ts` (new)                            | Move `emptyActivity` constant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | +~15                    |
| `src/features/sessions/utils/tabName.ts` (new)                        | Pure: cwd → tab name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | +~15                    |
| `src/features/sessions/utils/sessionFromInfo.ts` (new)                | Pure: Rust `SessionInfo` → 1-pane `Session`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | +~50                    |
| `src/features/sessions/utils/sessionStatus.ts` (new)                  | Pure: derive aggregate `Session.status` from `Pane[]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | +~30                    |
| `src/features/sessions/utils/activeSessionPane.ts` (new)              | Pure: assert exactly-one invariant + return active pane.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | +~25                    |
| `src/features/sessions/hooks/useSessionRestore.ts` (new)              | Mount-time restore orchestration extracted from manager.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | +~150                   |
| `src/features/sessions/hooks/useActiveSessionController.ts` (new)     | Active-session selector + monotonic request-id token.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | +~80                    |
| `src/features/sessions/hooks/useAutoCreateOnEmpty.ts` (new)           | Once-after-restore seed policy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | +~50                    |
| `src/features/terminal/orchestration/usePtyBufferDrain.ts` (new)      | pty-data buffer drain orchestrator.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | +~200                   |
| `src/features/terminal/hooks/usePtyExitListener.ts` (new)             | onExit subscription + status flip.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | +~30                    |
| `src/features/terminal/types/index.ts` (extend)                       | Move `RestoreData`, `PaneEventHandler`, `NotifyPaneReadyResult` here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | +~30                    |
| `src/features/sessions/hooks/useSessionManager.ts`                    | Refactor: compose extracted sub-hooks. Remove inlined orchestration. Mutations updated to pane-keyed API. Manager file ends ~450 LOC.                                                                                                                                                                                                                                                                                                                                                                                                                                                       | -~800, +~50 (net -~750) |
| `src/features/workspace/WorkspaceView.tsx`                            | Update consumers of the renamed manager API: `updatePaneCwd(activeSessionId, activePane.id, cwd)`, `updatePaneAgentType(activeSessionId, activePane.id, agentType)`. The agent-status hook re-keys to `useAgentStatus(activePane?.ptyId ?? null)` so detector lookup matches the Rust handle. The bridge effect's comparison changes from `agentStatus.sessionId === activeSessionId` to `agentStatus.sessionId === activePane?.ptyId` (both are now ptyIds). Drop public `restoreData` reference; pane-level restoreData lives on `pane.restoreData` and `TerminalZone` reads it directly. | +~35, -~25              |
| `src/features/workspace/components/TerminalZone.tsx`                  | Iterate `sessions` for outer hide/show; pass `getActivePane(session)` (NOT `panes[0]`) to `<TerminalPane>` per session in 5a (single-pane only — only the active pane renders, others mount but stay hidden). 5b expands the rendering to all panes via SplitView.                                                                                                                                                                                                                                                                                                                          | +~25, -~10              |
| `src/features/terminal/components/TerminalPane/index.tsx`             | Accept `pane: Pane` prop. Internal references to `cwd`, `mode`-derivation, ID handles → pane-keyed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | +~30, -~15              |
| `src/features/terminal/components/TerminalPane/Header.tsx`            | `useGitBranch(pane.cwd)`, `useGitStatus(pane.cwd)` (was `session.workingDirectory`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | +~5, -~5                |
| `src/features/terminal/components/TerminalPane/Body.tsx`              | `useTerminal(pane.ptyId)` (was `session.id`); `terminalCache` keyed by `ptyId`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | +~10, -~10              |
| `src/features/terminal/components/TerminalPane/RestartAffordance.tsx` | `onRestart(pane.ptyId)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | +~5, -~5                |
| `src/features/terminal/ptySessionMap.ts`                              | NO API change. Internal docs note the keys are PTY handles (semantic only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | +~3, -~3                |
| `src/bindings/*.ts` (ts-rs generated)                                 | NO CHANGE.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 0                       |
| `src-tauri/src/**`                                                    | NO CHANGE.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 0                       |

**Total:** ~+880, -~865 LOC across ~21 files. Net ~+15 LOC overall
(decomposition shifts mass into focused files). Average new-file size:
~70 LOC — each cohesive around its concept, none a pass-through wrapper.

`useSessionManager.ts` post-extraction: ~450 LOC (down from ~1247),
well within the 200-400 typical / 800 max budget per
`rules/common/coding-style.md`.

### Identification namespaces

Three distinct id systems coexist after 5a; clarity prevents bugs:

| Namespace    | Where                   | Lifetime                       | Used for                                                                                                                                                                                                           |
| ------------ | ----------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session.id` | React workspace state   | Whole session lifetime         | Tab strip, sidebar, `activeSessionId`, `aria-labelledby`, session order persistence.                                                                                                                               |
| `pane.id`    | `Session.panes[].id`    | Pane lifetime within a session | Layout slot mapping (`'p0'` → grid area), `active` flag tracking, `focusedPaneId` (5b).                                                                                                                            |
| `pane.ptyId` | `Session.panes[].ptyId` | Pane PTY lifetime              | Rust IPC: `kill({sessionId: ptyId})`, `write_pty`, `resize_pty`, `terminalCache.get(ptyId)`, agent detection (`registerPtySession(ptyId, ptyId, cwd)`), all callbacks (`onPaneReady`, `onCwdChange`, `onRestart`). |

> `pane.ptyId` and `session.id` are **independent values** post-5a.
> `session.id` is generated client-side by `useSessionManager` (UUID); a
> `ptyId` comes from Rust's `spawn_pty` response. **Migration note:**
> existing cached sessions had `session.id === pty handle` because they
> were 1:1; on 5a's first launch, the restore path generates a fresh
> `Session.id` (UUID) and stores the cached handle as `panes[0].ptyId`.
> The Rust cache's `active_session_id` field is read as a ptyId — the
> restore path finds the session whose `panes[0].ptyId` matches and
> sets `activeSessionId` to that React Session UUID. Going forward
> (post-5a), code that confuses the two (e.g. passes `session.id` to
> `service.kill`) silently no-ops in Rust (handle not found) — to be
> caught by tests, NOT runtime fallbacks. Lint helpers: a typed
> wrapper `service.kill({sessionId: pane.ptyId})` makes the parameter
> shape obvious at every call site.

## §2 Pane lifecycle

### createSession (default: 1-pane single-layout)

```ts
createSession(): void
```

Flow (in manager; spawn-then-bookkeeping pattern carried over from current code):

1. `setPendingSpawns(c => c + 1)` (round-12 F1: state, not ref).
2. `result = await service.spawn({ cwd: '~', env: {}, enableAgentBridge: true })`
   → `{ sessionId: ptyId, pid, cwd }`.
3. Build a 1-pane Session with `panes = [{
  id: 'p0',
  ptyId: result.sessionId,
  cwd: result.cwd,
  agentType: 'generic',
  status: 'running',
  active: true,
  restoreData: { sessionId: result.sessionId, cwd: result.cwd, pid: result.pid,
                 replayData: '', replayEndOffset: 0, bufferedEvents: [] },
}]`, `layout: 'single'`, `id: <fresh UUID>`.
4. `buffer.registerPending(result.sessionId)`.
5. `setSessions(prev => [newSession, ...prev])` via `flushSync` (round-9 F6 — capture
   `computedNewOrder = next.map(s => s.panes[0].ptyId)` for the IPC fire OUTSIDE the
   updater). The order Rust persists is keyed by ptyIds (the wire-level "sessionId"),
   not by React `Session.id`. 5a is single-pane so `panes[0].ptyId` always exists;
   5b will need to revisit when sessions hold multiple ptyIds.
6. `service.reorderSessions(computedNewOrder).catch(...)` — persists order (ptyIds).
7. `active.setActiveSessionId(newSession.id)` — translates inside the controller to
   `service.setActiveSession(panes[0].ptyId)`.
8. `registerPtySession(result.sessionId, result.sessionId, result.cwd)`.
9. `finally`: `setPendingSpawns(c => c - 1)`.

> The IDs `result.sessionId` (Rust) and `newSession.id` (React) are the two
> values referred to as "the session id" in the old code. After 5a they're
> kept distinct: the spawn result's `sessionId` is treated as a ptyId everywhere
> downstream; `newSession.id` is freshly generated for React workspace state.

### removeSession (drops the entire session, kills all panes' PTYs)

```ts
removeSession(sessionId: string): void  // sessionId = React Session.id
```

Flow:

1. Look up session in `sessionsRef.current`. If not found, log + bail.
2. **Kill every pane's PTY**: `const results = await Promise.allSettled(
session.panes.map(p => service.kill({ sessionId: p.ptyId })))`. Current
   code's `kill` is idempotent in Rust (KillError::NotPresent collapses to Ok),
   but real failures (cache mutation error, child.kill syscall failure) can
   still reject. `allSettled` ensures: every pane is at least ATTEMPTED; React
   bookkeeping (step 3) runs unconditionally so we don't leak per-pane state
   even when some kills failed; rejected entries are logged via
   `console.warn`. Sequence preserved: the React state drop in step 4 only
   fires after every kill has settled — no React/Rust divergence where the
   tab disappears but a PTY is still running.
3. Drop bookkeeping per pane: `for (p of session.panes) {
  buffer.dropAllForPty(p.ptyId);
  unregisterPtySession(p.ptyId);
}`.
4. Drop session from React state via `flushSync(setSessions(...))` with
   activeSessionId follow-up logic preserved from current code (round-9 F2,
   round-10, round-13 codex P2: read latest active id from `activeSessionIdRef`,
   advance to neighbor session if needed, route through
   `active.setActiveSessionId` for the guarded helper).

> 5a: only one pane per session in practice (Decision #8). The
> `session.panes.map(...)` form is forward-compatible with 5b's multi-pane
> sessions where multiple PTYs need to be killed.

### restartSession (spawn-then-kill; preserves session.id)

```ts
restartSession(sessionId: string): void  // sessionId = React Session.id
```

Flow (preserves the current spawn-then-kill ordering — round-4 F2):

1. Look up session + its active pane. Capture `oldPane` and `cachedCwd =
oldPane.cwd`.
2. `result = await service.spawn({ cwd: cachedCwd, env: {}, enableAgentBridge: true })`.
   On failure: bail, leaving the old pane intact (still 'completed', restartable
   on a later attempt).
3. `await service.kill({ sessionId: oldPane.ptyId })`. On failure: kill the new
   orphan PTY + bail (round-13 codex P2). React state untouched.
4. Drop bookkeeping for old ptyId: `buffer.dropAllForPty(oldPane.ptyId);
unregisterPtySession(oldPane.ptyId)`.
5. Seed buffer + ptySessionMap for new ptyId: `buffer.registerPending(result.sessionId);
registerPtySession(result.sessionId, result.sessionId, result.cwd)`.
6. Replace the pane in `session.panes` (preserve `pane.id` = `'p0'` for layout-slot
   stability), updating `ptyId`, `cwd`, `status: 'running'`, `agentType: 'generic'`
   (round-12 F-c5-3 fresh-spawn parity), and seeding empty `restoreData`. Use
   `flushSync` (round-9 F6) to capture `computedNewOrder = next.map(s => s.panes[0].ptyId)`
   before the IPC fire.
7. `service.reorderSessions(computedNewOrder).catch(...)` — ptyIds persisted to Rust.
8. **`session.id` does NOT change** — only the inner `pane.ptyId` rotates. React
   consumers keyed by `session.id` (Tab strip, Sidebar) see no churn.
9. If the restarted session was active, `active.setActiveSessionId(session.id)` —
   the controller translates to `service.setActiveSession(newPtyId)`.

> Behavior change vs current code: previously `Session.id` rotated to the new
> ptyId on restart, forcing every keyed consumer to remount. Post-5a the React
> `Session.id` is stable across restart; only `panes[0].ptyId` changes. **This
> fixes a long-standing minor regression** where session-keyed UI state
> (e.g., scroll position in the sidebar's session row) reset on restart.

### onExit (PTY exit handler, via `usePtyExitListener`)

```ts
usePtyExitListener({
  service,
  onExit: (ptyId: string) => void,    // hook itself passes only ptyId
})
```

> The underlying `service.onExit` event provides `(sessionId)` — a ptyId. It
> does NOT provide an exit timestamp. The manager generates `exitedAt =
new Date().toISOString()` inside its `onExit` handler at the moment the
> event arrives (matching current code in useSessionManager.ts at line 372).

Manager-supplied `onExit` callback flow:

1. Compute `exitedAt = new Date().toISOString()` (manager-side, NOT from
   service event payload).
2. Find the session containing a pane with `pane.ptyId === ptyId` via
   `sessionsRef.current`. If none (session was already removed): no-op.
3. Build new `panes` array: replace the matching pane with `{ ...pane, status:
'completed', agentType: 'generic' /* reset on exit per Pane.agentType
contract */, /* errored mapping deferred to step-4 Open Question §exit-status */ }`.
4. `setSessions(prev => prev.map(s => s.id === target.id
  ? { ...s, panes: newPanes, status: deriveSessionStatus(newPanes), lastActivityAt: exitedAt }
  : s
))`.
5. **Active flag preserved on the dead pane.** `pane.active === true` stays —
   the user's per-session focus memory is independent of pane liveness. Step-4
   chrome's `RestartAffordance` renders inside the now-`'completed'` pane and
   the next user click anywhere else updates `active`.

### updatePaneCwd / updatePaneAgentType (renamed from updateSession\*)

```ts
updatePaneCwd(sessionId: string, paneId: string, cwd: string): void
updatePaneAgentType(sessionId: string, paneId: string, agentType: AgentType): void
```

Behaviour parity with the methods they rename:

- **`updatePaneCwd`** — optimistic React update + IPC fire-and-forget (was
  `updateSessionCwd`). Calls `service.updateSessionCwd(pane.ptyId, cwd)`
  internally. Rust IPC method names unchanged per Decision #4.
- **`updatePaneAgentType`** — **in-memory only, no IPC** (matches current
  `updateSessionAgentType` behaviour). The agent-status detector is the
  authority on agent type; this method just mirrors detector results into
  `Pane.agentType` for chrome consumption.

### Per-pane `lastActivityAt` aggregation

5a does NOT add `pane.lastActivityAt`; activity is still tracked at the
session level (`Session.lastActivityAt`). `Session.lastActivityAt` updates
whenever any pane has activity (createSession, restart, exit, agent-type
change). 5b/6 may revisit if per-pane RelTime ticking proves valuable.

## §3 Component APIs

### Public `SessionManager` interface (final, post-decomposition)

```ts
// src/features/sessions/hooks/useSessionManager.ts

export interface SessionManager {
  /** Workspace's session list. Stable identity in the function-result map;
   *  individual sessions update via setSessions. */
  sessions: Session[]

  /** React Session UUID, or null when no sessions exist. NOT a ptyId. */
  activeSessionId: string | null

  /** Optimistic-update + IPC. Rolls back on failure unless a newer
   *  setActive request has superseded (round-9 F4 monotonic token). */
  setActiveSessionId: (id: string) => void

  /** Spawns 1 PTY at `~`, builds a 1-pane Session with a fresh UUID,
   *  prepends to sessions[], promotes it to active. */
  createSession: () => void

  /** Kills every pane's PTY in the session, drops the session from
   *  React state, advances active to a neighbor or null. */
  removeSession: (sessionId: string) => void

  /** Spawn-then-kill the active pane's PTY. Preserves session.id and
   *  pane.id; only ptyId rotates. See §2 restartSession. */
  restartSession: (sessionId: string) => void

  /** In-memory only; no IPC. */
  renameSession: (sessionId: string, name: string) => void

  /** Optimistic + IPC. Persists Rust order via reorderSessions(ptyIds). */
  reorderSessions: (reordered: Session[]) => void

  /** Was updateSessionCwd. Optimistic + IPC. */
  updatePaneCwd: (sessionId: string, paneId: string, cwd: string) => void

  /** Was updateSessionAgentType. In-memory only. */
  updatePaneAgentType: (
    sessionId: string,
    paneId: string,
    agentType: AgentType
  ) => void

  /** True until mount-time restore completes. Forwarded from
   *  useSessionRestore. */
  loading: boolean

  /** Drains buffered pty-data on pane mount. Forwarded from
   *  usePtyBufferDrain. Called by `<TerminalPane>` once its live
   *  subscription is attached. Returns a release callback (the
   *  `NotifyPaneReadyResult` type) for the pane's effect-cleanup. */
  notifyPaneReady: (
    sessionId: string, // ptyId on the wire (Decision #4)
    handler: PaneEventHandler
  ) => NotifyPaneReadyResult
}
```

**Removed from public surface:**

- `restoreData: Map<string, RestoreData>` — replaced by `pane.restoreData`. `TerminalZone` reads `pane.restoreData` directly per pane.

**Renamed:**

- `updateSessionCwd` → `updatePaneCwd` (extra `paneId` parameter)
- `updateSessionAgentType` → `updatePaneAgentType` (extra `paneId` parameter)

**Added:** none. Field count: was 13 (including public `restoreData: Map`),
now 12 (after `restoreData` removal + the two renames). Net contract
strictly narrower.

### `TerminalZone` props + render flow

```ts
// src/features/workspace/components/TerminalZone.tsx

export interface TerminalZoneProps {
  sessions: Session[]
  activeSessionId: string | null
  onSessionCwdChange?: (sessionId: string, paneId: string, cwd: string) => void
  loading?: boolean
  onPaneReady?: (
    sessionId: string,
    handler: PaneEventHandler
  ) => NotifyPaneReadyResult
  onSessionRestart?: (sessionId: string) => void
  service: ITerminalService
}
```

**What changed (props):**

- `restoreData?: Map<string, RestoreData>` — REMOVED. Pane carries its own.
- `onSessionCwdChange?` signature gains a `paneId` parameter.

**Render flow (5a, single-pane only):**

```tsx
sessions.map((session) => {
  const isActive = session.id === activeSessionId
  const activePane = getActivePane(session) // exactly-one invariant
  const mode: TerminalPaneMode =
    activePane.status === 'completed' || activePane.status === 'errored'
      ? 'awaiting-restart'
      : activePane.restoreData
        ? 'attach'
        : 'spawn'

  return (
    <div className={isActive ? '' : 'hidden'} data-session-id={session.id}>
      <TerminalPane
        session={session}
        pane={activePane}
        service={service}
        mode={mode}
        onCwdChange={(cwd) =>
          onSessionCwdChange?.(session.id, activePane.id, cwd)
        }
        onPaneReady={onPaneReady}
        onRestart={onSessionRestart}
        isActive={isActive}
      />
    </div>
  )
})
```

> 5a still renders ONLY the active pane per session (parity with current
> behavior — `display:none` on inactive sessions). 5b's `<SplitView>`
> replaces this section to render `session.panes.map(...)` per the active
> session's `layout`, with non-active sessions still hidden.

### `TerminalPane` (step-4 chrome) — prop extension

```ts
// src/features/terminal/components/TerminalPane/index.tsx

export interface TerminalPaneProps {
  // EXISTING — unchanged
  session: Session
  isActive: boolean
  service: ITerminalService
  mode?: TerminalPaneMode
  onPaneReady?: (
    sessionId: string,
    handler: PaneEventHandler
  ) => NotifyPaneReadyResult
  onClose?: (sessionId: string) => void

  // EXISTING — kept; signatures clarified
  /** Called when xterm emits an OSC 7 cwd-change event. Forwarded by the
   *  chrome to its parent (TerminalZone), which invokes
   *  `onSessionCwdChange(session.id, pane.id, cwd)`. */
  onCwdChange?: (cwd: string) => void

  /** Called when the user clicks Restart on an awaiting-restart pane.
   *  Receives `session.id` (the React Session UUID), NOT pane.ptyId —
   *  matches the public `restartSession` API on the manager. */
  onRestart?: (sessionId: string) => void

  // NEW — pane-level data
  pane: Pane

  // REMOVED from props — chrome derives from `pane`:
  //   cwd:           use pane.cwd
  //   sessionId:     use pane.ptyId for IPC, session.id for React-keyed state
  //   restoredFrom:  use pane.restoreData
}
```

> The `onCwdChange(cwd)` and `onRestart(sessionId)` props stay on
> `TerminalPaneProps` — they're parent-supplied callbacks, not derivable
> from `pane`. What's removed are the SHAPE-only props (`cwd`,
> `sessionId`, `restoredFrom`) whose values now live on `pane`.

**Internal derivations updated:**

- `useGitBranch(pane.cwd)` and `useGitStatus(pane.cwd)` (was
  `session.workingDirectory`).
- `useTerminal(pane.ptyId)` (was `session.id`).
- `terminalCache` keyed by `pane.ptyId` (was `session.id`).
- `RestartAffordance.onRestart(session.id)` — bubbles up to the
  `TerminalPaneProps.onRestart` callback, which is wired by `TerminalZone`
  to `useSessionManager.restartSession(sessionId)`. The Rust-side
  `service.spawn` / `service.kill` calls inside `restartSession` use
  `oldPane.ptyId` (Decision #11 layer-(a) IPC callbacks).

The step-4 spec's `useFocusedPane` continues to work unchanged — focus
is local to the pane container. 5b lifts focus to a workspace-level
focusedPaneId; 5a does not.

### `ITerminalService` — no change

The service interface (`src/features/terminal/services/terminalService.ts`)
remains identical. Method names continue to use `sessionId` parameter
naming because that matches Rust IPC. Caller code passes `pane.ptyId`
into those parameters — the rename is React-side semantic only, per
Decision #4.

### `ptySessionMap` — semantic rename only

`src/features/terminal/ptySessionMap.ts` continues to expose
`registerPtySession(sessionId, ptyId, cwd)`, `unregisterPtySession(sessionId)`,
`getAllPtySessionIds()`. The "sessionId" parameter is documented to be a
PTY handle (and was always called with a ptyId-equal value). Internal
JSDoc updates clarify this; no code paths change.

## §4 Migration mechanics, testing, risks

### Migration flow on first launch with cached state

Existing users have a Rust cache populated with the old `SessionInfo` shape
(per-PTY entries treated as sessions). 5a's restore flow translates that on
first launch:

1. `service.onData(buffer.bufferEvent)` attaches BEFORE `list_sessions`
   (existing code's listener-first invariant; preserved).
2. `service.listSessions()` returns `{ sessions: SessionInfo[],
activeSessionId: string }`. Both fields use Rust's session-id
   terminology, which IS the ptyId per Decision #4.
3. For each `info: SessionInfo`:
   - Generate fresh `Session.id = crypto.randomUUID()`.
   - **Alive case** (`info.status.kind === 'Alive'`): Build `panes:
[{ id: 'p0', ptyId: info.id, cwd: info.cwd, agentType: 'generic',
status: 'running', active: true, restoreData: { sessionId: info.id,
cwd: info.cwd, pid: info.status.pid, replayData:
info.status.replay_data, replayEndOffset:
Number(info.status.replay_end_offset), bufferedEvents:
buffer.getBufferedSnapshot(info.id) }, pid: info.status.pid }]`,
     `layout: 'single'`. Then `buffer.registerPending(info.id)` and
     `registerPtySession(info.id, info.id, info.cwd)`.
   - **Exited case** (`info.status.kind !== 'Alive'`): Build `panes:
[{ id: 'p0', ptyId: info.id, cwd: info.cwd, agentType: 'generic',
status: 'completed', active: true, restoreData: undefined,
pid: undefined }]`, `layout: 'single'`. No `buffer.registerPending`
     (no live PTY). No `registerPtySession` (no PTY to detect agent on).
     The pane shows `RestartAffordance` from step-4 chrome until the
     user clicks Restart.
   - Both cases produce a renderable Session; a session is never
     restored without a pane (≥1 invariant per Decision #3).
4. **Resolve active session.** `list.activeSessionId: string | null`.
   - **Non-null case**: find session whose `panes[0].ptyId ===
list.activeSessionId`. If found, call `onActiveResolved(matched.id)`.
     If NOT found (cache referenced a ptyId no longer present, e.g.
     because it was killed in a graceful-exit cleanup race): fall through
     to null case.
   - **Null case (or no-match)**: if any session was restored, set
     `activeSessionId = restoredSessions[0].id` (first in cached order).
     If zero sessions were restored, `activeSessionId = null` (auto-create
     fires per `useAutoCreateOnEmpty`'s policy).
   - All paths use `setActiveSessionIdRaw` (no IPC) since Rust already
     persists the cached active value or null.
5. **Merge with optimistic in-memory sessions** (race window): if user
   called `createSession` during the load window, a fresh PTY may
   already be in `sessions[]` AND in `list.sessions`. Merge rule:
   restored sessions whose `panes[0].ptyId` matches an in-memory pane's
   `ptyId` are DROPPED — optimistic state wins, matching the existing
   F2-round-2 alignment.

### Cache compat (no Rust changes)

Rust cache schema is untouched. The existing cache file format
(`active_session_id: ptyId`, `session_order: ptyId[]`,
`sessions: HashMap<ptyId, SessionInfo>`) continues to work because:

- React's persisted "session order" is stored as ptyIds (what gets
  passed to `service.reorderSessions`), so cache continues to track
  ptyId order.
- Active session id in cache is a ptyId; React maps it to `Session.id`
  on restore via the panes[].ptyId lookup above.

No migration script needed. First-launch with cached state Just Works.

### Suggested commit slicing within the 5a PR

The PR is large (~+880 / -865 LOC across ~21 files). Suggested commit
shape for reviewability:

1. `refactor(sessions): extract helpers (tabName, sessionFromInfo,
sessionStatus, activeSessionPane, emptyActivity)` — pure utility
   moves, no behaviour change. Adds the `Pane` + `LayoutId` types
   minimally. Existing `useSessionManager` continues to ignore them.
2. `refactor(sessions): extract sub-hooks (useSessionRestore,
usePtyBufferDrain, useActiveSessionController, useAutoCreateOnEmpty,
usePtyExitListener)` — manager file shrinks; behaviour preserved.
   Each new hook gets its own test file.
3. `refactor(sessions): introduce per-session panes[]` — Session shape
   migration. createSession, removeSession, restartSession, exit handler
   adopt pane-keyed flows. Restore generates fresh UUIDs +
   `getActivePane` consumers.
4. `refactor(terminal): TerminalPane consumes pane prop` — chrome
   re-targets to `pane.cwd`, `pane.ptyId`, `pane.restoreData`. Header
   uses `useGitBranch(pane.cwd)` etc. TerminalZone passes `getActivePane`.
5. `refactor(workspace): WorkspaceView consumers updated` — agent-status
   bridge re-keyed to `activePane.ptyId`. `updatePaneCwd`/`updatePaneAgentType`
   call sites updated.
6. `chore(sessions): update tests + types` — any residual test fixtures,
   ts-rs generated bindings unchanged but verified.

Each commit ships green: `vitest run` passes, ESLint clean. The
pre-push hook gates regressions per `.husky/pre-push`.

### Testing approach

Per `rules/typescript/testing/CLAUDE.md` — `test()` not `it()`,
co-located test files, query priority `getByRole > getByLabelText >
getByText > getByTestId`, 80% minimum coverage.

| Test                                              | Surface                                                                                                                                                                       | jsdom + xterm?   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `sessionFromInfo.test.ts` (new)                   | Pure: `info → Session` with `panes=[{id:'p0', ptyId:info.id, cwd:info.cwd, active:true, restoreData:..., pid:info.status.pid}]`.                                              | No               |
| `sessionStatus.test.ts` (new)                     | Pure: derive aggregate `Session.status` from `Pane[]` for each combination (running/paused/completed/errored mixes).                                                          | No               |
| `activeSessionPane.test.ts` (new)                 | Pure: returns the active pane; throws on zero or >1 active panes.                                                                                                             | No               |
| `useSessionRestore.test.ts` (new)                 | Listener-attach-before-list invariant; cancellation on unmount; ptyId-dedup merge with in-memory sessions; loading flag.                                                      | No               |
| `usePtyBufferDrain.test.ts` (new)                 | bufferEvent gated by readyPanesRef; notifyPaneReady drains + flips gate; cleanup re-arm on remount; dropAllForPty cleanup.                                                    | No               |
| `useActiveSessionController.test.ts` (new)        | Monotonic request-id token — out-of-order failures don't clobber newer picks; setActiveSessionIdRaw bypasses IPC.                                                             | No               |
| `useAutoCreateOnEmpty.test.ts` (new)              | Once-after-restore policy; post-failure re-fire when manual spawn fails; defers when pendingSpawns > 0.                                                                       | No               |
| `usePtyExitListener.test.ts` (new)                | onExit fires for ptyId; manager-supplied callback updates pane status + agentType reset.                                                                                      | No               |
| `useSessionManager.test.ts` (existing, updated)   | Manager composition; createSession spawns + builds 1-pane Session with fresh UUID; removeSession kills all panes; restart preserves session.id; reorderSessions sends ptyIds. | No               |
| `TerminalZone.test.tsx` (existing, updated)       | Iterates sessions; renders `getActivePane(session)`, mode derivation from active pane status; 5a still hides non-active sessions.                                             | No               |
| `TerminalPane/index.test.tsx` (existing, updated) | Accepts `pane: Pane` prop; passes pane.ptyId to Body; passes pane.cwd to Header; onCwdChange/onRestart preserved.                                                             | No (Body mocked) |
| `TerminalPane/Body.test.tsx` (existing, updated)  | `useTerminal(pane.ptyId)` (was `session.id`); terminalCache keyed by ptyId.                                                                                                   | Yes              |
| `WorkspaceView.test.tsx` (existing, updated)      | Agent-status bridge keyed by `activePane.ptyId`; `updatePaneCwd`/`updatePaneAgentType` call shapes.                                                                           | No               |

**What deliberately not tested:**

- Type-only definitions (TypeScript compiles them; `tsc -b` in CI).
- `ITerminalService` IPC roundtrip (E2E suite covers Tauri integration).
- ts-rs bindings (auto-generated; checked in for review).
- Visual regression (no UI change; 5b's SplitView gets the visual tests).

### Risks & mitigations

| Risk                                                                                                 | Mitigation                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing `Session.id === ptyId` callers passing `session.id` to `service.kill` post-5a               | Type-level migration: `Pane.ptyId` is a distinct field; auditing call sites for `service.kill({ sessionId: ... })` against typed `pane.ptyId` catches misuses. `useSessionManager.test.ts` integration test covers the pane→ptyId resolution path. |
| Restore race: optimistic createSession during load + listSessions returning that same ptyId          | Merge-by-ptyId dedup in `useSessionRestore` (§§1, 4). Tests cover the race: spawn during loading=true → list_sessions returns the new ptyId → merge drops the restored entry.                                                                      |
| Module decomposition introduces hook ordering bugs (e.g., useSessionRestore reads buffer too early)  | Composition explicit in `useSessionManager`: buffer FIRST, then restore (which captures `buffer.bufferEvent` reference). Refs created by `usePtyBufferDrain` are stable across renders, so the captured reference always points to current state.  |
| `flushSync` usage in extracted sub-hooks may regress StrictMode-double-invoke behaviour              | Sub-hooks that mutate sessions (createSession, removeSession, restartSession) stay in the manager — they don't extract. The extracted sub-hooks own only their own ref state + effects, no `flushSync` needed.                                     |
| `TerminalPane/Body.tsx`'s `terminalCache` re-keyed from `session.id` to `pane.ptyId` orphans entries | One-shot migration: existing cache entries (keyed by old `session.id` which equalled ptyId) are still valid post-5a — keys ARE ptyIds, just under a new name. No cache wipe needed.                                                                |
| Agent-status detector mismatches: detector returns ptyId from Rust; consumer expects session.id      | `useAgentStatus(activePane?.ptyId ?? null)` matches the Rust-side handle. WorkspaceView's bridge effect compares `agentStatus.sessionId === activePane?.ptyId` (both ptyIds). `useAgentStatus.test.ts` covers the keyed input.                     |
| Cache file accumulates stale ptyIds for sessions React no longer tracks                              | Reorder + remove-session paths drop ptyIds from Rust cache via existing IPCs (`reorderSessions(ptyIds)`, `kill_pty(ptyId)`). No new staleness mode introduced.                                                                                     |

### References

- Issue: TBD (sibling of #164; 5b inherits #164)
- Migration spec: `docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md`
- Step 4 (chrome wrapper this builds on): `docs/superpowers/specs/2026-05-08-step-4-terminal-pane-handoff-design.md`
- Visual reference: `docs/design/handoff/README.md` §4.5–4.6, §5.1–5.3
- Design philosophy (deep modules guidance): `rules/common/design-philosophy.md`
- Coding-style file budgets: `rules/common/coding-style.md`
- Existing implementation:
  - `src/features/sessions/hooks/useSessionManager.ts` (~1247 LOC, refactored)
  - `src/features/sessions/types/index.ts` (Session type, extended)
  - `src/features/workspace/components/TerminalZone.tsx` (rendering iteration)
  - `src/features/terminal/components/TerminalPane/` (step-4 chrome, prop extension)
- Roadmap entry: `docs/roadmap/progress.yaml` (`ui-handoff-migration`; new `ui-s5a` step)
