# Sidebar Status Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the live `<StatusCard>` render-site from `<AgentStatusPanel>` (right side) into a new `<SidebarStatusHeader>` at the top of the left Sidebar; re-source `<ActivityFooter>` line totals from the same git-diff data that powers `<FilesChanged>`; drop the hardcoded `0 turns` span.

**Architecture:** Lift `useAgentStatus(activeSessionId)` from `<AgentStatusPanel>` to `<WorkspaceView>` so both the new sidebar header and the activity panel read from one Tauri subscription. New `<SidebarStatusHeader>` (in `workspace/components/`) renders the existing `<StatusCard>` (which stays in `agent-status/components/`) when the agent is active, and an idle-state placeholder when not. Footer line totals computed via a new pure `sumLines` util over `useGitStatus`'s `effectiveFiles`. Raise `SIDEBAR_MIN` from 180 → 240 so the StatusCard's fixed `grid-cols-2` `<BudgetMetrics>` does not overflow at the narrowest sidebar width.

**Tech Stack:** React 19, TypeScript, Vitest + testing-library, Tailwind (Catppuccin tokens), Tauri (event subscriptions, no Rust changes in this plan).

**Spec:** `docs/superpowers/specs/2026-04-30-sidebar-status-header-design.md`

---

## File Structure

**New files:**

- `src/features/diff/utils/sumLines.ts` — pure util summing `insertions` / `deletions` across `ChangedFile[]`
- `src/features/diff/utils/sumLines.test.ts` — unit tests for the util
- `src/features/workspace/components/SidebarStatusHeader.tsx` — switches between `<StatusCard>` and an idle placeholder
- `src/features/workspace/components/SidebarStatusHeader.test.tsx` — tests both states + the null-session fallback

**Modified files:**

- `src/features/agent-status/components/ActivityFooter.tsx` — drop `turnCount` prop, render two cells (duration + lines)
- `src/features/agent-status/components/ActivityFooter.test.tsx` — drop turnCount fixtures and assertions
- `src/features/workspace/components/Sidebar.tsx` — accept `agentStatus`, render `<SidebarStatusHeader>` in place of the hardcoded "Agent Alpha" block
- `src/features/workspace/components/Sidebar.test.tsx` — replace "Agent Alpha" assertions with header-delegation assertions
- `src/features/agent-status/components/AgentStatusPanel.tsx` — accept `agentStatus` prop instead of calling `useAgentStatus`; drop `<StatusCard>` render; pipe `effectiveFiles` through `sumLines` into the footer
- `src/features/agent-status/components/AgentStatusPanel.test.tsx` — pass `agentStatus` as a prop instead of mocking the hook; assert `<StatusCard>` is no longer rendered inside the panel; assert footer line totals from a mock `useGitStatus`
- `src/features/workspace/WorkspaceView.tsx` — call `useAgentStatus(activeSessionId)` once, fan out to both `<Sidebar>` and `<AgentStatusPanel>`; raise `SIDEBAR_MIN` from 180 to 240
- `src/features/workspace/WorkspaceView.test.tsx` — assert the lifted hook's latest-call arg and prop fan-out

**Untouched (verification only):**

- `src/features/agent-status/components/StatusCard.tsx` — no source edit, no file move
- `src/features/agent-status/components/StatusCard.test.tsx` — no change
- `src/features/agent-status/components/BudgetMetrics.tsx` / `.test.tsx` — no change
- `src/features/agent-status/hooks/useAgentStatus.ts` — no change

---

## Task 1: `sumLines` util

**Files:**

- Create: `src/features/diff/utils/sumLines.ts`
- Create: `src/features/diff/utils/sumLines.test.ts`

- [ ] **Step 1: Make the `utils` directory and write the failing test**

```bash
mkdir -p src/features/diff/utils
```

Write `src/features/diff/utils/sumLines.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import type { ChangedFile } from '../types'
import { sumLines } from './sumLines'

const file = (overrides: Partial<ChangedFile>): ChangedFile => ({
  path: 'src/x.ts',
  status: 'modified',
  staged: false,
  ...overrides,
})

describe('sumLines', () => {
  test('returns zeros for an empty list', () => {
    expect(sumLines([])).toEqual({ added: 0, removed: 0 })
  })

  test('sums insertions and deletions across files', () => {
    const files: ChangedFile[] = [
      file({ insertions: 12, deletions: 3 }),
      file({ insertions: 0, deletions: 8 }),
      file({ insertions: 4, deletions: 4 }),
    ]
    expect(sumLines(files)).toEqual({ added: 16, removed: 15 })
  })

  test('treats undefined insertions / deletions as zero', () => {
    const files: ChangedFile[] = [
      file({ insertions: 5, deletions: 2 }),
      file({}), // both stat counts absent (untracked file with no diff stat)
      file({ insertions: undefined, deletions: 7 }),
    ]
    expect(sumLines(files)).toEqual({ added: 5, removed: 9 })
  })

  test('handles a single file', () => {
    expect(sumLines([file({ insertions: 9, deletions: 1 })])).toEqual({
      added: 9,
      removed: 1,
    })
  })

  test('large counts sum without precision issues', () => {
    const files: ChangedFile[] = Array.from({ length: 200 }, () =>
      file({ insertions: 10_000, deletions: 5_000 })
    )
    expect(sumLines(files)).toEqual({ added: 2_000_000, removed: 1_000_000 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/features/diff/utils/sumLines.test.ts
```

