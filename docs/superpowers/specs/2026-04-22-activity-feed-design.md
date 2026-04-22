# Activity Feed — Unified Tool-Call Timeline in Agent Status Panel

**Date:** 2026-04-22
**Status:** Implemented (spec reconciled to shipped design 2026-04-22)
**Branch:** `ref/toolcalling-ui`
**Follows:** issue #76 (harness Tier 5 visual-verification) — this PR is the manual visual-fidelity pass that #76 would have caught automatically

> **Amendments log.** The original spec proposed an additive feed that preserved `RecentToolCalls` and made no Rust changes. Mid-implementation the user asked for four structural changes; this document was rewritten to describe the shipped design. The "Amendments" subsection at the bottom lists each deviation and why.

## Problem

The agent status panel currently surfaces tool calls as two sibling components:

- `ToolCallSummary` — aggregated chips by tool type + a pulsing "Running" indicator.
- `RecentToolCalls` — a collapsible list of the last 10 completed calls.

The Claude Design prototype replaces this chip+list pattern with a **unified vertical activity feed** whose entries are typed (`EDIT`, `BASH`, `READ`, `WRITE`, `GREP`, `GLOB`, `THINK`, `USER`, `META`), each with an icon, color, body, relative timestamp, and optional status chips (`+12 -2` for edits, `FAILED 1/4` for bash tests). See `docs/design/UNIFIED.md` §5.2 for the canonical `ActivityPanel` contract.

The prior activity-panel refactor session (see `docs/reviews/retrospectives/2026-04-21-activity-panel-harness-session.md`) produced functionally-green code that was rejected for visual drift from the prototype. This spec scopes a targeted follow-up that introduces the activity feed without disturbing the panel sections that have their own pending redesigns.

## Goals

- Introduce a single `ActivityFeed` component that renders a typed timeline of agent events inside `AgentStatusPanel`, matching the Claude Design prototype's `ACTIVITY` section.
- Delete `RecentToolCalls` — the feed supersedes it. The raw-list view is redundant once every recent event renders as a typed feed entry with a relative timestamp and optional status chip.
- Wrap both `ToolCallSummary` and `ActivityFeed` in `CollapsibleSection` (default expanded) so all four sections in the scrollable region (`Tool Calls`, `Activity`, `Files Changed`, `Tests`) share one header rhythm.
- Ship a discriminated-union `ActivityEvent` type covering both the kinds we render today (tool calls) and the kinds we will render later (`think` / `user` / `meta`), so future work is a case-addition rather than a restructure.
- Delete the orphaned `src/features/workspace/components/AgentActivity/` folder, which was superseded by `AgentStatusPanel` and is no longer mounted.
- Preserve each tool call's real event time across the pipeline — assistant/user JSONL lines carry a `timestamp`; the Rust transcript parser forwards it instead of stamping every event with the parser-run time.
- Paginate the feed at 10 entries by default, with a `+ N earlier events` / `Show less` toggle exposing the full 50-event backend buffer.

## Non-goals

- Redesign of `StatusCard`, `ContextBucket`, `FilesChanged`, `TestResults`, or `ActivityFooter` — each is its own follow-up PR.
- Claude Design's top-of-panel "session header + CONTEXT / 5-HOUR USAGE / TURNS bars" — separate PR.
- Transcript parser **feature** work. `diff` (from `git status` after edits) and `bashResult` (from a test-script watcher) still land in future PRs; the fields are declared optionally today and populated later.
- Persistent cross-session tool-call history. The 50-event buffer lives in memory per session; a sqlite/indexeddb store is its own project.
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

src/features/agent-status/components/
  ├── RecentToolCalls.tsx                                 ← superseded by ActivityFeed
  └── RecentToolCalls.test.tsx

