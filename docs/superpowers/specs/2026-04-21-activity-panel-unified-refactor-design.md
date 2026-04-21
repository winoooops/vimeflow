# Activity Panel — UNIFIED.md Alignment Refactor

**Date:** 2026-04-21
**Status:** Ready for implementation (harness-driven)
**Integration branch:** `harness-activity-panel-refactor`
**Authoritative refs:** `docs/design/UNIFIED.md` §4 (agent-state contract), §5 (component contracts), §8 (anti-patterns); Claude Design prototype (visual ground truth for the five states).

## 1. Overview

Align the agent activity panel with `UNIFIED.md` §4.4 and §5.2. Adopt the five-state session contract (`running | awaiting | completed | errored | idle`), render exactly one state-specific card above the activity feed, replace the current flat tool-invocation list with a proper icon-node timeline, and strip the "● running" text anti-pattern. The underlying feature set already exists; the refactor reshapes presentation and state semantics without adding new IPC surfaces or data flows. Legacy `src/features/agent-status/` is folded into `src/features/workspace/components/AgentActivity/` and deleted.

## 2. Feature list (ordered for incremental green)

Each feature ships as one PR, tests co-located and updated in the same PR. Commit prefix: `refactor:` unless the feature introduces a new exported component (then `feat:`).

1. **Extend `SessionStatus`** — values become `'running' | 'awaiting' | 'completed' | 'errored' | 'idle'`. Drop `'paused'`. Update `src/features/workspace/types/index.ts`, all call sites, mock fixtures, and any type guards. Re-export or alias from `docs/design/tokens.ts` `SessionState` to keep one source of truth. No visual change yet.
2. **Introduce `ActivityEvent` type** — `{ id: string; type: 'edit' | 'bash' | 'read' | 'think' | 'user'; body: string; at: string; badge?: { kind: 'live' | 'ok' | 'failed' | 'diff'; text: string } }`. Seed mock events covering all five event types and all badge kinds. No visual change; exports ready for consumer in feature #7.
3. **`StatusDot` component** per §5.3 + §4.1 table. Props `{ state: SessionStatus; size?: number; glow?: boolean }`. Glow is a 3-ring outer shadow at ~45% alpha of the dot color. `idle` and `completed` render as hollow rings; `running`/`awaiting`/`errored` render solid. `running` and `awaiting` pulse (2s / 1.4s cycle). Swap every dot in the panel to use it; delete ad-hoc symbol maps.
4. **`StatusCard` header rewrite** — `StatusDot` + bold title + `"<agent> · <branch>"` subtitle + `⋯` menu. **No state-label text anywhere** (§8 anti-pattern: no "● running"). The `statusConfig.label` and `statusConfig.symbol` rendering goes away.
5. **`NowCard`** — visible **only when `state === 'running'`**. Bordered card rendering the current tool invocation: type icon, uppercase type label, relative timestamp, body, inline `LIVE` badge (primary-container on glass). Consumes the most-recent `ActivityEvent` (or a separate `currentAction` prop — decide during impl).
6. **`ApprovalCard` + `ErrorBlock` + idle meters** — the conditional state slot. `ApprovalCard` (awaiting) shows label `"AWAITING YOU"` plus two buttons: primary-gradient Approve, ghost Deny. `ErrorBlock` (errored) shows label `"ERROR"` plus a bordered monospace red message block. When `state === 'idle'`, `CONTEXT` and `5-HOUR USAGE` values collapse to `--` per §4.4 (prototype diverges here — **spec wins**; document the divergence in the component JSDoc). `completed` and `idle` render no state card above the feed.
7. **`ActivityFeed` timeline** — replaces `ToolCalls`. Vertical list, events rendered on a subtle 1px rail (`rgba(74,68,79,0.4)` per §5.2). Each event: left-aligned icon node (Material Symbols Outlined: `edit_note` / `terminal` / `visibility` / `auto_awesome` / `person`), uppercase type label, right-aligned relative timestamp, body below, optional inline badge. `think` bodies render in italic with wrapping curly quotes. All timestamps relative; absolute only via `title` tooltip on hover (§4.2).
8. **Legacy cleanup** — fold any bits of `src/features/agent-status/components/` that aren't duplicated in `workspace/` into the new tree, update imports, delete `src/features/agent-status/`, run `npm run type-check` + `npm run lint` + `npm run test` clean.

## 3. Data model changes