Expected: FAIL with `Cannot find module './sumLines'`.

- [ ] **Step 3: Write the implementation**

Write `src/features/diff/utils/sumLines.ts`:

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

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/features/diff/utils/sumLines.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/utils/sumLines.ts src/features/diff/utils/sumLines.test.ts
git commit -m "feat(diff): add sumLines util for aggregating ChangedFile insertions/deletions"
```

---

## Task 2: Drop `turnCount` from `<ActivityFooter>`

**Files:**

- Modify: `src/features/agent-status/components/ActivityFooter.tsx`
- Modify: `src/features/agent-status/components/ActivityFooter.test.tsx`

- [ ] **Step 1: Read the existing test file**

```bash
cat src/features/agent-status/components/ActivityFooter.test.tsx
```

Note the existing assertions involving `turnCount` and `12 turns`.

- [ ] **Step 2: Update the test file to drop turnCount**

Rewrite `src/features/agent-status/components/ActivityFooter.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ActivityFooter, formatDuration } from './ActivityFooter'

describe('ActivityFooter', () => {
  test('renders duration and line totals', () => {
    render(
      <ActivityFooter
        totalDurationMs={90_000}
        linesAdded={42}
        linesRemoved={9}
      />
    )

    expect(screen.getByText('1m')).toBeInTheDocument()
    expect(screen.getByText('+42 / -9')).toBeInTheDocument()
  })

  test('does not render a turns cell', () => {
    render(
      <ActivityFooter totalDurationMs={0} linesAdded={0} linesRemoved={0} />
    )

    expect(screen.queryByText(/turns?/i)).not.toBeInTheDocument()
  })

  test('localizes large line counts', () => {
    render(
      <ActivityFooter
        totalDurationMs={0}
        linesAdded={12_345}
        linesRemoved={6_789}
      />
    )

    expect(screen.getByText('+12,345 / -6,789')).toBeInTheDocument()
  })
})

