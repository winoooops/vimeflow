# Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a unified `ActivityFeed` inside `AgentStatusPanel` that renders typed timeline entries (EDIT / BASH / READ / WRITE / GREP / GLOB / THINK / USER / META) matching the Claude Design prototype, without disturbing the existing `ToolCallSummary` / `RecentToolCalls` consumers.

**Architecture:** One discriminated-union `ActivityEvent` type, one pure mapper from `AgentStatus` slice → events, one memoizing hook, two components (`ActivityFeed` = shell; `ActivityEvent` = row). Tool-call data source is `useAgentStatus` — no Rust-side changes. `ActiveToolCall` gains a `startedAt` field so running rows can compute live duration. Orphaned `src/features/workspace/components/AgentActivity/` folder is deleted as bundled cleanup.

**Tech Stack:** React 19, TypeScript, Vitest, `@testing-library/react`, Tailwind CSS, Material Symbols Outlined.

**Spec:** `docs/superpowers/specs/2026-04-22-activity-feed-design.md`

**Branch:** `ref/toolcalling-ui`

---

## File Structure

### Created

| Path                                                          | Responsibility                                                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/features/agent-status/types/activityEvent.ts`            | Discriminated-union `ActivityEvent` type + `ActivityEventKind`. Pure type declarations; no runtime code.        |
| `src/features/agent-status/utils/relativeTime.ts`             | `formatRelativeTime(iso, now?)` and `formatDuration(ms)` pure functions.                                        |
| `src/features/agent-status/utils/relativeTime.test.ts`        | Table-driven boundary tests.                                                                                    |
| `src/features/agent-status/utils/toolCallsToEvents.ts`        | Pure mapper: `(ActiveToolCall \| null, RecentToolCall[]) → ActivityEvent[]`.                                    |
| `src/features/agent-status/utils/toolCallsToEvents.test.ts`   | Mapper tests: kinds, ordering, unknown-tool fallback.                                                           |
| `src/features/agent-status/hooks/useActivityEvents.ts`        | `useMemo` wrapper around the mapper; takes full `AgentStatus`.                                                  |
| `src/features/agent-status/hooks/useActivityEvents.test.tsx`  | Referential-stability tests.                                                                                    |
| `src/features/agent-status/components/ActivityEvent.tsx`      | One row: icon chip, type label, body, timestamp, optional chips, running state. Receives `event` + `now` props. |
| `src/features/agent-status/components/ActivityEvent.test.tsx` | Per-kind render; chip variants; running state.                                                                  |
| `src/features/agent-status/components/ActivityFeed.tsx`       | Shell: section header, empty state, vertical rail, ordered list. Manages `now` state via `setInterval`.         |
| `src/features/agent-status/components/ActivityFeed.test.tsx`  | Section header, empty state, event order, rail testid.                                                          |

### Modified

| Path                                                             | Change                                                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/features/agent-status/types/index.ts`                       | `ActiveToolCall` gains `startedAt: string`.                                                                           |
| `src/features/agent-status/hooks/useAgentStatus.ts`              | `p.status === 'running'` branch stores `startedAt: p.timestamp`.                                                      |
| `src/features/agent-status/hooks/useAgentStatus.test.ts`         | New assertion: `active.startedAt` mirrors the incoming timestamp.                                                     |
| `src/features/agent-status/components/AgentStatusPanel.tsx`      | Mount `<ActivityFeed events={...} />` between `<ContextBucket>` and `<ToolCallSummary>`.                              |
| `src/features/agent-status/components/AgentStatusPanel.test.tsx` | New assertion: `ActivityFeed` renders between `ContextBucket` and `ToolCallSummary`; existing consumers still render. |

### Deleted

| Path                                                                                                            | Reason                                                         |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `src/features/workspace/components/AgentActivity/` (entire directory, 9 components + 9 test files + `index.ts`) | Orphaned — replaced by `AgentStatusPanel`; no external import. |

---

## Task Order

1. Delete orphaned `AgentActivity/` folder
2. Create `types/activityEvent.ts` (pure types)
3. Extend `ActiveToolCall.startedAt` + wire `useAgentStatus` (TDD)
4. Create `utils/relativeTime.ts` + `formatDuration` (TDD)
5. Create `utils/toolCallsToEvents.ts` (TDD)
6. Create `hooks/useActivityEvents.ts` (TDD)
7. Build `ActivityEvent` — basic row (icon / label / body / relative timestamp) (TDD)
8. Build `ActivityEvent` — status chips (diff + bash pill) (TDD)
9. Build `ActivityEvent` — running state (animated dot + `running Xs`) (TDD)
10. Build `ActivityFeed` — header, rail, ordered list, empty state, `now` timer (TDD)
11. Wire `ActivityFeed` into `AgentStatusPanel` (TDD)

---

### Task 1: Delete orphaned `AgentActivity/` folder

**Files:**

- Delete: `src/features/workspace/components/AgentActivity/` (whole directory)

- [ ] **Step 1: Verify no external imports**

Run: `rg -l "from '.*AgentActivity" src/ --type ts --type tsx`

Expected: only paths INSIDE `src/features/workspace/components/AgentActivity/` (self-imports). If any other file appears, STOP and investigate.

- [ ] **Step 2: Delete the directory**

Run: `rm -rf src/features/workspace/components/AgentActivity`

- [ ] **Step 3: Type-check and test**

Run: `npm run type-check && npm run test -- --run`

Expected: both PASS. If type-check fails with "Cannot find module '.../AgentActivity'", there was an external import we missed — restore the folder (`git checkout -- src/features/workspace/components/AgentActivity`) and re-investigate.

- [ ] **Step 4: Commit**

```bash
git add -A src/features/workspace/components/AgentActivity
git commit -m "chore(agent-activity): delete orphaned AgentActivity folder

Replaced by AgentStatusPanel — never mounted outside its own tests.
A comment in WorkspaceView.verification.test.tsx already documents the
supersession."
```

---

### Task 2: Create `types/activityEvent.ts`

**Files:**

- Create: `src/features/agent-status/types/activityEvent.ts`

This is a pure-type file; no runtime test — downstream mapper tests (Task 5) exercise the types.

- [ ] **Step 1: Create the file with the discriminated union**

Write `src/features/agent-status/types/activityEvent.ts`:

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/agent-status/types/activityEvent.ts
git commit -m "feat(agent-status): add ActivityEvent discriminated union