**`src/features/workspace/types/index.ts`**

```ts
export type SessionStatus =
  | 'running'
  | 'awaiting'
  | 'completed'
  | 'errored'
  | 'idle'

export type ActivityEventType = 'edit' | 'bash' | 'read' | 'think' | 'user'

export interface ActivityEventBadge {
  kind: 'live' | 'ok' | 'failed' | 'diff'
  text: string // e.g. "LIVE", "OK", "FAILED 1/4", "+12 -2"
}

export interface ActivityEvent {
  id: string
  type: ActivityEventType
  body: string
  at: string // ISO timestamp; UI formats relatively
  badge?: ActivityEventBadge
}
```

**`docs/design/tokens.ts`** already exports `SessionState` and `stateToken`. Workspace types alias to it so there is a single source of truth:

```ts
import type { SessionState } from '../../../docs/design/tokens'
export type SessionStatus = SessionState
```

(If the relative path crosses too many boundaries for the project convention, re-export from a `src/design/` shim instead — decide during feature #1 implementation.)

## 4. Component API contracts

```ts
// Top-level panel
interface AgentActivityProps {
  session: WorkspaceSession // already exists; now includes new SessionStatus values
  events: ActivityEvent[]
  currentAction?: ActivityEvent // running state only; fallback to events[0]
  onApprove?(): void // awaiting only
  onDeny?(): void // awaiting only
}

// Per §5.3
interface StatusDotProps {
  state: SessionStatus
  size?: number // default 8
  glow?: boolean // default true
}

// Internal, not re-exported outside AgentActivity/
interface NowCardProps {
  event: ActivityEvent
}

interface ApprovalCardProps {
  question?: string // optional blocking question text
  onApprove(): void
  onDeny(): void
}

interface ErrorBlockProps {
  message: string
}

interface ActivityFeedProps {
  events: ActivityEvent[]
}
```

## 5. State → rendering matrix

| state       | Header dot                  | Meters            | Slot above feed | Feed |
| ----------- | --------------------------- | ----------------- | --------------- | ---- |
| `running`   | success solid + 2s pulse    | live values       | `NowCard`       | full |
| `awaiting`  | tertiary solid + 1.4s pulse | live values       | `ApprovalCard`  | full |
| `completed` | success-muted hollow ring   | live values       | —               | full |
| `errored`   | error solid                 | live values       | `ErrorBlock`    | full |
| `idle`      | outline-variant hollow ring | `--` placeholders | —               | full |

## 6. What stays · what changes

**Stays:** `AgentActivity.tsx` as the panel root, 280px width, `surface-container-low` background, `PinnedMetrics` context smiley (§8 permits emoji for the context smiley), co-located test layout, existing `AgentActivity.test.tsx` as the integration test anchor.

**Changes:** `SessionStatus` values, `StatusCard` contents, `ToolCalls` → `ActivityFeed`, adds `NowCard` / `ApprovalCard` / `ErrorBlock`, deletes `src/features/agent-status/`.

## 7. Non-goals

- No backend/IPC changes. No Tauri command additions.
- No sidebar `Sessions` tab rework (§4.3 — separate PR).
- No new session persistence, no changes to how sessions are created or stored.
- No command palette changes.
- No editor / diff / files view changes.
- No design token additions — everything in this refactor uses tokens already in `tokens.css` / `tokens.ts`.
- No Tweaks panel. (The Tweaks panel in the Claude Design prototype is a palette/state-toggle UI belonging to Claude Design, not part of Vimeflow.)

## 8. Divergences flagged for subagents

- **Idle meters:** Claude Design prototype shows live meter values in `idle` state. UNIFIED.md §4.4 says `--` placeholders. **Spec wins** — implement `--`.
- **`paused` state:** present in current `SessionStatus`, absent in UNIFIED.md's five-state model. Drop it; any fixture or caller using `paused` must be migrated to `awaiting` (if it meant "blocked on user") or `idle` (if it meant "fresh / no activity").

## 9. Workflow & integration

- Integration branch: `harness-activity-panel-refactor`.
- Each feature (§2) is a separate PR from a harness-managed per-feature worktree/branch back into the integration branch.
- Commit/test discipline per `CLAUDE.md`: co-located tests update with their components, `npm run type-check` + `npm run lint` + `npm run test` clean before merge, conventional commits.
- On the integration branch, every merge leaves the app green — no feature depends on a later feature to compile.
