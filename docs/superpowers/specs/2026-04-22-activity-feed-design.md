# Activity Feed — Unified Tool-Call Timeline in Agent Status Panel

**Date:** 2026-04-22
**Status:** Proposed
**Branch:** `ref/toolcalling-ui`
**Follows:** issue #76 (harness Tier 5 visual-verification) — this PR is the manual visual-fidelity pass that #76 would have caught automatically

## Problem

The agent status panel currently surfaces tool calls as two sibling components:

- `ToolCallSummary` — aggregated chips by tool type + a pulsing "Running" indicator.
- `RecentToolCalls` — a collapsible list of the last 10 completed calls.

The Claude Design prototype replaces this chip+list pattern with a **unified vertical activity feed** whose entries are typed (`EDIT`, `BASH`, `READ`, `WRITE`, `GREP`, `GLOB`, `THINK`, `USER`, `META`), each with an icon, color, body, relative timestamp, and optional status chips (`+12 -2` for edits, `FAILED 1/4` for bash tests). See `docs/design/UNIFIED.md` §5.2 for the canonical `ActivityPanel` contract.

The prior activity-panel refactor session (see `docs/reviews/retrospectives/2026-04-21-activity-panel-harness-session.md`) produced functionally-green code that was rejected for visual drift from the prototype. This spec scopes a targeted follow-up that introduces the activity feed without disturbing the panel sections that have their own pending redesigns.

## Goals

- Introduce a single `ActivityFeed` component that renders a typed timeline of agent events inside `AgentStatusPanel`, matching the Claude Design prototype's `ACTIVITY` section.
- Preserve `ToolCallSummary` and `RecentToolCalls` behavior unchanged — the feed is additive, not replacive.
- Ship a discriminated-union `ActivityEvent` type covering both the kinds we render today (tool calls) and the kinds we will render later (`think` / `user` / `meta`), so future work is a case-addition rather than a restructure.
- Delete the orphaned `src/features/workspace/components/AgentActivity/` folder, which was superseded by `AgentStatusPanel` and is no longer mounted.

## Non-goals

- Redesign of `StatusCard`, `ContextBucket`, `FilesChanged`, `TestResults`, or `ActivityFooter` — each is its own follow-up PR.
- Claude Design's top-of-panel "session header + CONTEXT / 5-HOUR USAGE / TURNS bars" — separate PR.
- Rust-side transcript parser changes. No new producer work. `diff` (from `git status` after edits) and `bashResult` (from a test-script watcher) land in future PRs.
- Pixel-level visual regression tests. Issue #76 Tier 5 is the correct vehicle for automated fidelity checks.
- E2E (WebdriverIO) coverage for the new surface — unit tests cover the contract.

## Scope

### Files deleted

```
src/features/workspace/components/AgentActivity/          ← whole orphaned directory
  ├── AgentActivity.tsx / .test.tsx
  ├── ActivityFooter.tsx / .test.tsx
  ├── CollapsibleSection.tsx / .test.tsx
  ├── FilesChanged.tsx / .test.tsx
  ├── PinnedMetrics.tsx / .test.tsx
  ├── StatusCard.tsx / .test.tsx
  ├── Tests.tsx / .test.tsx
  ├── ToolCalls.tsx / .test.tsx
  └── index.ts

(Orphaned: no import outside the directory itself; a comment in
 `WorkspaceView.verification.test.tsx` confirms AgentActivity was
 replaced by AgentStatusPanel.)
```

### Files added

```
src/features/agent-status/
  ├── types/activityEvent.ts                              ← discriminated union
  ├── utils/relativeTime.ts        / .test.ts             ← "now" / "18s ago" / ...
  ├── utils/toolCallsToEvents.ts   / .test.ts             ← AgentStatus slice → ActivityEvent[]
  ├── hooks/useActivityEvents.ts   / .test.tsx            ← memoized derivation wrapper
  └── components/
       ├── ActivityFeed.tsx        / .test.tsx            ← section header + rail + list
       └── ActivityEvent.tsx       / .test.tsx            ← single entry, discriminated render
```

### Files edited