(Orphaned folder: no import outside the directory itself; a comment in
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
  ├── hooks/useAgentStatus.ts                             ← store p.timestamp on running branch;
  │                                                         bump RECENT_TOOL_CALLS_LIMIT 10 → 50;
  │                                                         clearTimeout on unmount cleanup
  ├── hooks/useAgentStatus.test.ts                        ← assert startedAt; 50-event window
  ├── components/ToolCallSummary.tsx                      ← wrap in CollapsibleSection
  │                                                         (title="Tool Calls", defaultExpanded);
  │                                                         tighten chip density (leading-none,
  │                                                         gap-1.5, text-[10px], max-w truncate)
  └── components/AgentStatusPanel.tsx                     ← mount ActivityFeed inside the
                                                            scrollable region; drop RecentToolCalls

src/features/agent-status/components/AgentStatusPanel.test.tsx
                                                          ← assert ActivityFeed renders
                                                            alongside unchanged consumers;
                                                            assert thin-scrollbar convention

src-tauri/src/agent/transcript.rs                         ← new extract_timestamp helper;
                                                            propagate transcript-line timestamp
                                                            through assistant / user / tool_result
                                                            emitters instead of now_iso8601()
```

### Files untouched (explicit)

`StatusCard`, `ContextBucket`, `FilesChanged`, `TestResults`, `ActivityFooter`, and all tests for them — behavior is unchanged.

## Architecture

### Panel order after this PR

```
AgentStatusPanel
├── StatusCard              (kept, untouched)
├── ContextBucket           (kept, untouched)
├── [scrollable region, thin-scrollbar]
│   ├── ToolCallSummary     (wrapped in CollapsibleSection "Tool Calls", default expanded)
│   ├── ActivityFeed        (wrapped in CollapsibleSection "Activity",   default expanded)
│   ├── FilesChanged        (kept, untouched — CollapsibleSection, default collapsed)
│   └── TestResults         (kept, untouched — CollapsibleSection, default collapsed)
└── ActivityFooter          (kept, untouched)
```

Tool-call data now reaches the user through two lenses: the `ToolCallSummary` chip-and-running-indicator view (by-type analytics + current tool), and the `ActivityFeed` narrative view (per-event timeline with types, relative timestamps, status chips). `RecentToolCalls`, which showed a raw list of the last 10 calls, was removed — it duplicated what the feed already displays better.

All four sections use `CollapsibleSection`, so their chevron + uppercase title + count share the same rhythm and vertical alignment.

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

`diff` source when wired later: run `git diff --numstat <path>` after each `Edit` / `Write` tool call (or patch-parse the output of `git diff` against a pre-edit checkpoint), emit `{ added, removed }`. `git status --porcelain` gives file-level flags only — no line counts — so it's insufficient for this field.

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

    <div className="thin-scrollbar flex-1 overflow-y-auto">
      <ToolCallSummary {...status.toolCalls} />      {/* CollapsibleSection, default expanded */}
      <ActivityFeed events={events} />               {/* CollapsibleSection, default expanded */}
      <FilesChanged {...} />
      <TestResults {...} />
    </div>

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
- **Bash status pill (BASH only, always present for `done`/`failed`):** The verb is derived from `status`, not from `bashResult` — a passing test run with `{ passed: 4, total: 4 }` and `status: 'done'` must render as `OK`, not `FAILED`.
  - Base text: `OK` (`bg-success/[0.12] text-success`) when `status === 'done'`; `FAILED` (`bg-error/[0.12] text-error`) when `status === 'failed'`.
  - Counts suffix when `bashResult` is present: `OK {passed}/{total}` or `FAILED {passed}/{total}`. The format is literal; producers are responsible for providing semantically meaningful counts (where `passed` is the pass count and `total` is the total — a `FAILED 1/4` thus reads "1 passed out of 4").
  - Style: `rounded-md px-2 py-0.5 text-[9px] font-bold uppercase`. Non-bash events render no row 3 status pill.
- **Running:** no chip — the animated dot on the icon carries the state.

### Running-state visual

- A small `bg-success` dot (≈ `w-1.5 h-1.5 rounded-full`) overlays the top-right of the icon chip, using Tailwind's built-in `animate-pulse` utility. This matches the existing convention in `ToolCallSummary.tsx` line 48 — no new CSS keyframe is introduced. (The `agent_status_sidebar/code.html` design reference uses a custom `.pulse-dot` keyframe, but that class is not defined in app CSS; `animate-pulse` is the app-side equivalent.)
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

| File                                | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `utils/relativeTime.test.ts`        | Table-driven: `0s` → `now`, `4s` → `now`, `5s` → `5s ago`, `59s` → `59s ago`, `60s` → `1m ago`, `59m` → `59m ago`, `60m` → `1h ago`, `23h` → `23h ago`, `24h` → `1d ago`, `48h` → `2d ago`. Also exercise `formatDuration`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `utils/toolCallsToEvents.test.ts`   | `(null, [])` → `[]`; active-only → 1 event `status='running'`; recent-only → N events in order; both → active prepended; `Edit`/`MultiEdit` → `edit`; `Write`/`NotebookEdit` → `write`; `Bash`/`Read`/`Grep`/`Glob` → same-name kind; `WebFetch`/`Task`/other → `meta`; active carries `startedAt` into event's `timestamp`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `hooks/useActivityEvents.test.tsx`  | Same `AgentStatus` reference → same array reference (memo hit). Change `active` → new reference. Change only an unrelated slice (e.g., `cost`) → same reference.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `components/ActivityEvent.test.tsx` | Queries follow `rules/typescript/testing/CLAUDE.md` priority — `getByRole` / `getByText` first, `data-testid` reserved for the rail only. Icons are `aria-hidden` Material Symbols — assert via the event row's semantic structure, not the glyph. Per-kind: label text renders (`EDIT`/`BASH`/...), body text renders, icon's color class is on the icon span. Running state → animated dot present + timestamp reads `running Xs`. Done/failed → relative timestamp text. `diff` present → `+N` and `−M` chips render; absent → no diff chips. Bash status pill: `status='done' + bashResult {passed:4,total:4}` → `OK 4/4` in success palette; `status='failed' + bashResult {passed:1,total:4}` → `FAILED 1/4` in error palette; `status='done'` no `bashResult` → `OK`; `status='failed'` no `bashResult` → `FAILED`. Non-bash without chip data → no pill. `meta` kind → generic `tune` icon + raw tool name as label. |
| `components/ActivityFeed.test.tsx`  | Header `ACTIVITY` renders (via `getByText`). Empty events → `No activity yet` text. N events render in given order (assert DOM order via `getAllByRole` on the row semantic element). Rail element may use `data-testid` (layout-only, last-resort usage per testing rules).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### Existing test edits

| File                                   | Change                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks/useAgentStatus.test.ts`         | Extend "running branch" test to assert `active.startedAt` equals the incoming `p.timestamp`.                                                                                                                                                                                                                                  |
| `components/AgentStatusPanel.test.tsx` | Mount with mocked `useAgentStatus` returning a fixture with `active` + one recent. Assert: `ActivityFeed` renders inside the scrollable region alongside `ToolCallSummary`; scrollable container uses the project's `thin-scrollbar` convention; collapsible "Activity" and "Tool Calls" headers are both present as buttons. |

### Deleted tests

All `src/features/workspace/components/AgentActivity/**/*.test.tsx` — deleted with the orphaned folder.

### Out of scope (recorded for follow-up)

- Visual regression / pixel diff — issue #76 Tier 5 harness work.
- Rust-side tests for `diff` / `bashResult` producers — no producer changes in this PR.
- E2E — the feed is shallow enough that unit tests cover the contract.

## Decisions settled during implementation

- `ActivityFeed` inside `CollapsibleSection` (default expanded), matching every other section in the panel — one header rhythm across the scrollable region.
- `ToolCallSummary` wrapped in `CollapsibleSection` as well so all four headers visually align.
- `RecentToolCalls` removed — the feed supersedes it; the raw list was redundant.
- Pagination at 10 visible events with a `+ N earlier events` / `Show less` toggle; backend cap raised from 10 to 50.
- Rust transcript parser forwards the per-line `timestamp` so the feed can sort chronologically and show real relative ages (not "everything just now" on batch catch-up).
- Frontend `formatRelativeTime` skips seconds: `< 60s` → `now`, then straight to `Nm ago`.
- Feed sorts its recent slice by `timestamp` desc; `active` stays pinned at the top.
- 1-second interval in `ActivityFeed` only ticks while a running event is present; `now` is refreshed on events change so completed-only feeds don't show stale relative times after arrival.
- `useAgentStatus` unmount cleanup clears the 5-second exit-hold timeout to avoid a closure leak.
- `ActiveToolCall.startedAt` extension — chosen over "render active without timestamp" so the running row can compute a live `running Xs` duration.
- Unknown tool names (`Task`, `WebFetch`, ...) map to the `meta` kind; escalate to named kinds when their visual contract is settled.
- Derivation hook (`useActivityEvents`), not Context/store — revisit only if consumers appear outside `AgentStatusPanel`.
- `diff` / `bashResult` declared optionally today, populated by future producer PRs — no consumer-side churn when data lands.

## Amendments (vs. initial spec)

The original 2026-04-22 draft framed this PR as **additive** — keep `ToolCallSummary` + `RecentToolCalls`, add the feed alongside them, no Rust work. Four changes during implementation moved the shipped design away from that framing, each at the user's request:

1. **`RecentToolCalls` removed.** The feed renders the same recent-tool-call data with better visual treatment. Keeping both was deliberate redundancy per the initial spec but became noise once the feed was mounted.
2. **`ToolCallSummary` wrapped in `CollapsibleSection`.** Without this, the "Tool Calls" header lacked the chevron that `Activity`, `Files Changed`, and `Tests` carry, and the four sections looked visually mis-aligned.
3. **Rust `transcript.rs` touched.** The "no Rust changes" non-goal was dropped when the feed collapsed to "everything happened 35s ago" on initial watch — the parser was stamping every event with the wall-clock at parse time rather than the transcript line's real timestamp. Fix is a small pure helper + plumbing, not a structural rewrite.
4. **Pagination + 50-event backend buffer.** 10 events wasn't enough to "learn from the past"; the feed now caps the default visible at 10 but exposes the full 50-event buffer through a `+ N earlier events` toggle.

## Future work

- Rust transcript parser: emit thinking events (enable `think` kind rendering).
- Rust transcript parser: emit user message events (enable `user` kind rendering).
- `git diff --numstat` watcher: populate `diff` on `Edit` / `Write` completion.
- Test-output parser/watcher: populate `bashResult` on `Bash` completion for common test runners.
- Panel-wide redesigns that match the Claude Design's top header + metrics bars + footer — tracked as separate PRs.
- Consolidate `formatRelativeTime` with the private one in `src/features/diff/components/CommitInfoPanel.tsx` into the shared `utils/relativeTime.ts` — cleanup PR, not this one.
- Inline terminal tool invocations (`⚒ tool-name(args) ● status · detail`) per UNIFIED §3.1 — independent feature.
- Persistent cross-session tool-call history (sqlite / indexeddb) — unlocks history beyond the 50-event in-memory buffer.
- When any consumer outside `AgentStatusPanel` needs the event stream, lift `useAgentStatus` into a Context provider; the hook signature already takes `sessionId` so the lift is mechanical.

## References

- `docs/design/UNIFIED.md` §5.2 — `ActivityPanel` component contract (authoritative).
- `docs/design/UNIFIED.md` §8 — anti-patterns (no emoji, Material Symbols Outlined, tonal shifts over 1px borders, always-relative timestamps).
- `docs/design/agent_status_sidebar/code.html` — illustrative Stitch reference; UNIFIED wins on conflict.
- `docs/design/tokens.css` / `tokens.ts` — copy-pasteable color tokens.
- Claude Design prototype (runnable): `https://claude.ai/design/p/e9c4e751-f5ca-40eb-9ce7-611948803ce4` — visual source of truth for this refactor.
- Issue #76 — harness Tier 5 visual verification loop (the automated guard this manual pass precedes).
- `docs/reviews/retrospectives/2026-04-21-activity-panel-harness-session.md` — prior session context.
