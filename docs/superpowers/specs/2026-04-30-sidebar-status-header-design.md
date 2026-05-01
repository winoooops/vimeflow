# Sidebar Status Header — Design Spec

**Date:** 2026-04-30
**Status:** Draft (brainstorming complete; pending user review)
**Author:** Claude (with Will)
**Related:** Token Cache Block (`2026-04-30-token-cache-block-design.md`), Activity Feed (`2026-04-22-activity-feed-design.md`), Files Changed Panel (`2026-04-23-files-changed-panel-design.md`)

## 1. Why

Two problems in the current workspace shell:

1. **The Sidebar's top header is dead UI.** It hardcodes `"Agent Alpha"` with a static `"SYSTEM IDLE"` label (`src/features/workspace/components/Sidebar.tsx:222-240`). The string never changes, never reflects the real agent, never updates when an agent attaches or disconnects.
2. **`AgentStatusPanel`'s `<StatusCard>` already shows live agent identity** — name, model, running/paused/completed/errored dot, and token totals (`src/features/agent-status/components/StatusCard.tsx`). But it lives on the right side of the screen, where the activity stream is. The natural place for "who is the agent" is the left sidebar — the same column that lists the active sessions.

A separate, smaller problem in the same panel:

3. **`ActivityFooter` lies about lines added/removed.** It sources `linesAdded` / `linesRemoved` from `status.cost?.totalLinesAdded / totalLinesRemoved` — fields populated only when Claude Code emits cost-metrics events (typically on turn-end). Until then the footer shows `+0 / -0` even when files have been edited. Meanwhile, the sibling `<FilesChanged>` panel one tier above already shows the _real_ per-file insertions/deletions from `useGitStatus`. Two readings of the same concept, one wrong.

This spec moves the StatusCard to the Sidebar (problem 1+2) and re-sources the footer's line totals from the same git-diff data that powers FilesChanged (problem 3).

## 2. Out of scope