```
src/features/agent-status/
  ├── types/index.ts                                      ← ActiveToolCall += startedAt: string
  ├── hooks/useAgentStatus.ts                             ← store p.timestamp on running branch
  ├── hooks/useAgentStatus.test.ts                        ← extend to assert startedAt
  └── components/AgentStatusPanel.tsx                     ← mount ActivityFeed between
                                                            ContextBucket and ToolCallSummary

src/features/agent-status/components/AgentStatusPanel.test.tsx
                                                          ← assert ActivityFeed renders
                                                            alongside unchanged consumers
```

### Files untouched (explicit)

`StatusCard`, `ContextBucket`, `ToolCallSummary`, `RecentToolCalls`, `FilesChanged`, `TestResults`, `ActivityFooter`, and all tests for them — behavior is unchanged.

## Architecture

### Panel order after this PR

```
AgentStatusPanel
├── StatusCard              (kept, untouched)
├── ContextBucket           (kept, untouched)
├── ActivityFeed            ← NEW, always visible
├── ToolCallSummary         (kept — always visible; chips + running indicator)
├── RecentToolCalls         (kept — collapsed by default via CollapsibleSection)
├── FilesChanged            (kept, untouched)
├── TestResults             (kept, untouched)
└── ActivityFooter          (kept, untouched)
```

Tool calls appear in three lenses simultaneously by design — narrative (feed), analytics (chips), raw list (Recent). This is deliberate per the brainstorming session; no collapsing or hiding of existing consumers.

### Component boundaries

| Component           | Responsibility                                                                              | Input                                 |
| ------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------- |
| `ActivityFeed`      | Section header, empty state, vertical rail, ordered list of events                          | `events: ActivityEvent[]`             |
| `ActivityEvent`     | Per-entry row: icon chip, type label, body, relative timestamp, status chips, running state | Discriminated props (`ActivityEvent`) |
| `useActivityEvents` | Memoizing wrapper; `AgentStatus` slice → `ActivityEvent[]`                                  | `status: AgentStatus`                 |
| `toolCallsToEvents` | Pure mapper used by the hook                                                                | `(active, recent)`                    |
| `relativeTime`      | ISO timestamp → human label                                                                 | `(isoString, now?)`                   |

Smallest testable unit is the pure mapper; the hook is a three-line memo; the components are presentational.

## Type system — discriminated union

```ts
// src/features/agent-status/types/activityEvent.ts

export type ActivityEventKind =
  | 'edit'
  | 'bash'
  | 'read'
  | 'write'
  | 'grep'
  | 'glob'
  | 'think' // reserved — transcript parser does not yet emit thinking events
  | 'user' // reserved — transcript parser does not yet emit user messages
  | 'meta' // fallback for unknown tool names (Task / WebFetch / WebSearch / ...)

export interface BaseActivityEvent {
  id: string
  kind: ActivityEventKind
  timestamp: string // ISO-8601
  status: 'running' | 'done' | 'failed'
  body: string // shared: args / path / cmd / quoted thought / user text
}

export interface ToolActivityEvent extends BaseActivityEvent {
  kind: 'edit' | 'bash' | 'read' | 'write' | 'grep' | 'glob' | 'meta'
  tool: string // raw tool name, drives icon mapping
  durationMs: number | null
  diff?: { added: number; removed: number } // EDIT/WRITE only, future (git status)
  bashResult?: { passed: number; total: number } // BASH only, future (test parser)
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
```

`meta` rides on `ToolActivityEvent` because today all `meta` sources are tool-call events whose raw tool name isn't in the named-kind union. If in the future META stops being tool-shaped, it gets its own variant.

### Rationale for the optional `diff` / `bashResult` fields

Declaring them today — unused — means the transcript-parser extension later is a **producer-only change** (Rust-side emit + `toolCallsToEvents` populate). No consumer-side type migration. The renderer already has code paths for "field present" vs "field absent", tested from day one.

`diff` source when wired later: run `git status --porcelain --short` after each `Edit` / `Write` tool call, diff against the pre-edit checkpoint, emit `{ added, removed }`.