Covers tool-call kinds rendered today (edit/bash/read/write/grep/glob)
plus reserved kinds (think/user/meta) for future transcript-parser
extensions. See docs/superpowers/specs/2026-04-22-activity-feed-design.md
§Type system."
```

---

### Task 3: Extend `ActiveToolCall.startedAt` + wire producer

**Files:**

- Modify: `src/features/agent-status/types/index.ts` (add `startedAt: string` to `ActiveToolCall`)
- Modify: `src/features/agent-status/hooks/useAgentStatus.ts` (set `startedAt: p.timestamp` in `running` branch)
- Test: `src/features/agent-status/hooks/useAgentStatus.test.ts` (new assertion)

- [ ] **Step 1: Add a failing test**

Find the existing "updates active tool call" test in `useAgentStatus.test.ts` (or add a new one if none exists). Add this block near the other tool-call event tests — emit a `running` event and assert `startedAt`:

```ts
test('stores startedAt from the running tool-call timestamp', async () => {
  const { result } = renderHook(() => useAgentStatus('session-1'))

  // Wait for event subscription to be ready (listen mock resolves async)
  await vi.waitFor(() => {
    expect(
      (eventListeners.get('agent-tool-call') ?? []).length
    ).toBeGreaterThan(0)
  })

  act(() => {
    emit('agent-tool-call', {
      sessionId: 'pty-session-1',
      tool: 'Edit',
      args: 'src/foo.ts',
      status: 'running',
      durationMs: 0n,
      timestamp: '2026-04-22T10:30:00Z',
    })
  })

  expect(result.current.toolCalls.active).toEqual({
    tool: 'Edit',
    args: 'src/foo.ts',
    startedAt: '2026-04-22T10:30:00Z',
  })
})
```

Note: `durationMs: 0n` because the `AgentToolCallEvent` binding uses `bigint` for duration. The existing test file at the top of the conversation showed `Number(p.durationMs) || null` — BigInt inputs are expected.

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/features/agent-status/hooks/useAgentStatus.test.ts`

Expected: FAIL — either a type error (`startedAt` not on `ActiveToolCall`) or an assertion mismatch (`active` is `{ tool, args }` without `startedAt`).

- [ ] **Step 3: Extend the type**

Modify `src/features/agent-status/types/index.ts` — change the `ActiveToolCall` interface:

```ts
export interface ActiveToolCall {
  tool: string
  args: string
  startedAt: string
}
```