- **`turnCount` in `ActivityFooter`** — currently hardcoded to `0` at `AgentStatusPanel.tsx:101`. There is no turn counter anywhere in the system. Adding one requires Rust transcript-watcher work (count `"user"` lines that aren't tool_result wrappers) plus a new event type. **Deferred to a follow-up issue.** This spec drops the `0 turns` span entirely rather than continue showing a fake number.
- **Consolidating the duplicate `useGitStatus` subscriptions** in `AgentStatusPanel` and `DiffPanelContent`. Two file-watchers for the same cwd is a known duplication unrelated to this work.
- **Multi-session agent identity** — when the user has multiple sessions, only the _active_ session's status is shown in the sidebar. Per-session status indicators on the session list rows are a separate feature.

## 3. Existing data flow

```
Statusline JSON
  └── parse_statusline()  ── src-tauri/src/agent/statusline.rs
       └── tauri.emit("agent-status", AgentStatusEvent)

useAgentStatus(sessionId)  ── src/features/agent-status/hooks/useAgentStatus.ts
  └── AgentStatus { isActive, agentType, modelId, contextWindow, cost, rateLimits, … }

WorkspaceView  ── src/features/workspace/WorkspaceView.tsx
  ├── <Sidebar>                           hardcoded "Agent Alpha" header
  ├── main panel                          terminal + drawer
  └── <AgentStatusPanel sessionId>        calls useAgentStatus locally
        ├── <StatusCard …status props>     ← will move
        ├── <ContextBucket />
        ├── <TokenCache />
        ├── <ToolCallSummary />
        ├── <ActivityFeed />
        ├── <FilesChanged files=effectiveFiles />   ← already git-diff-sourced
        ├── <TestResults />
        └── <ActivityFooter
              linesAdded={status.cost?.totalLinesAdded ?? 0}    ← will re-source
              linesRemoved={status.cost?.totalLinesRemoved ?? 0}
              turnCount={0}                                       ← will be removed
              totalDurationMs={status.cost?.totalDurationMs ?? 0} />

useGitStatus(cwd)  ── src/features/diff/hooks/useGitStatus.ts
  └── { files: ChangedFile[], filesCwd, loading, error, refresh, idle }
        └── ChangedFile { path, status, insertions?, deletions?, staged }
```

`StatusCard` is rendered at the top of `AgentStatusPanel`'s flex column. The Sidebar header above is unrelated and uses no agent-status state.

## 4. Target data flow

```
WorkspaceView
  └── const status = useAgentStatus(activeSessionId)            ← lifted up
       ├── <Sidebar agentStatus={status} … />
       │     └── <SidebarStatusHeader status={status}
       │                              activeSessionName={…} />   ← new
       │           ├── if status.isActive: <StatusCard … />     ← moved here
       │           └── else:                inline idle JSX (avatar + name + "Idle" dot)
       │
       └── <AgentStatusPanel agentStatus={status} … />          ← prop, no longer hook
             ├── <ContextBucket />
             ├── <TokenCache />
             ├── <ToolCallSummary />
             ├── <ActivityFeed />
             ├── <FilesChanged files=effectiveFiles />
             ├── <TestResults />
             └── <ActivityFooter
                   linesAdded={totals.added}                    ← from sumLines
                   linesRemoved={totals.removed}
                   totalDurationMs={status.cost?.totalDurationMs ?? 0} />

const totals = useMemo(() => sumLines(effectiveFiles), [effectiveFiles])
```

`useAgentStatus` lifts to `WorkspaceView` so the Sidebar header and the AgentStatusPanel share one Tauri subscription. `useGitStatus` stays where it is (`AgentStatusPanel`) — the sumLines totals are derived from the same `effectiveFiles` array that already feeds `<FilesChanged>`. Single source of truth within the panel.

## 5. Component anatomy

### 5.1 `<SidebarStatusHeader>` — new

**Location:** `src/features/workspace/components/SidebarStatusHeader.tsx`

```ts
interface SidebarStatusHeaderProps {
  status: AgentStatus
  activeSessionName: string | null
}
```

**Render contract** (no separate `IdleHeader` component — both branches are inline JSX inside `<SidebarStatusHeader>`):

```tsx
if (status.isActive && status.agentType) {
  return <StatusCard {...mapStatusToCardProps(status)} status="running" />
}
// idle: inline JSX matching StatusCard chrome — see layout below
return (
  <div className="flex flex-col gap-3 rounded-xl bg-surface-container-high p-3">
    {/* gradient avatar + (activeSessionName ?? 'No session') + dot + 'Idle' */}
  </div>
)
```

`mapStatusToCardProps(status)` is a small local helper that translates `AgentStatus` (`agentType`, `modelId`, `modelDisplayName`, `cost`, `rateLimits`, `contextWindow.totalInputTokens / totalOutputTokens`) into the `StatusCardProps` shape. Same field-by-field mapping that `AgentStatusPanel.tsx:62-71` does today.

The `status="running"` literal currently flows from `AgentStatusPanel.tsx:67`. Same value here — the `StatusType` discriminator inside `<StatusCard>` (`'running' | 'paused' | 'completed' | 'errored'`) does not yet have a feed from `AgentStatus`; that's an existing limitation, not introduced by this spec.

**Idle fallback layout (matches StatusCard chrome to avoid jiggle on attach/detach):**

```
┌──────────────────────────────────────┐
│ [▦ avatar 32]  <session name | "No   │
│                 session">             │
│                ● Idle                 │
└──────────────────────────────────────┘
```

- Outer: `flex flex-col gap-3 rounded-xl bg-surface-container-high p-3` (identical to StatusCard outer)
- Avatar: `h-8 w-8 rounded-lg bg-gradient-to-br from-primary-container to-secondary` (identical to StatusCard avatar)
- Title: `font-headline text-sm font-[800] text-on-surface` — `activeSessionName` or `"No session"` if null
- Status row: dot `h-2 w-2 rounded-full bg-on-surface/30` (no glow) + label `"Idle"` in `text-[10px] font-medium text-outline`

No `<BudgetMetrics>` row in idle state — there's no data to show. The idle card is shorter than the active card (no metrics, no model name, no token cells). This vertical-jiggle on attach is intentional; layout-stability matters at the avatar/title row, not at the metrics row that only exists when there's data.

### 5.2 `<StatusCard>` — moved, no behavior change

**From:** `src/features/agent-status/components/StatusCard.tsx`
**To:** `src/features/workspace/components/StatusCard.tsx`

Test file moves alongside (`StatusCard.test.tsx`).

Imports updated:

- `import { BudgetMetrics } from './BudgetMetrics'` → `import { BudgetMetrics } from '../../agent-status/components/BudgetMetrics'`
- `import type { CostState, RateLimitsState } from '../types'` → `import type { CostState, RateLimitsState } from '../../agent-status/types'`
- `import { Tooltip } from '../../../components/Tooltip'` — depth unchanged, no edit

`<BudgetMetrics>` stays at `src/features/agent-status/components/BudgetMetrics.tsx`. The agent-status feature still owns the budget-metrics concept; the workspace feature owns the rendering of the agent identity card. Cross-feature import (workspace → agent-status) is the price for this split, and it's already the pattern for type imports.

### 5.3 `<Sidebar>` — modified

**File:** `src/features/workspace/components/Sidebar.tsx`

```ts
interface SidebarProps {
  // existing props unchanged
  sessions: Session[]
  activeSessionId: string | null
  // … etc.
  agentStatus: AgentStatus // NEW
}
```

The hardcoded header block at `Sidebar.tsx:222-240` is replaced with:

```tsx
<div className="px-3 pt-3 pb-2">
  <SidebarStatusHeader
    status={agentStatus}
    activeSessionName={
      sessions.find((s) => s.id === activeSessionId)?.name ?? null
    }
  />
</div>
```

The `"Active Sessions"` heading and session list below are unchanged. The new `<SidebarStatusHeader>` is wrapped in `px-3 pt-3 pb-2` so the rounded card sits inset from the sidebar edge.

### 5.4 `<AgentStatusPanel>` — modified

**File:** `src/features/agent-status/components/AgentStatusPanel.tsx`

Changes:

- Remove `useAgentStatus(sessionId)` call. Replace with `agentStatus` prop.
- Remove `<StatusCard />` render — the entire first child of the inner flex column.
- The wrapping `<div className="flex flex-col gap-2 p-2">` keeps `<ContextBucket />` and `<TokenCache />`.
- Pass `effectiveFiles` through `sumLines` (memoized) and feed the result to `<ActivityFooter>`.
- Drop `turnCount={0}` from the footer call.

```tsx
const totals = useMemo(() => sumLines(effectiveFiles), [effectiveFiles])
// …
<ActivityFooter
  totalDurationMs={status.cost?.totalDurationMs ?? 0}
  linesAdded={totals.added}
  linesRemoved={totals.removed}
/>
```

The visibility gate (`status.isActive ? '280px' : '0px'`) stays. When no agent is active, the right panel collapses; the Sidebar still shows the idle header.

### 5.5 `<ActivityFooter>` — modified

**File:** `src/features/agent-status/components/ActivityFooter.tsx`

```ts
interface ActivityFooterProps {
  totalDurationMs: number
  linesAdded: number
  linesRemoved: number
  // turnCount: number   ← REMOVED
}
```

Render:

```tsx
<div className="mt-auto bg-surface-container-low/40 px-5 py-3">
  <div className="flex items-center justify-between font-mono text-[9px] text-outline">
    <span>{formatDuration(totalDurationMs)}</span>
    <span>
      +{formatLines(linesAdded)} / -{formatLines(linesRemoved)}
    </span>
  </div>
</div>
```

Two cells now instead of three. The `<span>{turnCount} turns</span>` middle cell is removed. The two remaining cells redistribute via `justify-between` — duration left, line totals right.

### 5.6 `sumLines` util — new

**File:** `src/features/diff/utils/sumLines.ts`

```ts
import type { ChangedFile } from '../types'

export interface LineTotals {
  added: number
  removed: number
}

export const sumLines = (files: ChangedFile[]): LineTotals =>
  files.reduce<LineTotals>(
    (acc, f) => ({
      added: acc.added + (f.insertions ?? 0),
      removed: acc.removed + (f.deletions ?? 0),
    }),
    { added: 0, removed: 0 }
  )
```

Pure, deterministic, unit-testable. Lives under `diff/utils/` because `ChangedFile` is the diff-feature type.

### 5.7 `WorkspaceView` — modified

**File:** `src/features/workspace/WorkspaceView.tsx`

Add `useAgentStatus(activeSessionId)` call. Pass the resulting `AgentStatus` to both `<Sidebar agentStatus={…} />` and `<AgentStatusPanel agentStatus={…} />`.

## 6. Test plan

| File                                                                                 | Coverage                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/workspace/components/SidebarStatusHeader.test.tsx` (new)               | Active state delegates to `<StatusCard>` with mapped props; idle state renders gradient avatar + session name + "Idle"; idle fallback when `activeSessionName` is `null` shows "No session"             |
| `src/features/workspace/components/StatusCard.test.tsx` (moved)                      | Existing assertions preserved; only the file path moves                                                                                                                                                 |
| `src/features/workspace/components/Sidebar.test.tsx` (existing — update)             | Replace assertions about "Agent Alpha" / "SYSTEM IDLE" with assertions that delegate to `<SidebarStatusHeader>` (or test the rendered output for both active and idle props)                            |
| `src/features/diff/utils/sumLines.test.ts` (new)                                     | Empty input → `{0, 0}`; mixed `insertions` / `deletions` (some `undefined`) sum correctly; large numbers don't overflow; single-file case                                                               |
| `src/features/agent-status/components/ActivityFooter.test.tsx` (existing — update)   | Drop the `turnCount` test cases; assert two cells (duration + lines) only; remove `turnCount` from `ActivityFooterProps` test fixtures                                                                  |
| `src/features/agent-status/components/AgentStatusPanel.test.tsx` (existing — update) | Pass `agentStatus` as a prop instead of mocking the hook; assert footer receives `linesAdded` / `linesRemoved` from a mock `useGitStatus`; assert `<StatusCard>` is no longer rendered inside the panel |
| `src/features/workspace/WorkspaceView.test.tsx` (new or update)                      | Lifted `useAgentStatus` is called once with `activeSessionId`; both child components receive the same `agentStatus` reference                                                                           |

No Rust changes. No new Tauri events. No bindings to regenerate.

## 7. Risk + rollout

**Visual regressions:**

- Sidebar's top area is now taller when an agent is attached (StatusCard ~96-120px) vs the previous header (~72px). The session list compresses by that delta. Acceptable — the StatusCard is a meaningful addition.
- The activity panel's top is now `<ContextBucket>` instead of `<StatusCard>`. The agent identity is no longer visible while looking at the activity stream. The trade-off is that the identity moves to a more persistent surface (sidebar visible whenever workspace is) and the activity panel becomes denser with stream-relevant content.

**Behavioral regressions:**

- The lifted `useAgentStatus` call now happens at `WorkspaceView` regardless of whether `<AgentStatusPanel>` is collapsed. The hook is cheap (one Tauri listener, derived state) — this is a wash.
- `ActivityFooter` lines numbers will differ from before. Previously they reflected agent-reported cumulative cost (which only includes agent-driven edits and only updates on cost events). Now they reflect git-diff working-tree state (includes manual edits, updates as files change). This is the _correct_ behavior; some users may notice the numbers move differently from what they remember.

**Rollback:** No data migration, no persisted state, no schema changes. Reverting the PR fully restores the prior behavior.

## 8. Follow-up issues

- **`feat(agent-status): wire real turnCount in ActivityFooter`** — restore the turns cell using a Rust transcript-watcher counter. References this spec for the deferred decision.
- **`refactor(diff): consolidate duplicate useGitStatus subscriptions`** — `AgentStatusPanel` and `DiffPanelContent` independently call `useGitStatus(cwd)` for the same cwd, creating two file-watchers. Lift to a shared context or memoize at WorkspaceView.

## 9. Open questions

None — all decisions confirmed during brainstorming on 2026-04-30.