`bashResult` source when wired later: a test-script parser/watcher observes common test-runner output (`vitest`, `pytest`, `cargo test`), extracts `passed/total`, emits on the bash tool-call event.

## Data flow

### `ActiveToolCall` gains a `startedAt` field

Current:

```ts
export interface ActiveToolCall {
  tool: string
  args: string
}
```

After:

```ts
export interface ActiveToolCall {
  tool: string
  args: string
  startedAt: string // ISO — sourced from AgentToolCallEvent.timestamp at event time
}
```

Three-line change in `useAgentStatus.ts` `handleDetection` → the `p.status === 'running'` branch:

```ts
if (p.status === 'running') {
  setStatus((prev) => ({
    ...prev,
    toolCalls: {
      ...prev.toolCalls,
      active: { tool: p.tool, args: p.args, startedAt: p.timestamp }, // ← added
    },
  }))
}
```

No Rust changes. `AgentToolCallEvent` already carries `timestamp`.

### `toolCallsToEvents` mapper

```ts
// src/features/agent-status/utils/toolCallsToEvents.ts

import type {
  ActivityEvent,
  ToolActivityEvent,
  ActivityEventKind,
} from '../types/activityEvent'
import type { ActiveToolCall, RecentToolCall } from '../types'

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

  for (const r of recent) {
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
```

Order guarantees: `recentToolCalls` is already newest-first (`[newCall, ...prev]` in `useAgentStatus`). The mapper prepends `active` so the running row is always at the top.

### `useActivityEvents` memoizing hook

```ts
// src/features/agent-status/hooks/useActivityEvents.ts

import { useMemo } from 'react'
import { toolCallsToEvents } from '../utils/toolCallsToEvents'
import type { AgentStatus } from '../types'
import type { ActivityEvent } from '../types/activityEvent'

export const useActivityEvents = (status: AgentStatus): ActivityEvent[] =>
  useMemo(
    () => toolCallsToEvents(status.toolCalls.active, status.recentToolCalls),
    [status.toolCalls.active, status.recentToolCalls]
  )
```

No Context provider, no global store. `AgentStatusPanel` is the single consumer; the hook is a one-file ergonomic wrapper.

### `AgentStatusPanel` wiring

```tsx
const status = useAgentStatus(sessionId)
const events = useActivityEvents(status)

return (
  <aside className="...">
    <StatusCard {...} />
    <ContextBucket {...} />
    <ActivityFeed events={events} />                 {/* ← NEW */}
    <ToolCallSummary {...status.toolCalls} />
    <RecentToolCalls calls={status.recentToolCalls} />
    <FilesChanged {...} />
    <TestResults {...} />
    <ActivityFooter {...} />
  </aside>
)
```

## Visual contract

### Section header

Text: `ACTIVITY`, `text-[10px] font-black uppercase tracking-[0.15em] text-outline`, matches the style of every other section header in the panel (`CollapsibleSection`).

### Per-event row layout

```
┌─────────────────────────────────────────────────┐
│ rail │  [icon]  TYPE                    NOW     │  row 1
│  ·   │          body text                       │  row 2
│  ·   │          [+12] [-2]                      │  row 3 (optional)
│  ·   │                                          │
│  ·   │  [icon]  ...                             │
└─────────────────────────────────────────────────┘
```

- **Rail:** 1px vertical line, color `rgba(74,68,79,0.4)` (= `outline-variant` at ~40%), runs through the vertical center of each icon chip. Extends the full height of the feed.
- **Icon chip:** small rounded-md square, `bg-surface-container-high`, `w-6 h-6` with a centered `.material-symbols-outlined` glyph (`text-sm`, `text-{colorTokenPerKind}`).
- **Row 1:** icon · type label (uppercase, `text-[10px] font-bold tracking-[0.12em]`, kind color) · relative timestamp right-aligned (`text-[9px] font-mono text-outline`).
- **Row 2:** body text — `text-xs text-on-surface font-mono` for tool-call paths/commands; `text-xs text-on-surface italic font-body` for THINK; plain `text-xs text-on-surface` for USER.
- **Row 3 (optional):** status chips, left-aligned, see below.