describe('formatDuration', () => {
  test('renders minutes only when under one hour', () => {
    expect(formatDuration(45_000)).toBe('0m')
    expect(formatDuration(90_000)).toBe('1m')
  })

  test('renders hours and zero-padded minutes when over one hour', () => {
    expect(formatDuration(3_900_000)).toBe('1h 05m')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/features/agent-status/components/ActivityFooter.test.tsx
```

Expected: FAIL — `linesAdded` / `linesRemoved` props in current code, but `turnCount` is also required by the existing component, so old fixtures may pass while new tests fail on missing `turnCount`. Actual failure mode depends on TypeScript strictness; a missing-prop type error is acceptable.

- [ ] **Step 4: Update the implementation**

Rewrite `src/features/agent-status/components/ActivityFooter.tsx`:

```tsx
import type { ReactElement } from 'react'

interface ActivityFooterProps {
  totalDurationMs: number
  linesAdded: number
  linesRemoved: number
}

const formatDuration = (ms: number): string => {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`
  }

  return `${minutes}m`
}

const formatLines = (n: number): string => n.toLocaleString('en-US')

export const ActivityFooter = ({
  totalDurationMs,
  linesAdded,
  linesRemoved,
}: ActivityFooterProps): ReactElement => (
  <div className="mt-auto bg-surface-container-low/40 px-5 py-3">
    <div className="flex items-center justify-between font-mono text-[9px] text-outline">
      <span>{formatDuration(totalDurationMs)}</span>
      <span>
        +{formatLines(linesAdded)} / -{formatLines(linesRemoved)}
      </span>
    </div>
  </div>
)

export { formatDuration }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/features/agent-status/components/ActivityFooter.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Type-check the whole project**

```bash
npm run type-check
```

Expected: ONE error in `AgentStatusPanel.tsx` — it still passes `turnCount={0}` to `<ActivityFooter>`, which now rejects unknown props. This is intentional; Task 5 fixes it. Do NOT proceed to commit until you verify the only remaining errors are in `AgentStatusPanel.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/features/agent-status/components/ActivityFooter.tsx \
        src/features/agent-status/components/ActivityFooter.test.tsx
git commit -m "refactor(activity-footer): drop turnCount, render duration + line totals only"
```

> **Note on the intermediate type-error window:** Task 6 (`npm run type-check`) currently flags `AgentStatusPanel.tsx` because it still passes `turnCount={0}`. That's an intentional cross-task delta — Task 5 fixes it. The pre-push hook only runs `vitest run` (which uses Vite's esbuild, stripping types), not `tsc`, so the commit and push are not blocked. Do **not** push to a remote that runs `tsc` in CI between Tasks 2 and 5; ideally land all of Tasks 2-6 before pushing. If you must push partway through, use a local branch.

---

## Task 3: `<SidebarStatusHeader>` component

**Files:**

- Create: `src/features/workspace/components/SidebarStatusHeader.tsx`
- Create: `src/features/workspace/components/SidebarStatusHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

Write `src/features/workspace/components/SidebarStatusHeader.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { AgentStatus } from '../../agent-status/types'
import { SidebarStatusHeader } from './SidebarStatusHeader'

const inactiveStatus: AgentStatus = {
  isActive: false,
  agentType: null,
  modelId: null,
  modelDisplayName: null,
  version: null,
  sessionId: null,
  agentSessionId: null,
  contextWindow: null,
  cost: null,
  rateLimits: null,
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
  testRun: null,
}

const activeStatus: AgentStatus = {
  ...inactiveStatus,
  isActive: true,
  agentType: 'claude-code',
  modelId: 'claude-3-5-sonnet-20241022',
  modelDisplayName: 'Claude 3.5 Sonnet',
  sessionId: 'session-1',
  contextWindow: {
    usedPercentage: 12,
    contextWindowSize: 200_000,
    totalInputTokens: 1_234,
    totalOutputTokens: 567,
    currentUsage: null,
  },
}

describe('SidebarStatusHeader', () => {
  test('renders the live StatusCard when an agent is active', () => {
    render(
      <SidebarStatusHeader
        status={activeStatus}
        activeSessionName="my session"
      />
    )

    expect(screen.getByTestId('agent-status-card')).toBeInTheDocument()
    expect(screen.getByText('Claude Code')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  test('renders the idle placeholder with the active session name', () => {
    render(
      <SidebarStatusHeader
        status={inactiveStatus}
        activeSessionName="my session"
      />
    )

    expect(screen.queryByTestId('agent-status-card')).not.toBeInTheDocument()
    expect(screen.getByText('my session')).toBeInTheDocument()
    expect(screen.getByText('Idle')).toBeInTheDocument()
  })

  test('falls back to "No session" when there is no active session', () => {
    render(
      <SidebarStatusHeader status={inactiveStatus} activeSessionName={null} />
    )

    expect(screen.getByText('No session')).toBeInTheDocument()
    expect(screen.getByText('Idle')).toBeInTheDocument()
  })

  test('treats agent-detected-but-no-agentType as idle', () => {
    // Defensive case: if isActive flips true before agentType arrives, the
    // header should not crash and should keep rendering the idle layout.
    render(
      <SidebarStatusHeader
        status={{ ...inactiveStatus, isActive: true, agentType: null }}
        activeSessionName="my session"
      />
    )

    expect(screen.queryByTestId('agent-status-card')).not.toBeInTheDocument()
    expect(screen.getByText('my session')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/features/workspace/components/SidebarStatusHeader.test.tsx
```

Expected: FAIL with `Cannot find module './SidebarStatusHeader'`.

- [ ] **Step 3: Write the implementation**

Write `src/features/workspace/components/SidebarStatusHeader.tsx`:

```tsx
import type { ReactElement } from 'react'
import { StatusCard } from '../../agent-status/components/StatusCard'
import type {
  AgentStatus,
  CostState,
  RateLimitsState,
} from '../../agent-status/types'

export interface SidebarStatusHeaderProps {
  status: AgentStatus
  activeSessionName: string | null
}

interface ActiveCardProps {
  agentType: 'claude-code' | 'codex' | 'aider' | 'generic'
  modelId: string | null
  modelDisplayName: string | null
  status: 'running' | 'paused' | 'completed' | 'errored'
  cost: CostState | null
  rateLimits: RateLimitsState | null
  totalInputTokens: number
  totalOutputTokens: number
}

const mapStatusToCardProps = (
  status: AgentStatus & {
    agentType: 'claude-code' | 'codex' | 'aider' | 'generic'
  }
): ActiveCardProps => ({
  agentType: status.agentType,
  modelId: status.modelId,
  modelDisplayName: status.modelDisplayName,
  // The StatusType discriminator does not yet have a feed from
  // AgentStatus — see spec section 5.1. Hard-coded to 'running' to
  // mirror the existing AgentStatusPanel behavior.
  status: 'running',
  cost: status.cost,
  rateLimits: status.rateLimits,
  totalInputTokens: status.contextWindow?.totalInputTokens ?? 0,
  totalOutputTokens: status.contextWindow?.totalOutputTokens ?? 0,
})

export const SidebarStatusHeader = ({
  status,
  activeSessionName,
}: SidebarStatusHeaderProps): ReactElement => {
  if (status.isActive && status.agentType) {
    return (
      <StatusCard
        {...mapStatusToCardProps({ ...status, agentType: status.agentType })}
      />
    )
  }

  const title = activeSessionName ?? 'No session'

  return (
    <div
      data-testid="sidebar-status-header-idle"
      className="flex flex-col gap-3 rounded-xl bg-surface-container-high p-3"
    >
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-primary-container to-secondary" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-headline text-sm font-[800] text-on-surface">
            {title}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-on-surface/30" />
            <span className="text-[10px] font-medium text-outline">Idle</span>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/features/workspace/components/SidebarStatusHeader.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/workspace/components/SidebarStatusHeader.tsx \
        src/features/workspace/components/SidebarStatusHeader.test.tsx
git commit -m "feat(workspace): add SidebarStatusHeader component"
```

---

## Task 4: Wire `<SidebarStatusHeader>` into `<Sidebar>`

**Files:**

- Modify: `src/features/workspace/components/Sidebar.tsx`
- Modify: `src/features/workspace/components/Sidebar.test.tsx`

- [ ] **Step 1: Read the existing Sidebar test**

```bash
cat src/features/workspace/components/Sidebar.test.tsx
```

Note any tests that assert on the literal strings "Agent Alpha" or "SYSTEM IDLE". Those become invalid after this task.

- [ ] **Step 2: Update the Sidebar test**

Three changes:

**a)** Add the agent-status fixture at the top of the file (after existing imports / fixtures):

```tsx
import type { AgentStatus } from '../../agent-status/types'

const inactiveAgentStatus: AgentStatus = {
  isActive: false,
  agentType: null,
  modelId: null,
  modelDisplayName: null,
  version: null,
  sessionId: null,
  agentSessionId: null,
  contextWindow: null,
  cost: null,
  rateLimits: null,
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
  testRun: null,
}
```

**b)** Replace the existing "renders agent header with name and status" test at lines 113-124 of `Sidebar.test.tsx`:

```tsx
test('renders the sidebar status header in the top slot', () => {
  render(
    <Sidebar
      sessions={mockSessions}
      activeSessionId="sess-1"
      onSessionClick={mockOnSessionClick}
      agentStatus={inactiveAgentStatus}
    />
  )

  // Idle SidebarStatusHeader renders this testid; the active variant
  // would render the StatusCard testid instead. Either path proves
  // delegation succeeded.
  expect(screen.getByTestId('sidebar-status-header-idle')).toBeInTheDocument()
  // The hardcoded "Agent Alpha" / "System Idle" strings no longer exist.
  expect(screen.queryByText('Agent Alpha')).not.toBeInTheDocument()
  expect(screen.queryByText('System Idle')).not.toBeInTheDocument()
})
```

**c)** Add `agentStatus={inactiveAgentStatus}` to every other `render(<Sidebar … />)` call site in the file. The prop is required, so every test that omits it will fail TypeScript and runtime. Use a recursive search/replace if the file is large.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/features/workspace/components/Sidebar.test.tsx
```

Expected: FAIL — `agentStatus` is not yet a prop on Sidebar (TypeScript), or the new "renders header" test fails because the header isn't rendered yet.

- [ ] **Step 4: Update `Sidebar.tsx`**

Modify `src/features/workspace/components/Sidebar.tsx`:

1. Add `agentStatus` to `SidebarProps`:

```tsx
import type { AgentStatus } from '../../agent-status/types'

export interface SidebarProps {
  sessions: Session[]
  activeSessionId: string | null
  activeCwd?: string
  onSessionClick: (sessionId: string) => void
  onNewInstance?: () => void
  onRemoveSession?: (sessionId: string) => void
  onRenameSession?: (sessionId: string, name: string) => void
  onReorderSessions?: (sessions: Session[]) => void
  onFileSelect?: (node: FileNode) => void
  agentStatus: AgentStatus
}
```

2. Add `agentStatus` to the destructure in the component signature.

3. Import `SidebarStatusHeader`:

```tsx
import { SidebarStatusHeader } from './SidebarStatusHeader'
```

4. Replace the entire hardcoded "Agent header" block (lines roughly 222-240, the `<div className="flex items-center gap-3 px-4 py-4">…"Agent Alpha"…"System Idle"…</div>` block) with:

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

The `"Active Sessions"` heading + `<Reorder.Group>` + everything below remain unchanged.

- [ ] **Step 5: Run Sidebar tests to verify they pass**

```bash
npx vitest run src/features/workspace/components/Sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Type-check**

```bash
npm run type-check
```

Expected: TypeScript errors in `WorkspaceView.tsx` (it doesn't pass `agentStatus`) and still in `AgentStatusPanel.tsx` (still passes `turnCount`). Both intentional; Tasks 5 and 6 fix them.

- [ ] **Step 7: Commit**

```bash
git add src/features/workspace/components/Sidebar.tsx \
        src/features/workspace/components/Sidebar.test.tsx
git commit -m "feat(workspace): render SidebarStatusHeader in Sidebar top slot"
```

> Same rationale as Task 2: the type-check window between tasks doesn't block the pre-push hook. Local commits are fine.

---

## Task 5: Refactor `<AgentStatusPanel>` to take `agentStatus` prop, drop `<StatusCard>`, use `sumLines`

**Files:**

- Modify: `src/features/agent-status/components/AgentStatusPanel.tsx`
- Modify: `src/features/agent-status/components/AgentStatusPanel.test.tsx`

- [ ] **Step 1: Read the existing AgentStatusPanel test**

```bash
cat src/features/agent-status/components/AgentStatusPanel.test.tsx
```

Note how `useAgentStatus` is currently mocked.

- [ ] **Step 2: Update the AgentStatusPanel test**

Update the test file:

1. Drop the `vi.mock('../hooks/useAgentStatus')` block if it exists. The panel no longer calls the hook.
2. Add the `activeAgentStatus` fixture at the top of the file:

```tsx
import type { AgentStatus } from '../types'

const activeAgentStatus: AgentStatus = {
  isActive: true,
  agentType: 'claude-code',
  modelId: 'claude-3-5-sonnet-20241022',
  modelDisplayName: 'Claude 3.5 Sonnet',
  version: null,
  sessionId: 'sess-1',
  agentSessionId: null,
  contextWindow: {
    usedPercentage: 12,
    contextWindowSize: 200_000,
    totalInputTokens: 1_234,
    totalOutputTokens: 567,
    currentUsage: null,
  },
  cost: {
    totalCostUsd: 0.05,
    totalDurationMs: 60_000,
    totalApiDurationMs: 30_000,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
  },
  rateLimits: null,
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
  testRun: null,
}
```

3. Pass `agentStatus` directly as a prop in every `render(<AgentStatusPanel … />)` call. Drop any `sessionId` prop (it no longer exists on the panel).
4. Add a test asserting `<StatusCard>` is no longer rendered inside the panel:

```tsx
test('does not render StatusCard inside the panel', () => {
  render(
    <AgentStatusPanel
      agentStatus={activeAgentStatus}
      cwd="/tmp/repo"
      onOpenDiff={() => {}}
    />
  )

  expect(screen.queryByTestId('agent-status-card')).not.toBeInTheDocument()
})
```

4. Add a test asserting footer line totals come from git-diff data. Mock `useGitStatus` to return changed files with insertions/deletions:

```tsx
import { vi } from 'vitest'

vi.mock('../../diff/hooks/useGitStatus', () => ({
  useGitStatus: () => ({
    files: [
      {
        path: 'a.ts',
        status: 'modified',
        insertions: 5,
        deletions: 2,
        staged: false,
      },
      {
        path: 'b.ts',
        status: 'modified',
        insertions: 7,
        deletions: 1,
        staged: false,
      },
    ],
    filesCwd: '/tmp/repo',
    loading: false,
    error: null,
    refresh: () => {},
    idle: false,
  }),
}))

test('footer renders aggregated git-diff line totals', () => {
  render(
    <AgentStatusPanel
      agentStatus={activeAgentStatus}
      cwd="/tmp/repo"
      onOpenDiff={() => {}}
    />
  )

  expect(screen.getByText('+12 / -3')).toBeInTheDocument()
})
```

Use the same `activeAgentStatus` fixture shape from Task 3, but with `cost`, `rateLimits`, etc. populated to satisfy `<ContextBucket>` / `<TokenCache>` rendering (or update those mocks if they crash on null).

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/features/agent-status/components/AgentStatusPanel.test.tsx
```

Expected: FAIL — the panel still calls `useAgentStatus` internally and still renders `<StatusCard>`.

- [ ] **Step 4: Update `AgentStatusPanel.tsx`**

Rewrite the component:

```tsx
import { useMemo, type ReactElement } from 'react'
import type { AgentStatus } from '../types'
import { ContextBucket } from './ContextBucket'
import { TokenCache } from './TokenCache'
import { ToolCallSummary } from './ToolCallSummary'
import { FilesChanged } from './FilesChanged'
import { TestResults } from './TestResults'
import { ActivityFooter } from './ActivityFooter'
import { ActivityFeed } from './ActivityFeed'
import { useActivityEvents } from '../hooks/useActivityEvents'
import { useGitStatus } from '../../diff/hooks/useGitStatus'
import { sumLines } from '../../diff/utils/sumLines'
import type { ChangedFile } from '../../diff/types'

interface AgentStatusPanelProps {
  agentStatus: AgentStatus
  cwd: string
  onOpenDiff: (file: ChangedFile) => void
  onOpenFile?: (path: string) => void
}

export const AgentStatusPanel = ({
  agentStatus,
  cwd,
  onOpenDiff,
  onOpenFile = undefined,
}: AgentStatusPanelProps): ReactElement => {
  const status = agentStatus
  const events = useActivityEvents(status)

  const { files, filesCwd, loading, error, refresh, idle } = useGitStatus(cwd, {
    watch: true,
    enabled: status.isActive,
  })

  const filesAreFresh = filesCwd === cwd
  const effectiveFiles = filesAreFresh ? files : []

  const effectiveLoading =
    !idle && (loading || (!filesAreFresh && error === null))

  const lineTotals = useMemo(() => sumLines(effectiveFiles), [effectiveFiles])

  return (
    <div
      data-testid="agent-status-panel"
      className="flex h-full flex-col overflow-hidden bg-surface-container"
      style={{
        width: status.isActive ? '280px' : '0px',
        transition: status.isActive
          ? 'width 200ms ease-in'
          : 'width 200ms ease-out',
      }}
    >
      {status.isActive && status.agentType ? (
        <>
          <div className="flex flex-col gap-2 p-2">
            <ContextBucket
              usedPercentage={status.contextWindow?.usedPercentage ?? null}
              contextWindowSize={
                status.contextWindow?.contextWindowSize ?? 200_000
              }
              totalInputTokens={status.contextWindow?.totalInputTokens ?? 0}
              totalOutputTokens={status.contextWindow?.totalOutputTokens ?? 0}
            />
            <TokenCache usage={status.contextWindow?.currentUsage ?? null} />
          </div>

          <div className="thin-scrollbar flex-1 overflow-y-auto">
            <ToolCallSummary
              total={status.toolCalls.total}
              byType={status.toolCalls.byType}
              active={status.toolCalls.active}
            />
            <ActivityFeed events={events} />
            <FilesChanged
              files={effectiveFiles}
              loading={effectiveLoading}
              error={error}
              onRetry={refresh}
              onSelect={onOpenDiff}
            />
            <TestResults snapshot={status.testRun} onOpenFile={onOpenFile} />
          </div>
          <ActivityFooter
            totalDurationMs={status.cost?.totalDurationMs ?? 0}
            linesAdded={lineTotals.added}
            linesRemoved={lineTotals.removed}
          />
        </>
      ) : null}
    </div>
  )
}

export default AgentStatusPanel
```

Key changes vs. before:

1. The `sessionId: string | null` prop is gone; the parent now owns the hook.
2. `agentStatus: AgentStatus` is the new prop.
3. The internal `useAgentStatus(sessionId)` call is removed.
4. `<StatusCard>` is no longer rendered.
5. `lineTotals = useMemo(() => sumLines(effectiveFiles), …)` feeds the footer.
6. `<ActivityFooter>` no longer receives `turnCount`.

- [ ] **Step 5: Run the AgentStatusPanel tests to verify they pass**

```bash
npx vitest run src/features/agent-status/components/AgentStatusPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Type-check**

```bash
npm run type-check
```

Expected: TypeScript errors in `WorkspaceView.tsx` only — it still passes `sessionId` and does not pass `agentStatus`. Task 6 fixes those.

- [ ] **Step 7: Commit**

```bash
git add src/features/agent-status/components/AgentStatusPanel.tsx \
        src/features/agent-status/components/AgentStatusPanel.test.tsx
git commit -m "refactor(agent-status): take agentStatus as prop, drop StatusCard render, use sumLines for footer"
```

> After this task lands, `npm run type-check` still fails on `WorkspaceView.tsx` (sessionId/agentStatus mismatch). Task 6 fixes the last error.

---

## Task 6: Lift `useAgentStatus` to `<WorkspaceView>` + bump `SIDEBAR_MIN`

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/WorkspaceView.test.tsx`

- [ ] **Step 1: Read the existing WorkspaceView test**

```bash
cat src/features/workspace/WorkspaceView.test.tsx
```

Note any existing `useAgentStatus` mocks.

- [ ] **Step 2: Update the WorkspaceView test**

The test file already mocks `useAgentStatus` at module scope (`vi.mock('../agent-status/hooks/useAgentStatus', () => ({ useAgentStatus: vi.fn(() => …) }))`) and already mocks `AgentStatusPanel` with a `capturedAgentStatusPanelProps` capture object. We extend both.

**a)** Add `agentStatus` to the captured-props object near the existing capture (around line 47-50 of the file):

```tsx
import type { AgentStatus } from '../agent-status/types'

const capturedAgentStatusPanelProps: {
  onOpenFile?: (path: string) => void
  onOpenDiff?: unknown
  agentStatus?: AgentStatus // NEW
} = {}

interface MockAgentStatusPanelProps {
  onOpenFile?: (path: string) => void
  onOpenDiff?: unknown
  agentStatus?: AgentStatus // NEW
}
```

**b)** Capture the new prop inside the mock factory (around line 57-69):

```tsx
vi.mock('../agent-status/components/AgentStatusPanel', () => ({
  AgentStatusPanel: ({
    onOpenFile = undefined,
    onOpenDiff = undefined,
    agentStatus = undefined, // NEW
  }: MockAgentStatusPanelProps): ReactElement => {
    capturedAgentStatusPanelProps.onOpenFile = onOpenFile
    capturedAgentStatusPanelProps.onOpenDiff = onOpenDiff
    capturedAgentStatusPanelProps.agentStatus = agentStatus // NEW

    return <div data-testid="agent-status-panel" />
  },
}))
```

**c)** Reset the new field in `beforeEach`:

```tsx
beforeEach(() => {
  capturedAgentStatusPanelProps.onOpenFile = undefined
  capturedAgentStatusPanelProps.onOpenDiff = undefined
  capturedAgentStatusPanelProps.agentStatus = undefined // NEW

  // … existing useEditorBuffer mock setup …
})
```

**d)** Add a top-level import to grab the mock reference:

```tsx
import { useAgentStatus } from '../agent-status/hooks/useAgentStatus'
```

**e)** Add the new tests inside the `describe('WorkspaceView', …)` block:

```tsx
test('lifts useAgentStatus and forwards the latest activeSessionId', async () => {
  render(<WorkspaceView />)

  // Wait for session restore to settle (existing tests use this pattern —
  // findByRole on the session button proves activeSessionId is non-null).
  await screen.findByRole('button', { name: 'session 1' })

  const useAgentStatusMock = vi.mocked(useAgentStatus)
  const calls = useAgentStatusMock.mock.calls
  const lastArg = calls[calls.length - 1]?.[0] as string | null

  // The exact id depends on the listSessions mock above (currently 'sess-1').
  // The point of this assertion is the LATEST call arg, not the call count —
  // activeSessionId flips from null to the restored id, and React may
  // re-render multiple times, so call count is not stable.
  expect(lastArg).toBe('sess-1')
})

test('passes agentStatus to AgentStatusPanel', async () => {
  render(<WorkspaceView />)

  await screen.findByRole('button', { name: 'session 1' })

  // The mocked useAgentStatus returns an object with isActive: true,
  // agentType: 'claude-code'. Verify AgentStatusPanel receives that exact
  // shape (proving the prop drill works).
  expect(capturedAgentStatusPanelProps.agentStatus).toMatchObject({
    isActive: true,
    agentType: 'claude-code',
  })
})
```

> Note: the existing `useAgentStatus` mock at module scope is `vi.fn(() => ({ isActive: true, agentType: 'claude-code', … }))`. Calling `vi.mocked(useAgentStatus).mock.calls` reads the call log directly. No restructuring of the existing mock is needed.

> The "both children receive the same `agentStatus` reference" assertion from the spec test plan is satisfied by TypeScript: the same `agentStatus` const is passed to both `<Sidebar>` and `<AgentStatusPanel>`. Asserting it again at runtime would require also mocking `<Sidebar>`, which the existing test file leaves real. We assert only the AgentStatusPanel side here; if a future regression makes the Sidebar receive a different reference, type-check would catch it before tests run.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/features/workspace/WorkspaceView.test.tsx
```

Expected: FAIL — `useAgentStatus` is not yet called from WorkspaceView.

- [ ] **Step 4: Update `WorkspaceView.tsx`**

1. Bump `SIDEBAR_MIN` from `180` to `240`:

```ts
const SIDEBAR_MIN = 240
```

2. Add the import:

```ts
import { useAgentStatus } from '../agent-status/hooks/useAgentStatus'
```

3. Inside the component, near the other hook calls (after `useSessionManager`, before or after `useResizable` — order doesn't matter for behavior):

```ts
const agentStatus = useAgentStatus(activeSessionId)
```

4. In the `<Sidebar … />` JSX, add the prop:

```tsx
<Sidebar
  sessions={sessions}
  activeSessionId={activeSessionId}
  activeCwd={activeSession?.workingDirectory ?? '~'}
  onSessionClick={setActiveSessionId}
  onNewInstance={createSession}
  onRemoveSession={removeSession}
  onRenameSession={renameSession}
  onReorderSessions={reorderSessions}
  onFileSelect={handleFileSelect}
  agentStatus={agentStatus}
/>
```

5. In the `<AgentStatusPanel … />` JSX, replace `sessionId={activeSessionId}` with `agentStatus={agentStatus}`:

```tsx
<AgentStatusPanel
  agentStatus={agentStatus}
  cwd={activeSession?.workingDirectory ?? '.'}
  onOpenDiff={handleOpenDiff}
  onOpenFile={handleOpenTestFile}
/>
```

- [ ] **Step 5: Run the WorkspaceView test to verify it passes**

```bash
npx vitest run src/features/workspace/WorkspaceView.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Type-check the whole project**

```bash
npm run type-check
```

Expected: PASS, no errors.

- [ ] **Step 7: Run the full test suite**

```bash
npm run test
```

Expected: PASS. If any test fails because it depended on the old `<StatusCard>` location inside the panel or the old footer signature, fix it now — those failures belong to this task.

- [ ] **Step 8: Run lint + format**

```bash
npm run lint
npm run format:check
```

Expected: PASS. Run `npm run lint:fix` and `npm run format` if anything fails.

- [ ] **Step 9: Commit**

```bash
git add src/features/workspace/WorkspaceView.tsx \
        src/features/workspace/WorkspaceView.test.tsx
git commit -m "feat(workspace): lift useAgentStatus to WorkspaceView; bump SIDEBAR_MIN to 240"
```

(No `--no-verify` here — the tree should now be fully green, so pre-push must pass.)

---

## Task 7: Visual verification at narrow sidebar width

**Files:** None (manual verification per spec section 5.2.1)

- [ ] **Step 1: Start the dev server**

```bash
npm run tauri:dev
```

(Or `npm run dev` if Tauri is unavailable in your environment — the layout tests can be done in the browser preview.)

- [ ] **Step 2: Drag the sidebar to its minimum width**

Drag the right edge of the sidebar all the way left. Verify the resize stops at the new minimum (240px). The `<SidebarStatusHeader>` should render the `<StatusCard>` (if an agent is attached in the session) without horizontal overflow.

- [ ] **Step 3: Verify worst-case `<BudgetMetrics>` variants**

Test all three variants of `<BudgetMetrics>` at 240px:

- **`SubscriberVariant`** — both 5h + 7d rate-limit bars + the "API Time" / "Tokens" cells. Trigger by attaching a Claude Code session that returns `rate_limits` in its statusline JSON.
- **`ApiKeyVariant`** — Cost / API Time / Tokens In / Tokens Out grid. Trigger by attaching a Claude Code session running with `ANTHROPIC_API_KEY` (no rate-limit data).
- **`FallbackVariant`** — Tokens In / Tokens Out only. Trigger by attaching a session that emits a context-window event but no cost or rate-limits yet.

If you cannot reproduce all three with real agents, render the panel with worst-case mock data:

```tsx
// Worst-case fixtures to drop into the dev server temporarily:
//   cost.totalCostUsd        = 9999.99   → "$9999.99"
//   cost.totalApiDurationMs  = 9_999_000 → "9999.0s"
//   totalInputTokens         = 9_999_999 → "10.0M" (whichever formatTokens produces)
//   rateLimits.fiveHour      = 99.99%
```

- [ ] **Step 4: Inspect for horizontal overflow**

Open DevTools, hover the StatusCard, look for clipped or wrapped text inside the `MetricCell` values. Use `overflow: visible` temporarily on the outer card to confirm.

- [ ] **Step 5: Decide**

- **If no overflow at 240px** → `SIDEBAR_MIN = 240` is correct. Continue to Step 6.
- **If overflow at 240px** → raise `SIDEBAR_MIN` further (try 260, then 280) and re-verify. Update Task 6's commit (or add a follow-up commit) accordingly. Document the final value in the PR description.

- [ ] **Step 6: Verify the `<SidebarStatusHeader>` idle state**

Reload the app. Before any agent is attached to the active session, confirm the idle placeholder renders: gradient avatar + active session name (or "No session" if none) + neutral dot + "Idle" label. Drag the sidebar to its minimum and confirm the idle layout also fits without overflow.

- [ ] **Step 7: Commit (only if SIDEBAR_MIN was raised above 240)**

```bash
git add src/features/workspace/WorkspaceView.tsx
git commit -m "fix(workspace): raise SIDEBAR_MIN to <verified-value> after empirical check"
```

---

## Task 8: File the deferred-`turnCount` issue

**Files:** None (filed via `gh issue create`)

- [ ] **Step 1: Confirm the GitHub remote is configured**

```bash
gh repo view --json url -q .url
```

Expected: a github.com URL.

- [ ] **Step 2: File the issue**

```bash
gh issue create \
  --title "feat(agent-status): wire real turnCount in ActivityFooter" \
  --body "$(cat <<'EOF'
The previous \`<ActivityFooter>\` displayed \`{turnCount} turns\` with \`turnCount\` hardcoded to \`0\`. This was misleading — there is no turn counter anywhere in the system today.

The PR that adds \`<SidebarStatusHeader>\` (see \`docs/superpowers/specs/2026-04-30-sidebar-status-header-design.md\`) dropped the turns cell entirely rather than continue showing a fake number. This issue tracks restoring the cell with a real, accurate value.

## Approach (from the spec)

Count is sourced from the Claude Code transcript file, which is already tailed by \`src-tauri/src/agent/transcript.rs\`. Add:

1. \`AgentTurnEvent { session_id, num_turns }\` in \`src-tauri/src/agent/types.rs\` with \`#[ts(export)]\` so the binding regenerates.
2. A per-session \`num_turns: u32\` local in \`tail_loop\`, threaded through \`process_line\` → \`process_user_message\`.
3. \`is_user_prompt(content)\` helper that returns true iff the user-message content is not exclusively \`tool_result\` blocks (real prompt vs synthetic tool-result wrapper).
4. Frontend listener in \`useAgentStatus\` for \`agent-turn\`; reducer takes \`Math.max(prev.numTurns, e.payload.numTurns)\` so historical replay collapses to the final value.
5. Wire \`numTurns\` back into \`<ActivityFooter>\` as a third cell.

## Spec reference

\`docs/superpowers/specs/2026-04-30-sidebar-status-header-design.md\` § 2 (out of scope) and § 8 (follow-up issues).
EOF
)"
```

If `gh` is not configured or the remote is missing, ask the user to file the issue manually using the body above. Do not block the rest of the work on this task.

- [ ] **Step 3: Mark this task complete**

No commit — `gh issue create` does not modify the working tree.

---

## Done criteria

- All tests pass: `npm run test`
- TypeScript clean: `npm run type-check`
- Lint clean: `npm run lint`
- Format clean: `npm run format:check`
- Manual: at the narrowest sidebar width, `<StatusCard>` and the idle header both render without horizontal overflow across all three `<BudgetMetrics>` variants
- The deferred-`turnCount` issue is filed (or the user has been notified to file it)
- The PR description references this plan and the spec

## Self-review notes (post-write)

- Spec § 5.1 (`<SidebarStatusHeader>`): Task 3 covers the active branch (delegates to `<StatusCard>`) and idle branch (inline JSX matching StatusCard chrome).
- Spec § 5.2 (`<StatusCard>` stays put): No source edit; only Task 3 imports it from its existing location.
- Spec § 5.2.1 (`SIDEBAR_MIN` bump): Task 6 raises the const; Task 7 verifies and re-bumps if needed.
- Spec § 5.3 (Sidebar accepts `agentStatus`): Task 4.
- Spec § 5.4 (AgentStatusPanel takes prop, drops StatusCard, uses sumLines): Task 5.
- Spec § 5.5 (ActivityFooter drops turnCount): Task 2.
- Spec § 5.6 (sumLines util): Task 1.
- Spec § 5.7 (WorkspaceView lifts hook + bumps SIDEBAR_MIN): Task 6.
- Spec § 6 (test plan): each row mapped to the corresponding task above.
- Spec § 8 (follow-up): Task 8 files the deferred-turnCount issue.

The plan accepts a brief `tsc` red window between Tasks 2 and 6 — the ActivityFooter and Sidebar/AgentStatusPanel signatures shift before `WorkspaceView` is updated, leaving the project type-error-positive but test-green (vitest uses Vite's esbuild, which strips types). Local commits during Tasks 2-5 succeed; the pre-push hook only runs `vitest run`, not `tsc`. Task 6 closes the type window.

> **Push gate:** CI (`.github/workflows/ci-checks.yml`) runs `npm run type-check` on push. **Do not push to GitHub until Task 6 is committed.** Push only after Task 6, ideally after Task 7 (visual verification) too. Tasks 1-6 are local-only commits.