- [ ] **Step 4: Run the test — still failing (producer doesn't set it yet)**

Run: `npx vitest run src/features/agent-status/hooks/useAgentStatus.test.ts`

Expected: FAIL on the assertion (type now compiles, but the value has no `startedAt`).

- [ ] **Step 5: Update the producer**

In `src/features/agent-status/hooks/useAgentStatus.ts`, find the `p.status === 'running'` branch (inside the `unlistenToolCall` callback) and add `startedAt`:

```ts
if (p.status === 'running') {
  setStatus((prev) => ({
    ...prev,
    toolCalls: {
      ...prev.toolCalls,
      active: { tool: p.tool, args: p.args, startedAt: p.timestamp },
    },
  }))
}
```

- [ ] **Step 6: Run the test — now passing**

Run: `npx vitest run src/features/agent-status/hooks/useAgentStatus.test.ts`

Expected: PASS.

- [ ] **Step 7: Run the full test suite to catch fallout**

Run: `npm run test -- --run`

Expected: PASS. If `AgentStatusPanel.test.tsx` or `ToolCallSummary.test.tsx` fails because their fixtures construct `ActiveToolCall` without `startedAt`, update those fixtures inline (add `startedAt: '2026-01-01T00:00:00Z'`) and re-run.

- [ ] **Step 8: Commit**

```bash
git add src/features/agent-status/types/index.ts \
        src/features/agent-status/hooks/useAgentStatus.ts \
        src/features/agent-status/hooks/useAgentStatus.test.ts \
        src/features/agent-status/components/AgentStatusPanel.test.tsx \
        src/features/agent-status/components/ToolCallSummary.test.tsx
# (the last two lines only if fixtures were touched)
git commit -m "feat(agent-status): store startedAt on ActiveToolCall

Enables the ActivityFeed running row to compute live duration.
Sourced from AgentToolCallEvent.timestamp — no Rust changes."
```

---

### Task 4: Create `utils/relativeTime.ts` + `formatDuration`

**Files:**

- Create: `src/features/agent-status/utils/relativeTime.ts`
- Test: `src/features/agent-status/utils/relativeTime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/agent-status/utils/relativeTime.test.ts`:

```ts
import { describe, test, expect } from 'vitest'
import { formatRelativeTime, formatDuration } from './relativeTime'

describe('formatRelativeTime', () => {
  const now = new Date('2026-04-22T12:00:00Z')

  const iso = (deltaSec: number): string =>
    new Date(now.getTime() - deltaSec * 1000).toISOString()

  test.each([
    [0, 'now'],
    [4, 'now'],
    [5, '5s ago'],
    [59, '59s ago'],
    [60, '1m ago'],
    [61, '1m ago'],
    [119, '1m ago'],
    [120, '2m ago'],
    [59 * 60, '59m ago'],
    [60 * 60, '1h ago'],
    [23 * 60 * 60, '23h ago'],
    [24 * 60 * 60, '1d ago'],
    [48 * 60 * 60, '2d ago'],
  ])('%is ago → %s', (deltaSec, expected) => {
    expect(formatRelativeTime(iso(deltaSec), now)).toBe(expected)
  })
})

describe('formatDuration', () => {
  test.each([
    [0, '0s'],
    [999, '0s'],
    [1000, '1s'],
    [59_000, '59s'],
    [60_000, '1m 0s'],
    [61_000, '1m 1s'],
    [3_599_000, '59m 59s'],
    [3_600_000, '1h 0m'],
    [3_660_000, '1h 1m'],
  ])('%i ms → %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/features/agent-status/utils/relativeTime.test.ts`

Expected: FAIL with `Cannot find module './relativeTime'`.

- [ ] **Step 3: Implement the module**

Create `src/features/agent-status/utils/relativeTime.ts`:

```ts
export const formatRelativeTime = (
  iso: string,
  now: Date = new Date()
): string => {
  const deltaMs = now.getTime() - new Date(iso).getTime()
  const s = Math.floor(deltaMs / 1000)
  if (s < 5) {
    return 'now'
  }
  if (s < 60) {
    return `${s}s ago`
  }
  const m = Math.floor(s / 60)
  if (m < 60) {
    return `${m}m ago`
  }
  const h = Math.floor(m / 60)
  if (h < 24) {
    return `${h}h ago`
  }
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export const formatDuration = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  if (s < 60) {
    return `${s}s`
  }
  const m = Math.floor(s / 60)
  if (m < 60) {
    return `${m}m ${s % 60}s`
  }
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
```

(ESLint `curly: always` — every control-flow body uses braces, even single-statement returns. See `rules/typescript/coding-style/CLAUDE.md`.)

- [ ] **Step 4: Run tests — PASS**

Run: `npx vitest run src/features/agent-status/utils/relativeTime.test.ts`

Expected: PASS, all table cases green.

- [ ] **Step 5: Commit**

```bash
git add src/features/agent-status/utils/relativeTime.ts \
        src/features/agent-status/utils/relativeTime.test.ts
git commit -m "feat(agent-status): add relativeTime + formatDuration utils

formatRelativeTime turns ISO-8601 into 'now' / 'Ns ago' / 'Nm ago' /
'Nh ago' / 'Nd ago'. formatDuration renders milliseconds as 'Ns' /
'Nm Ms' / 'Nh Mm' for the ActivityFeed's running-row timestamp."
```

---

### Task 5: Create `utils/toolCallsToEvents.ts`

**Files:**

- Create: `src/features/agent-status/utils/toolCallsToEvents.ts`
- Test: `src/features/agent-status/utils/toolCallsToEvents.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/agent-status/utils/toolCallsToEvents.test.ts`:

```ts
import { describe, test, expect } from 'vitest'
import { toolCallsToEvents } from './toolCallsToEvents'
import type { ActiveToolCall, RecentToolCall } from '../types'

const recent = (overrides: Partial<RecentToolCall> = {}): RecentToolCall => ({
  id: 'r-1',
  tool: 'Read',
  args: 'src/foo.ts',
  status: 'done',
  durationMs: 100,
  timestamp: '2026-04-22T10:00:00Z',
  ...overrides,
})

describe('toolCallsToEvents', () => {
  test('null active + empty recent → empty array', () => {
    expect(toolCallsToEvents(null, [])).toEqual([])
  })

  test('active only → one running event with startedAt as timestamp', () => {
    const active: ActiveToolCall = {
      tool: 'Edit',
      args: 'src/foo.ts',
      startedAt: '2026-04-22T10:30:00Z',
    }
    const events = toolCallsToEvents(active, [])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'edit',
      tool: 'Edit',
      body: 'src/foo.ts',
      status: 'running',
      timestamp: '2026-04-22T10:30:00Z',
      durationMs: null,
    })
  })

  test('recent only → events in given order', () => {
    const r1 = recent({ id: 'a', tool: 'Bash', args: 'ls' })
    const r2 = recent({ id: 'b', tool: 'Read', args: 'x.ts' })
    const events = toolCallsToEvents(null, [r1, r2])
    expect(events.map((e) => e.id)).toEqual(['a', 'b'])
  })

  test('active is prepended to recent', () => {
    const active: ActiveToolCall = {
      tool: 'Edit',
      args: 'src/foo.ts',
      startedAt: '2026-04-22T10:30:00Z',
    }
    const r1 = recent({ id: 'a' })
    const events = toolCallsToEvents(active, [r1])
    expect(events[0].status).toBe('running')
    expect(events[1].id).toBe('a')
  })

  test.each([
    ['Edit', 'edit'],
    ['MultiEdit', 'edit'],
    ['Write', 'write'],
    ['NotebookEdit', 'write'],
    ['Read', 'read'],
    ['Bash', 'bash'],
    ['Grep', 'grep'],
    ['Glob', 'glob'],
    ['WebFetch', 'meta'],
    ['Task', 'meta'],
    ['NotARealTool', 'meta'],
  ])('tool %s → kind %s', (tool, expectedKind) => {
    const events = toolCallsToEvents(null, [recent({ tool })])
    expect(events[0].kind).toBe(expectedKind)
  })

  test('passes through status, duration, id, timestamp', () => {
    const r = recent({
      id: 'xyz',
      status: 'failed',
      durationMs: 5400,
      timestamp: '2026-04-22T09:00:00Z',
    })
    const events = toolCallsToEvents(null, [r])
    expect(events[0]).toMatchObject({
      id: 'xyz',
      status: 'failed',
      durationMs: 5400,
      timestamp: '2026-04-22T09:00:00Z',
    })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/features/agent-status/utils/toolCallsToEvents.test.ts`

Expected: FAIL with `Cannot find module './toolCallsToEvents'`.

- [ ] **Step 3: Implement the mapper**

Create `src/features/agent-status/utils/toolCallsToEvents.ts`:

```ts
import type { ActivityEvent, ActivityEventKind } from '../types/activityEvent'
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

- [ ] **Step 4: Run tests — PASS**

Run: `npx vitest run src/features/agent-status/utils/toolCallsToEvents.test.ts`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/agent-status/utils/toolCallsToEvents.ts \
        src/features/agent-status/utils/toolCallsToEvents.test.ts
git commit -m "feat(agent-status): add toolCallsToEvents mapper

Pure function turning an AgentStatus tool-call slice into the
ActivityEvent[] shape the feed consumes. Unknown tool names fall
back to the 'meta' kind (escalate to named kinds when their visual
contract is settled)."
```

---

### Task 6: Create `hooks/useActivityEvents.ts`

**Files:**

- Create: `src/features/agent-status/hooks/useActivityEvents.ts`
- Test: `src/features/agent-status/hooks/useActivityEvents.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/agent-status/hooks/useActivityEvents.test.tsx`:

```tsx
import { describe, test, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useActivityEvents } from './useActivityEvents'
import type { AgentStatus } from '../types'

const baseStatus: AgentStatus = {
  isActive: true,
  agentType: 'claude-code',
  modelId: null,
  modelDisplayName: null,
  version: null,
  sessionId: 'session-1',
  agentSessionId: null,
  contextWindow: null,
  cost: null,
  rateLimits: null,
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
}

describe('useActivityEvents', () => {
  test('returns empty array when there are no tool calls', () => {
    const { result } = renderHook(() => useActivityEvents(baseStatus))
    expect(result.current).toEqual([])
  })

  test('returns the same array reference when the status is unchanged', () => {
    const { result, rerender } = renderHook(
      ({ status }) => useActivityEvents(status),
      { initialProps: { status: baseStatus } }
    )
    const first = result.current

    rerender({ status: baseStatus })
    expect(result.current).toBe(first)
  })

  test('returns the same array reference when only unrelated slices change', () => {
    const s1: AgentStatus = { ...baseStatus, cost: null }
    const s2: AgentStatus = {
      ...baseStatus,
      cost: {
        totalCostUsd: 1,
        totalDurationMs: 0,
        totalApiDurationMs: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
      },
    }
    const { result, rerender } = renderHook(
      ({ status }) => useActivityEvents(status),
      { initialProps: { status: s1 } }
    )
    const first = result.current

    rerender({ status: s2 })
    expect(result.current).toBe(first)
  })

  test('returns a new array reference when active changes', () => {
    const s1: AgentStatus = baseStatus
    const s2: AgentStatus = {
      ...baseStatus,
      toolCalls: {
        total: 0,
        byType: {},
        active: {
          tool: 'Edit',
          args: 'src/foo.ts',
          startedAt: '2026-04-22T10:00:00Z',
        },
      },
    }
    const { result, rerender } = renderHook(
      ({ status }) => useActivityEvents(status),
      { initialProps: { status: s1 } }
    )
    const first = result.current

    rerender({ status: s2 })
    expect(result.current).not.toBe(first)
    expect(result.current).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/features/agent-status/hooks/useActivityEvents.test.tsx`

Expected: FAIL with `Cannot find module './useActivityEvents'`.

- [ ] **Step 3: Implement the hook**

Create `src/features/agent-status/hooks/useActivityEvents.ts`:

```ts
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

- [ ] **Step 4: Run tests — PASS**

Run: `npx vitest run src/features/agent-status/hooks/useActivityEvents.test.tsx`

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/agent-status/hooks/useActivityEvents.ts \
        src/features/agent-status/hooks/useActivityEvents.test.tsx
git commit -m "feat(agent-status): add useActivityEvents memoizing hook

Derives ActivityEvent[] from the AgentStatus slice, memoized on
active + recent references only. No Context or global store —
consumer(s) live inside AgentStatusPanel. Lift to Context later
when a cross-panel consumer appears."
```

---

### Task 7: `ActivityEvent` — basic row (icon / label / body / timestamp)

**Files:**

- Create: `src/features/agent-status/components/ActivityEvent.tsx`
- Test: `src/features/agent-status/components/ActivityEvent.test.tsx`

This task covers the common render path for `done` / `failed` events across all kinds. Tasks 8 and 9 add chips and running state on top.

- [ ] **Step 1: Write the failing test**

Create `src/features/agent-status/components/ActivityEvent.test.tsx`:

```tsx
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityEvent } from './ActivityEvent'
import type { ToolActivityEvent } from '../types/activityEvent'

const now = new Date('2026-04-22T12:00:00Z')

const toolEvent = (
  overrides: Partial<ToolActivityEvent> = {}
): ToolActivityEvent => ({
  id: 't-1',
  kind: 'edit',
  tool: 'Edit',
  body: 'src/foo.ts',
  timestamp: '2026-04-22T11:59:42Z', // 18s ago
  status: 'done',
  durationMs: 120,
  ...overrides,
})

describe('ActivityEvent — basic row', () => {
  test('renders type label in uppercase', () => {
    render(<ActivityEvent event={toolEvent({ kind: 'edit' })} now={now} />)
    expect(screen.getByText('EDIT')).toBeInTheDocument()
  })

  test('renders body text', () => {
    render(
      <ActivityEvent
        event={toolEvent({ body: 'src/utils/jwt.ts' })}
        now={now}
      />
    )
    expect(screen.getByText('src/utils/jwt.ts')).toBeInTheDocument()
  })

  test.each([
    { kind: 'edit' as const, tool: 'Edit', symbol: 'edit', label: 'EDIT' },
    {
      kind: 'write' as const,
      tool: 'Write',
      symbol: 'edit_note',
      label: 'WRITE',
    },
    {
      kind: 'read' as const,
      tool: 'Read',
      symbol: 'visibility',
      label: 'READ',
    },
    { kind: 'bash' as const, tool: 'Bash', symbol: 'terminal', label: 'BASH' },
    { kind: 'grep' as const, tool: 'Grep', symbol: 'search', label: 'GREP' },
    {
      kind: 'glob' as const,
      tool: 'Glob',
      symbol: 'find_in_page',
      label: 'GLOB',
    },
    {
      kind: 'meta' as const,
      tool: 'WebFetch',
      symbol: 'tune',
      label: 'WEBFETCH',
    },
  ])(
    'renders $label icon as material symbol $symbol',
    ({ kind, tool, symbol, label }) => {
      render(<ActivityEvent event={toolEvent({ kind, tool })} now={now} />)
      const article = screen.getByRole('article', { name: label })
      // eslint-disable-next-line testing-library/no-node-access -- verifying icon symbol text (Material Symbols pattern, see rules/typescript/testing/CLAUDE.md)
      const icon = article.querySelector('.material-symbols-outlined')
      expect(icon).toHaveTextContent(symbol)
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }
  )

  test('renders relative timestamp for done events', () => {
    render(<ActivityEvent event={toolEvent({ status: 'done' })} now={now} />)
    expect(screen.getByText('18s ago')).toBeInTheDocument()
  })

  test('renders relative timestamp for failed events', () => {
    render(<ActivityEvent event={toolEvent({ status: 'failed' })} now={now} />)
    expect(screen.getByText('18s ago')).toBeInTheDocument()
  })

  test('meta kind uses raw tool name as label', () => {
    render(
      <ActivityEvent
        event={toolEvent({ kind: 'meta', tool: 'WebFetch' })}
        now={now}
      />
    )
    expect(screen.getByText('WEBFETCH')).toBeInTheDocument()
  })

  test('think kind renders body as italic', () => {
    render(
      <ActivityEvent
        event={{
          id: 'th-1',
          kind: 'think',
          body: 'reconsidering the approach',
          timestamp: '2026-04-22T11:59:42Z',
          status: 'done',
        }}
        now={now}
      />
    )
    const body = screen.getByText('reconsidering the approach')
    expect(body).toHaveClass('italic')
  })

  test('user kind renders body without mono font', () => {
    render(
      <ActivityEvent
        event={{
          id: 'u-1',
          kind: 'user',
          body: 'refactor this',
          timestamp: '2026-04-22T11:59:42Z',
          status: 'done',
        }}
        now={now}
      />
    )
    const body = screen.getByText('refactor this')
    expect(body).not.toHaveClass('font-mono')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/features/agent-status/components/ActivityEvent.test.tsx`

Expected: FAIL with `Cannot find module './ActivityEvent'`.

- [ ] **Step 3: Implement the component — basic render only**

Create `src/features/agent-status/components/ActivityEvent.tsx`:

```tsx
import type { ReactElement } from 'react'
import { formatRelativeTime } from '../utils/relativeTime'
import type {
  ActivityEvent as ActivityEventType,
  ActivityEventKind,
} from '../types/activityEvent'

interface ActivityEventProps {
  event: ActivityEventType
  now: Date
}

const KIND_ICON: Record<ActivityEventKind, string> = {
  edit: 'edit',
  write: 'edit_note',
  read: 'visibility',
  bash: 'terminal',
  grep: 'search',
  glob: 'find_in_page',
  think: 'psychology',
  user: 'person',
  meta: 'tune',
}

const KIND_COLOR: Record<ActivityEventKind, string> = {
  edit: 'text-primary-container',
  write: 'text-primary-container',
  read: 'text-on-surface-variant',
  bash: 'text-secondary',
  grep: 'text-on-surface-variant',
  glob: 'text-on-surface-variant',
  think: 'text-primary-container',
  user: 'text-tertiary',
  meta: 'text-outline',
}

const getLabel = (event: ActivityEventType): string => {
  if (event.kind === 'meta' && 'tool' in event) {
    return event.tool.toUpperCase()
  }
  return event.kind.toUpperCase()
}

const getBodyClass = (kind: ActivityEventKind): string => {
  if (kind === 'think') return 'text-xs text-on-surface italic'
  if (kind === 'user') return 'text-xs text-on-surface'
  return 'text-xs text-on-surface font-mono'
}

export const ActivityEvent = ({
  event,
  now,
}: ActivityEventProps): ReactElement => {
  const symbol = KIND_ICON[event.kind]
  const colorClass = KIND_COLOR[event.kind]
  const label = getLabel(event)
  const timestamp = formatRelativeTime(event.timestamp, now)

  return (
    <article aria-label={label} className="flex items-start gap-2 py-1.5">
      <span
        className={`material-symbols-outlined text-sm ${colorClass} w-6 h-6 rounded-md bg-surface-container-high flex items-center justify-center`}
        aria-hidden="true"
      >
        {symbol}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-[10px] font-bold uppercase tracking-[0.12em] ${colorClass}`}
          >
            {label}
          </span>
          <span className="text-[9px] font-mono text-outline">{timestamp}</span>
        </div>
        <div className={`mt-0.5 truncate ${getBodyClass(event.kind)}`}>
          {event.body}
        </div>
      </div>
    </article>
  )
}
```

The `<article>` with `aria-label` follows `rules/typescript/coding-style/a11y-components.md` — native semantic element + accessible name on the parent, icon child is `aria-hidden`.

- [ ] **Step 4: Run tests — PASS**

Run: `npx vitest run src/features/agent-status/components/ActivityEvent.test.tsx`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/agent-status/components/ActivityEvent.tsx \
        src/features/agent-status/components/ActivityEvent.test.tsx
git commit -m "feat(agent-status): add ActivityEvent — basic row render

Covers label, icon (Material Symbols Outlined), body, and relative
timestamp for done/failed events across all kinds. Status chips and
running state follow in separate commits."
```