### Icon + color mapping (Material Symbols Outlined, per UNIFIED §8 anti-patterns — no emoji)

| `kind`  | Material Symbol | Color token               |
| ------- | --------------- | ------------------------- |
| `edit`  | `edit`          | `text-primary-container`  |
| `write` | `edit_note`     | `text-primary-container`  |
| `read`  | `visibility`    | `text-on-surface-variant` |
| `bash`  | `terminal`      | `text-secondary`          |
| `grep`  | `search`        | `text-on-surface-variant` |
| `glob`  | `find_in_page`  | `text-on-surface-variant` |
| `think` | `psychology`    | `text-primary-container`  |
| `user`  | `person`        | `text-tertiary`           |
| `meta`  | `tune`          | `text-outline`            |

### Status chips (row 3, optional)

- **`diff` present (EDIT/WRITE):** two plain-text chips, `+{added}` in `text-success`, `−{removed}` in `text-error`, `font-mono text-[9px]`, no background. Render only when `diff` exists.
- **`bashResult` present (BASH):** one pill — `bg-error/[0.12] text-error rounded-md px-2 py-0.5 text-[9px] font-bold uppercase`, text `FAILED {passed}/{total}`. Render only when `bashResult` exists.
- **Fallback pill (BASH only, no `bashResult`):** `OK` pill (`bg-success/[0.12] text-success`) when `status === 'done'`; `FAILED` pill (`bg-error/[0.12] text-error`) when `status === 'failed'`. Non-bash without chip data renders no row 3.
- **Running:** no chip — pulse dot on the icon carries the state.

### Running-state visual

- A small `bg-success` dot (≈ `w-1.5 h-1.5 rounded-full`) overlays the top-right of the icon chip, pulsing via the existing `pulse-dot` keyframe (already defined in `agent_status_sidebar/code.html` and used elsewhere).
- Timestamp slot reads `running ${formatDuration(now - startedAt)}` — e.g., `running 8s`. The duration recomputes every ~1s via a single `setInterval` at the `ActivityFeed` level (not per-event), to avoid N timers.

### Relative timestamp formatter

`src/features/agent-status/utils/relativeTime.ts`:

```ts
export const formatRelativeTime = (
  iso: string,
  now: Date = new Date()
): string => {
  const deltaMs = now.getTime() - new Date(iso).getTime()
  const s = Math.floor(deltaMs / 1000)
  if (s < 5) return 'now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
```

Boundary behavior: `<5s` → `now`; `5s..59s` → `Ns ago`; `60s` → `1m ago`; `60m` → `1h ago`; `24h` → `1d ago`. Always relative — absolute timestamps appear only on hover (native `title` attribute, ISO string).

A separate `formatDuration(ms)` for the running row:

```ts
export const formatDuration = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
```

### Empty state

`events.length === 0` → render the `ACTIVITY` header with muted body text `No activity yet` (`text-xs text-on-surface-variant`). No skeletons — the panel only mounts when the agent is active.

## Testing

### New test files

| File                                | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `utils/relativeTime.test.ts`        | Table-driven: `0s` → `now`, `4s` → `now`, `5s` → `5s ago`, `59s` → `59s ago`, `60s` → `1m ago`, `59m` → `59m ago`, `60m` → `1h ago`, `23h` → `23h ago`, `24h` → `1d ago`, `48h` → `2d ago`. Also exercise `formatDuration`.                                                                                                                                                                                                                                                                            |
| `utils/toolCallsToEvents.test.ts`   | `(null, [])` → `[]`; active-only → 1 event `status='running'`; recent-only → N events in order; both → active prepended; `Edit`/`MultiEdit` → `edit`; `Write`/`NotebookEdit` → `write`; `Bash`/`Read`/`Grep`/`Glob` → same-name kind; `WebFetch`/`Task`/other → `meta`; active carries `startedAt` into event's `timestamp`.                                                                                                                                                                           |
| `hooks/useActivityEvents.test.tsx`  | Same `AgentStatus` reference → same array reference (memo hit). Change `active` → new reference. Change only an unrelated slice (e.g., `cost`) → same reference.                                                                                                                                                                                                                                                                                                                                       |
| `components/ActivityEvent.test.tsx` | Per-kind render: icon symbol name via `data-testid`, label text, body text, color class on icon. Running state → pulse-dot testid + `running Xs` format. Done state → relative timestamp. `diff` present → `+N`/`−M` chips text assertions. `diff` absent → no diff chips. `bashResult` present → `FAILED X/Y` pill. `bash` + `done` no `bashResult` → `OK` pill. `bash` + `failed` no `bashResult` → `FAILED` pill. Non-bash without chip data → no pill. `meta` kind → generic icon + raw tool name. |
| `components/ActivityFeed.test.tsx`  | Header `ACTIVITY` renders. Empty events → `No activity yet`. N events render in given order (assert DOM order). Rail element present (testid).                                                                                                                                                                                                                                                                                                                                                         |