---

### Task 8: `ActivityEvent` — status chips (diff + bash pill)

**Files:**

- Modify: `src/features/agent-status/components/ActivityEvent.tsx` (add chip rendering)
- Modify: `src/features/agent-status/components/ActivityEvent.test.tsx` (add chip tests)

- [ ] **Step 1: Add failing tests**

Append to `src/features/agent-status/components/ActivityEvent.test.tsx`:

```tsx
describe('ActivityEvent — diff chips (EDIT/WRITE)', () => {
  test('renders +N and −M chips when diff is present', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'edit',
          diff: { added: 12, removed: 2 },
        })}
        now={now}
      />
    )
    expect(screen.getByText('+12')).toBeInTheDocument()
    expect(screen.getByText('−2')).toBeInTheDocument()
  })

  test('does not render diff chips when diff is absent', () => {
    render(<ActivityEvent event={toolEvent({ kind: 'edit' })} now={now} />)
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^−/)).not.toBeInTheDocument()
  })

  test('does not render diff chips for non-edit/write kinds even if diff is passed', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'read',
          tool: 'Read',
          diff: { added: 1, removed: 1 },
        })}
        now={now}
      />
    )
    expect(screen.queryByText('+1')).not.toBeInTheDocument()
  })
})

describe('ActivityEvent — bash status pill', () => {
  test('status=done + bashResult → "OK {passed}/{total}" in success palette', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'bash',
          tool: 'Bash',
          status: 'done',
          bashResult: { passed: 4, total: 4 },
        })}
        now={now}
      />
    )
    const pill = screen.getByText('OK 4/4')
    expect(pill).toHaveClass('text-success')
  })

  test('status=failed + bashResult → "FAILED {passed}/{total}" in error palette', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'bash',
          tool: 'Bash',
          status: 'failed',
          bashResult: { passed: 1, total: 4 },
        })}
        now={now}
      />
    )
    const pill = screen.getByText('FAILED 1/4')
    expect(pill).toHaveClass('text-error')
  })

  test('status=done, no bashResult → "OK" in success palette', () => {
    render(
      <ActivityEvent
        event={toolEvent({ kind: 'bash', tool: 'Bash', status: 'done' })}
        now={now}
      />
    )
    const pill = screen.getByText('OK')
    expect(pill).toHaveClass('text-success')
  })

  test('status=failed, no bashResult → "FAILED" in error palette', () => {
    render(
      <ActivityEvent
        event={toolEvent({ kind: 'bash', tool: 'Bash', status: 'failed' })}
        now={now}
      />
    )
    const pill = screen.getByText('FAILED')
    expect(pill).toHaveClass('text-error')
  })

  test('non-bash kinds render no status pill', () => {
    render(
      <ActivityEvent
        event={toolEvent({ kind: 'read', tool: 'Read', status: 'done' })}
        now={now}
      />
    )
    expect(screen.queryByText('OK')).not.toBeInTheDocument()
    expect(screen.queryByText('FAILED')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — FAIL**

Run: `npx vitest run src/features/agent-status/components/ActivityEvent.test.tsx`

Expected: new tests FAIL (chips not rendered); existing basic tests continue to PASS.

- [ ] **Step 3: Add chip rendering to the component**

Modify `src/features/agent-status/components/ActivityEvent.tsx`. Replace the existing `return (...)` block with this extended version that renders row 3 conditionally:

```tsx
export const ActivityEvent = ({
  event,
  now,
}: ActivityEventProps): ReactElement => {
  const symbol = KIND_ICON[event.kind]
  const colorClass = KIND_COLOR[event.kind]
  const label = getLabel(event)
  const timestamp = formatRelativeTime(event.timestamp, now)

  return (
    <div className="flex items-start gap-2 py-1.5">
      <span
        className={`material-symbols-outlined text-sm ${colorClass} w-6 h-6 rounded-md bg-surface-container-high flex items-center justify-center`}
        aria-hidden="true"
      >
        {symbol}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-[10px] font-bold uppercase tracking-[0.12em] ${colorClass}`}
          >
            {label}
          </span>
          <span className="text-[9px] font-mono text-outline">{timestamp}</span>
        </div>
        <div className={`mt-0.5 truncate ${getBodyClass(event.kind)}`}>
          {event.body}
        </div>
        <StatusChips event={event} />
      </div>
    </div>
  )
}

interface StatusChipsProps {
  event: ActivityEventType
}

const StatusChips = ({ event }: StatusChipsProps): ReactElement | null => {
  if (event.kind === 'edit' || event.kind === 'write') {
    if (!event.diff) {
      return null
    }
    return (
      <div className="mt-1 flex items-center gap-2">
        <span className="text-[9px] font-mono text-success">
          +{event.diff.added}
        </span>
        <span className="text-[9px] font-mono text-error">
          −{event.diff.removed}
        </span>
      </div>
    )
  }

  if (event.kind === 'bash') {
    // Running is handled by the running-state dot; no pill.
    if (event.status === 'running') {
      return null
    }
    const verb = event.status === 'done' ? 'OK' : 'FAILED'
    const palette =
      event.status === 'done'
        ? 'bg-success/[0.12] text-success'
        : 'bg-error/[0.12] text-error'
    const text = event.bashResult
      ? `${verb} ${event.bashResult.passed}/${event.bashResult.total}`
      : verb

    return (
      <div className="mt-1">
        <span
          className={`inline-block rounded-md px-2 py-0.5 text-[9px] font-bold uppercase ${palette}`}
        >
          {text}
        </span>
      </div>
    )
  }

  return null
}
```

- [ ] **Step 4: Run tests — PASS**

Run: `npx vitest run src/features/agent-status/components/ActivityEvent.test.tsx`

Expected: all PASS (basic + new chip tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/agent-status/components/ActivityEvent.tsx \
        src/features/agent-status/components/ActivityEvent.test.tsx
git commit -m "feat(agent-status): ActivityEvent diff + bash status chips

diff chips render +N/−M for edit/write when present. Bash pill
derives verb from status (OK for done, FAILED for failed); bashResult
counts append as '{verb} {passed}/{total}' when the producer provides
them. Non-bash events render no pill."
```

---

### Task 9: `ActivityEvent` — running state (animated dot + `running Xs`)

**Files:**

- Modify: `src/features/agent-status/components/ActivityEvent.tsx`
- Modify: `src/features/agent-status/components/ActivityEvent.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `ActivityEvent.test.tsx`:

```tsx
describe('ActivityEvent — running state', () => {
  test('renders animated dot with role="status" for running events', () => {
    render(
      <ActivityEvent
        event={{
          id: 'active-Edit',
          kind: 'edit',
          tool: 'Edit',
          body: 'src/foo.ts',
          timestamp: '2026-04-22T11:59:52Z', // 8s before now
          status: 'running',
          durationMs: null,
        }}
        now={now}
      />
    )
    const dot = screen.getByRole('status', { name: 'running' })
    expect(dot).toHaveClass('animate-pulse')
    expect(dot).toHaveClass('bg-success')
  })

  test('running timestamp reads "running Xs" computed from startedAt', () => {
    render(
      <ActivityEvent
        event={{
          id: 'active-Bash',
          kind: 'bash',
          tool: 'Bash',
          body: 'pnpm test',
          timestamp: '2026-04-22T11:59:52Z', // 8s before now
          status: 'running',
          durationMs: null,
        }}
        now={now}
      />
    )
    expect(screen.getByText('running 8s')).toBeInTheDocument()
  })

  test('running events render no status pill', () => {
    render(
      <ActivityEvent
        event={{
          id: 'active-Bash',
          kind: 'bash',
          tool: 'Bash',
          body: 'pnpm test',
          timestamp: '2026-04-22T11:59:52Z',
          status: 'running',
          durationMs: null,
        }}
        now={now}
      />
    )
    expect(screen.queryByText('OK')).not.toBeInTheDocument()
    expect(screen.queryByText('FAILED')).not.toBeInTheDocument()
  })

  test('non-running events do not render the animated dot', () => {
    render(<ActivityEvent event={toolEvent({ status: 'done' })} now={now} />)
    expect(
      screen.queryByRole('status', { name: 'running' })
    ).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run src/features/agent-status/components/ActivityEvent.test.tsx`

Expected: new running-state tests FAIL; others PASS.

- [ ] **Step 3: Update the component to handle running state**

Replace the `return (...)` block of `ActivityEvent.tsx` with a version that branches on `status === 'running'` for the timestamp slot and dot overlay. Also import `formatDuration`:

Change the top import:

```ts
import { formatRelativeTime, formatDuration } from '../utils/relativeTime'
```

Replace the `return (...)` block:

```tsx
const isRunning = event.status === 'running'
const timestampText = isRunning
  ? `running ${formatDuration(now.getTime() - new Date(event.timestamp).getTime())}`
  : formatRelativeTime(event.timestamp, now)

return (
  <article aria-label={label} className="flex items-start gap-2 py-1.5">
    <div className="relative">
      <span
        className={`material-symbols-outlined text-sm ${colorClass} w-6 h-6 rounded-md bg-surface-container-high flex items-center justify-center`}
        aria-hidden="true"
      >
        {symbol}
      </span>
      {isRunning && (
        <span
          role="status"
          aria-label="running"
          className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-success animate-pulse"
        />
      )}
    </div>

    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`text-[10px] font-bold uppercase tracking-[0.12em] ${colorClass}`}
        >
          {label}
        </span>
        <span className="text-[9px] font-mono text-outline">
          {timestampText}
        </span>
      </div>
      <div className={`mt-0.5 truncate ${getBodyClass(event.kind)}`}>
        {event.body}
      </div>
      <StatusChips event={event} />
    </div>
  </article>
)
```

(The existing `StatusChips` helper from Task 8 already returns `null` for `status === 'running'` inside the bash branch.)

- [ ] **Step 4: Run tests — PASS**

Run: `npx vitest run src/features/agent-status/components/ActivityEvent.test.tsx`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/agent-status/components/ActivityEvent.tsx \
        src/features/agent-status/components/ActivityEvent.test.tsx
git commit -m "feat(agent-status): ActivityEvent running state

Running entries render an animate-pulse dot overlay on the icon
chip and replace the relative timestamp with 'running Xs' computed
from startedAt. Matches ToolCallSummary's animate-pulse convention —
no new keyframes."
```

---

### Task 10: `ActivityFeed` — shell (header, rail, list, empty state, `now` timer)

**Files:**

- Create: `src/features/agent-status/components/ActivityFeed.tsx`
- Test: `src/features/agent-status/components/ActivityFeed.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/agent-status/components/ActivityFeed.test.tsx`:

```tsx
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ActivityFeed } from './ActivityFeed'
import type { ActivityEvent as ActivityEventType } from '../types/activityEvent'

const fixedNow = new Date('2026-04-22T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(fixedNow)
})

afterEach(() => {
  vi.useRealTimers()
})

const doneEvent = (id: string, body: string): ActivityEventType => ({
  id,
  kind: 'edit',
  tool: 'Edit',
  body,
  timestamp: '2026-04-22T11:59:42Z', // 18s ago
  status: 'done',
  durationMs: 120,
})

describe('ActivityFeed', () => {
  test('renders the ACTIVITY section header', () => {
    render(<ActivityFeed events={[]} />)
    expect(screen.getByText('ACTIVITY')).toBeInTheDocument()
  })

  test('renders "No activity yet" when events is empty', () => {
    render(<ActivityFeed events={[]} />)
    expect(screen.getByText('No activity yet')).toBeInTheDocument()
  })

  test('does NOT render the empty-state text when events has entries', () => {
    render(<ActivityFeed events={[doneEvent('a', 'src/a.ts')]} />)
    expect(screen.queryByText('No activity yet')).not.toBeInTheDocument()
  })

  test('renders events in given order', () => {
    render(
      <ActivityFeed
        events={[
          doneEvent('a', 'src/first.ts'),
          doneEvent('b', 'src/second.ts'),
          doneEvent('c', 'src/third.ts'),
        ]}
      />
    )

    const articles = screen.getAllByRole('article')
    expect(articles).toHaveLength(3)
    expect(articles[0]).toHaveTextContent('src/first.ts')
    expect(articles[1]).toHaveTextContent('src/second.ts')
    expect(articles[2]).toHaveTextContent('src/third.ts')
  })

  test('rail layout element is present (last-resort testid)', () => {
    render(<ActivityFeed events={[doneEvent('a', 'src/a.ts')]} />)
    expect(screen.getByTestId('activity-feed-rail')).toBeInTheDocument()
  })

  test('running event duration advances as the timer ticks', () => {
    const runningEvent: ActivityEventType = {
      id: 'active-Bash',
      kind: 'bash',
      tool: 'Bash',
      body: 'pnpm test',
      timestamp: '2026-04-22T11:59:52Z', // 8s before fixedNow
      status: 'running',
      durationMs: null,
    }

    render(<ActivityFeed events={[runningEvent]} />)
    expect(screen.getByText('running 8s')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByText('running 9s')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run src/features/agent-status/components/ActivityFeed.test.tsx`

Expected: FAIL with `Cannot find module './ActivityFeed'`.

- [ ] **Step 3: Implement the feed**

Create `src/features/agent-status/components/ActivityFeed.tsx`:

```tsx
import { useEffect, useState, type ReactElement } from 'react'
import { ActivityEvent } from './ActivityEvent'
import type { ActivityEvent as ActivityEventType } from '../types/activityEvent'

interface ActivityFeedProps {
  events: ActivityEventType[]
}

const TICK_MS = 1000

export const ActivityFeed = ({ events }: ActivityFeedProps): ReactElement => {
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS)
    return (): void => clearInterval(id)
  }, [])

  return (
    <div className="border-t border-outline-variant/[0.08] px-5 py-3">
      <div className="mb-2">
        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-outline">
          ACTIVITY
        </span>
      </div>

      {events.length === 0 ? (
        <p className="text-xs text-on-surface-variant">No activity yet</p>
      ) : (
        <div className="relative">
          <div
            data-testid="activity-feed-rail"
            className="absolute left-3 top-0 bottom-0 w-px bg-outline-variant/40"
            aria-hidden="true"
          />
          <div className="relative flex flex-col">
            {events.map((event) => (
              <ActivityEvent key={event.id} event={event} now={now} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests — PASS**

Run: `npx vitest run src/features/agent-status/components/ActivityFeed.test.tsx`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/agent-status/components/ActivityFeed.tsx \
        src/features/agent-status/components/ActivityFeed.test.tsx
git commit -m "feat(agent-status): add ActivityFeed shell

Renders ACTIVITY section header, empty state, and an ordered list
of ActivityEvent rows on a 1px outline-variant rail. Single
setInterval at 1s cadence drives the 'running Xs' duration of all
running entries — no per-event timers."
```

---

### Task 11: Wire `ActivityFeed` into `AgentStatusPanel`

**Files:**

- Modify: `src/features/agent-status/components/AgentStatusPanel.tsx`
- Modify: `src/features/agent-status/components/AgentStatusPanel.test.tsx`

- [ ] **Step 1: Add failing integration test**

Append to `src/features/agent-status/components/AgentStatusPanel.test.tsx`:

```tsx
test('renders ActivityFeed between ContextBucket and ToolCallSummary', async () => {
  const { useAgentStatus } = await import('../hooks/useAgentStatus')
  vi.mocked(useAgentStatus).mockReturnValue({
    ...defaultStatus,
    isActive: true,
    agentType: 'claude-code',
    sessionId: 'session-1',
    toolCalls: {
      total: 1,
      byType: { Edit: 1 },
      active: null,
    },
    recentToolCalls: [
      {
        id: 'r-1',
        tool: 'Edit',
        args: 'src/foo.ts',
        status: 'done',
        durationMs: 100,
        timestamp: '2026-04-22T11:59:42Z',
      },
    ],
  })

  render(<AgentStatusPanel sessionId="session-1" />)

  const activityHeader = screen.getByText('ACTIVITY')
  const toolCallsHeader = screen.getByText(/tool calls/i)

  // ActivityFeed's ACTIVITY section header appears before the
  // ToolCallSummary's "Tool Calls" header in DOM order.
  expect(activityHeader.compareDocumentPosition(toolCallsHeader)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  )
})

test('keeps existing ToolCallSummary and RecentToolCalls consumers mounted', async () => {
  const { useAgentStatus } = await import('../hooks/useAgentStatus')
  vi.mocked(useAgentStatus).mockReturnValue({
    ...defaultStatus,
    isActive: true,
    agentType: 'claude-code',
    sessionId: 'session-1',
    toolCalls: {
      total: 1,
      byType: { Edit: 1 },
      active: null,
    },
    recentToolCalls: [
      {
        id: 'r-1',
        tool: 'Edit',
        args: 'src/foo.ts',
        status: 'done',
        durationMs: 100,
        timestamp: '2026-04-22T11:59:42Z',
      },
    ],
  })

  render(<AgentStatusPanel sessionId="session-1" />)

  // ToolCallSummary: renders the byType chip.
  expect(screen.getByText('Edit')).toBeInTheDocument()
  // RecentToolCalls: collapsible section button with count.
  expect(screen.getByRole('button', { name: /recent/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run src/features/agent-status/components/AgentStatusPanel.test.tsx`

Expected: new tests FAIL (ActivityFeed not mounted yet). Existing "renders at 280px" tests continue to PASS.

- [ ] **Step 3: Mount ActivityFeed in the panel**

Modify `src/features/agent-status/components/AgentStatusPanel.tsx`:

1. Add imports at the top:

```ts
import { ActivityFeed } from './ActivityFeed'
import { useActivityEvents } from '../hooks/useActivityEvents'
```

2. Inside the component, after `const status = useAgentStatus(sessionId)`, derive events:

```ts
const events = useActivityEvents(status)
```

3. In the JSX, insert `<ActivityFeed events={events} />` between `<ContextBucket … />` and `<ToolCallSummary … />`. The final structure of the "agent active" branch:

```tsx
{
  status.isActive && status.agentType ? (
    <>
      <div className="flex flex-col gap-2 p-2">
        <StatusCard
          agentType={status.agentType}
          modelId={status.modelId}
          modelDisplayName={status.modelDisplayName}
          status="running"
          cost={status.cost}
          rateLimits={status.rateLimits}
          totalInputTokens={status.contextWindow?.totalInputTokens ?? 0}
          totalOutputTokens={status.contextWindow?.totalOutputTokens ?? 0}
        />
        <ContextBucket
          usedPercentage={status.contextWindow?.usedPercentage ?? null}
          contextWindowSize={status.contextWindow?.contextWindowSize ?? 200_000}
          totalInputTokens={status.contextWindow?.totalInputTokens ?? 0}
          totalOutputTokens={status.contextWindow?.totalOutputTokens ?? 0}
        />
      </div>
      <ActivityFeed events={events} />{' '}
      {/* ← NEW, between ContextBucket and the scrollable block */}
      <div className="flex-1 overflow-y-auto">
        <ToolCallSummary
          total={status.toolCalls.total}
          byType={status.toolCalls.byType}
          active={status.toolCalls.active}
        />
        <RecentToolCalls calls={status.recentToolCalls} />
        <FilesChanged files={placeholderFiles} />
        <TestResults
          passed={placeholderTests.passed}
          failed={placeholderTests.failed}
          total={placeholderTests.total}
        />
      </div>
      <ActivityFooter
        totalDurationMs={status.cost?.totalDurationMs ?? 0}
        turnCount={0}
        linesAdded={status.cost?.totalLinesAdded ?? 0}
        linesRemoved={status.cost?.totalLinesRemoved ?? 0}
      />
    </>
  ) : null
}
```

- [ ] **Step 4: Run the panel tests — PASS**

Run: `npx vitest run src/features/agent-status/components/AgentStatusPanel.test.tsx`

Expected: all PASS (existing + new integration tests).

- [ ] **Step 5: Full test suite + type-check + lint**

Run: `npm run type-check && npm run lint && npm run test -- --run`

Expected: all PASS.

- [ ] **Step 6: Manual smoke test in dev**

Run: `npm run dev` (and/or `npm run tauri:dev` if you want the desktop shell).

In the app: mount an agent session, confirm the `ACTIVITY` header appears in the right-side panel above the existing `TOOL CALLS` chips, that running tool calls animate a dot, and that done tool calls display as `EDIT src/... 18s ago` entries.

If something is visually off (spacing, color token drift), note it but do NOT expand scope — open a follow-up issue. This PR's bar is "matches the Claude Design prototype's `ACTIVITY` section".

- [ ] **Step 7: Commit**

```bash
git add src/features/agent-status/components/AgentStatusPanel.tsx \
        src/features/agent-status/components/AgentStatusPanel.test.tsx
git commit -m "feat(agent-status): mount ActivityFeed in AgentStatusPanel

Adds the timeline feed above the existing ToolCallSummary +
RecentToolCalls — additive, not replacive. Existing consumers are
untouched; tool calls now appear in three lenses (feed, chips,
recent list) by design."
```

---

## Self-Review

**Spec coverage check:**

| Spec section                                                        | Task(s)                    |
| ------------------------------------------------------------------- | -------------------------- |
| Delete orphaned `AgentActivity/`                                    | 1                          |
| `ActivityEvent` discriminated union                                 | 2                          |
| `ActiveToolCall.startedAt` + producer                               | 3                          |
| `formatRelativeTime` + `formatDuration`                             | 4                          |
| `toolCallsToEvents` mapper                                          | 5                          |
| `useActivityEvents` memoizing hook                                  | 6                          |
| `ActivityEvent` basic row (icon/label/body/timestamp)               | 7                          |
| `ActivityEvent` diff chips                                          | 8                          |
| `ActivityEvent` bash status pill (verb from status, not bashResult) | 8                          |
| `ActivityEvent` running state (animate-pulse, running Xs)           | 9                          |
| `ActivityFeed` (header, rail, list, empty state, `now` timer)       | 10                         |
| `AgentStatusPanel` wiring                                           | 11                         |
| `ToolCallSummary` / `RecentToolCalls` unchanged                     | 11 (integration assertion) |

**Placeholder scan:** none — every step has concrete code or commands.

**Type consistency:** spot-checked — `ActivityEvent`, `ActiveToolCall.startedAt`, `ActivityFeedProps.events`, `ActivityEventProps.{event, now}`, hook `useActivityEvents(status: AgentStatus)` signatures all agree across tasks.

**Out of scope (recorded for future PRs):**

- `StatusCard` / `ContextBucket` / `FilesChanged` / `TestResults` / `ActivityFooter` redesigns.
- Claude Design's top-of-panel session header + CONTEXT / 5-HOUR USAGE / TURNS bars.
- Rust transcript parser extensions for `diff`, `bashResult`, `think`, `user`.
- Pixel-level visual regression (issue #76 Tier 5).
- Consolidating `formatRelativeTime` with the private helper in `src/features/diff/components/CommitInfoPanel.tsx`.