### Existing test edits

| File                                   | Change                                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks/useAgentStatus.test.ts`         | Extend "running branch" test to assert `active.startedAt` equals the incoming `p.timestamp`.                                                                                                                                                |
| `components/AgentStatusPanel.test.tsx` | Mount with mocked `useAgentStatus` returning a fixture with `active` + one recent. Assert: `ActivityFeed` renders; its DOM position is between `ContextBucket` and `ToolCallSummary`; `ToolCallSummary` and `RecentToolCalls` still render. |

### Deleted tests

All `src/features/workspace/components/AgentActivity/**/*.test.tsx` — deleted with the orphaned folder.

### Out of scope (recorded for follow-up)

- Visual regression / pixel diff — issue #76 Tier 5 harness work.
- Rust-side tests for `diff` / `bashResult` producers — no producer changes in this PR.
- E2E — the feed is shallow enough that unit tests cover the contract.

## Open questions

None. All design decisions settled during brainstorming:

- Additive (not replacive) integration with `ToolCallSummary` + `RecentToolCalls` — accepted three-lens redundancy.
- Orphaned `AgentActivity/` folder deletion — unrelated cleanup bundled.
- `ActiveToolCall.startedAt` extension — favored over "render active without timestamp".
- Unknown tool names → `meta` kind — escalate to named kinds as needed.
- Derivation hook, not Context/store — revisit only if consumers appear outside `AgentStatusPanel`.
- Declare `diff` / `bashResult` optionally now, populate later — no consumer-side churn when data producers land.

## Future work

- Rust transcript parser: emit thinking events (enable `think` kind rendering).
- Rust transcript parser: emit user message events (enable `user` kind rendering).
- `git status` watcher: populate `diff` on `Edit` / `Write` completion.
- Test-output parser/watcher: populate `bashResult` on `Bash` completion for common test runners.
- Panel-wide redesigns that match the Claude Design's top header + metrics bars + footer — tracked as separate PRs.
- Consolidate `formatRelativeTime` with the private one in `src/features/diff/components/CommitInfoPanel.tsx` into the new shared `utils/relativeTime.ts` — cleanup PR, not this one.
- Inline terminal tool invocations (`⚒ tool-name(args) ● status · detail`) per UNIFIED §3.1 — independent feature.
- When any consumer outside `AgentStatusPanel` needs the event stream, lift `useAgentStatus` into a Context provider; the hook signature already takes `sessionId` so the lift is mechanical.

## References

- `docs/design/UNIFIED.md` §5.2 — `ActivityPanel` component contract (authoritative).
- `docs/design/UNIFIED.md` §8 — anti-patterns (no emoji, Material Symbols Outlined, tonal shifts over 1px borders, always-relative timestamps).
- `docs/design/agent_status_sidebar/code.html` — illustrative Stitch reference; UNIFIED wins on conflict.
- `docs/design/tokens.css` / `tokens.ts` — copy-pasteable color tokens.
- Claude Design prototype (runnable): `https://claude.ai/design/p/e9c4e751-f5ca-40eb-9ce7-611948803ce4` — visual source of truth for this refactor.
- Issue #76 — harness Tier 5 visual verification loop (the automated guard this manual pass precedes).
- `docs/reviews/retrospectives/2026-04-21-activity-panel-harness-session.md` — prior session context.
