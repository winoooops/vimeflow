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
- `src/features/workspace/WorkspaceView.subscription.test.tsx` — focused test that mocks **both** `<Sidebar>` and `<AgentStatusPanel>`, captures their `agentStatus` props, and asserts reference equality (proving one Tauri subscription, not two)

**Modified files:**

- `src/features/agent-status/components/ActivityFooter.tsx` — drop `turnCount` prop, render two cells (duration + lines)
- `src/features/agent-status/components/ActivityFooter.test.tsx` — drop turnCount fixtures and assertions
- `src/features/workspace/components/Sidebar.tsx` — accept `agentStatus`, render `<SidebarStatusHeader>` in place of the hardcoded "Agent Alpha" block
- `src/features/workspace/components/Sidebar.test.tsx` — replace "Agent Alpha" assertions with header-delegation assertions
- `src/features/agent-status/components/AgentStatusPanel.tsx` — accept `agentStatus` prop instead of calling `useAgentStatus`; drop `<StatusCard>` render; pipe `effectiveFiles` through `sumLines` into the footer
- `src/features/agent-status/components/AgentStatusPanel.test.tsx` — pass `agentStatus` as a prop instead of mocking the hook; assert `<StatusCard>` is no longer rendered inside the panel; assert footer line totals from a mock `useGitStatus`
- `src/features/workspace/WorkspaceView.tsx` — call `useAgentStatus(activeSessionId)` once, fan out to both `<Sidebar>` and `<AgentStatusPanel>`; raise `SIDEBAR_MIN` from 180 to 240
- `src/features/workspace/WorkspaceView.test.tsx` — capture `agentStatus` on the existing `AgentStatusPanel` mock; assert latest `useAgentStatus` call arg

**Untouched (verification only):**

- `src/features/agent-status/components/StatusCard.tsx` — no source edit, no file move
- `src/features/agent-status/components/StatusCard.test.tsx` — no change
- `src/features/agent-status/components/BudgetMetrics.tsx` / `.test.tsx` — no change
- `src/features/agent-status/hooks/useAgentStatus.ts` — no change

---

## Commit Strategy (read before starting)

The pre-commit hook runs `lint-staged`, which runs `tsc --noEmit` over the whole project for any staged `.ts` / `.tsx` file (`lint-staged.config.js:3`). Pre-commit blocks any commit while the tree has type errors anywhere.

This forces us to either keep every commit type-clean, or land every interdependent change in one atomic commit. We pick atomic commits:

| Commit | Tasks             | Why atomic                                                                                                                                                                                                                                                                                                                                         |
| ------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | Task 1            | `sumLines` util — additive, no other file changes                                                                                                                                                                                                                                                                                                  |
| **C2** | Task 2            | `<SidebarStatusHeader>` — additive new component, doesn't touch any existing render path                                                                                                                                                                                                                                                           |
| **C3** | Task 3            | All component-signature changes land together: `<ActivityFooter>` drops `turnCount`; `<Sidebar>` and `<AgentStatusPanel>` switch to prop-based agent status; `<WorkspaceView>` lifts the hook and bumps `SIDEBAR_MIN`. Each component depends on its caller being updated; splitting causes cross-file type errors that block the pre-commit hook. |
| **C4** | (optional) Task 4 | Empirical SIDEBAR_MIN bump if 240px doesn't fit                                                                                                                                                                                                                                                                                                    |

Tasks 5 and 6 (visual verification and issue filing) don't touch the working tree.

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

- [ ] **Step 5: Type-check and commit**

```bash
npm run type-check
```

Expected: PASS.

```bash
git add src/features/diff/utils/sumLines.ts src/features/diff/utils/sumLines.test.ts
git commit -m "feat(diff): add sumLines util for aggregating ChangedFile insertions/deletions"
```

Expected: pre-commit passes (only the new util is staged; tsc clean).

---

## Task 2: `<SidebarStatusHeader>` component

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

- [ ] **Step 5: Type-check and commit**

```bash
npm run type-check
```

Expected: PASS. (`<SidebarStatusHeader>` is not yet rendered anywhere, so no caller is affected.)

```bash
git add src/features/workspace/components/SidebarStatusHeader.tsx \
        src/features/workspace/components/SidebarStatusHeader.test.tsx
git commit -m "feat(workspace): add SidebarStatusHeader component"
```

---

## Task 3: Atomic component refactor

**Why one task / one commit:** every signature change in this task depends on its caller being updated in the same diff. Splitting causes intermediate type errors that block the pre-commit hook.

**Files (all in one commit):**

- Modify: `src/features/agent-status/components/ActivityFooter.tsx`
- Modify: `src/features/agent-status/components/ActivityFooter.test.tsx`
- Modify: `src/features/workspace/components/Sidebar.tsx`
- Modify: `src/features/workspace/components/Sidebar.test.tsx`
- Modify: `src/features/agent-status/components/AgentStatusPanel.tsx`
- Modify: `src/features/agent-status/components/AgentStatusPanel.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/WorkspaceView.test.tsx`
- Create: `src/features/workspace/WorkspaceView.subscription.test.tsx`

### 3.1 Write failing tests first (TDD)

- [ ] **Step 1: Rewrite `ActivityFooter.test.tsx`**

Replace the file contents:

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

- [ ] **Step 2: Update `Sidebar.test.tsx`**

Add the agent-status fixture at the top of the file (after existing imports):

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

Replace the existing "renders agent header with name and status" test (Sidebar.test.tsx:113-124) with:

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

  expect(screen.getByTestId('sidebar-status-header-idle')).toBeInTheDocument()
  expect(screen.queryByText('Agent Alpha')).not.toBeInTheDocument()
  expect(screen.queryByText('System Idle')).not.toBeInTheDocument()
})
```

Add `agentStatus={inactiveAgentStatus}` to every other `render(<Sidebar … />)` call in the file. The prop is required.

- [ ] **Step 3: Update `AgentStatusPanel.test.tsx`**

The existing test file (verified at the time of writing the plan) mocks `useAgentStatus` at module scope and overrides it per-test via `vi.mocked(useAgentStatus).mockReturnValue(...)` to flip `isActive` between true/false for the 0px-width / 280px-width / ease-in / ease-out cases. There is also a `passes sessionId to useAgentStatus` test (around lines 112-119). All of this becomes obsolete because the panel no longer calls the hook — it accepts `agentStatus` as a prop.

Make the following edits:

**a)** Delete the module-level `vi.mock('../hooks/useAgentStatus', …)` block and the `defaultStatus` fixture's reuse. The hook is no longer called from this component.

**b)** Delete the `passes sessionId to useAgentStatus` test entirely. It asserts a hook call that no longer happens.

**c)** Replace `defaultProps`. Drop the `sessionId` field; the prop no longer exists. Other props are unchanged:

```tsx
const defaultProps = {
  cwd: '/test',
  onOpenDiff: vi.fn(),
}
```

**d)** Add **two** fixtures (active and inactive — both are needed because existing tests cover both states):

```tsx
import type { AgentStatus } from '../types'

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

const activeAgentStatus: AgentStatus = {
  ...inactiveAgentStatus,
  isActive: true,
  agentType: 'claude-code',
  modelId: 'claude-3-5-sonnet-20241022',
  modelDisplayName: 'Claude 3.5 Sonnet',
  sessionId: 'sess-1',
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
}
```

**e)** Convert each existing test that previously called `vi.mocked(useAgentStatus).mockReturnValue(...)` to instead pass `agentStatus={…}` directly. Mapping:

| Old pattern                                                                                                                         | New pattern                         |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `mockReturnValue({ ...defaultStatus, isActive: false })` + `sessionId={null}`                                                       | `agentStatus={inactiveAgentStatus}` |
| `mockReturnValue({ ...defaultStatus, isActive: true, agentType: 'claude-code', sessionId: 'session-1' })` + `sessionId="session-1"` | `agentStatus={activeAgentStatus}`   |
| `mockReturnValue(defaultStatus)` (the default — inactive) + any `sessionId`                                                         | `agentStatus={inactiveAgentStatus}` |

Concretely, after editing, the existing tests look like:

```tsx
test('renders at 0px width when agent is not active', () => {
  render(
    <AgentStatusPanel {...defaultProps} agentStatus={inactiveAgentStatus} />
  )
  const panel = screen.getByTestId('agent-status-panel')
  expect(panel.style.width).toBe('0px')
})

test('renders at 280px width when agent is active', () => {
  render(<AgentStatusPanel {...defaultProps} agentStatus={activeAgentStatus} />)
  const panel = screen.getByTestId('agent-status-panel')
  expect(panel.style.width).toBe('280px')
})

test('applies ease-out transition when collapsing', () => {
  render(
    <AgentStatusPanel {...defaultProps} agentStatus={inactiveAgentStatus} />
  )
  const panel = screen.getByTestId('agent-status-panel')
  expect(panel.style.transition).toBe('width 200ms ease-out')
})

test('applies ease-in transition when expanding', () => {
  render(<AgentStatusPanel {...defaultProps} agentStatus={activeAgentStatus} />)
  const panel = screen.getByTestId('agent-status-panel')
  expect(panel.style.transition).toBe('width 200ms ease-in')
})

test('has overflow-hidden to clip content during collapse', () => {
  render(
    <AgentStatusPanel {...defaultProps} agentStatus={inactiveAgentStatus} />
  )
  const panel = screen.getByTestId('agent-status-panel')
  expect(panel).toHaveClass('overflow-hidden')
})
```

The tests are now synchronous (no `await import`, no per-test mock setup), which is a side benefit.

Mock `useGitStatus` (which the panel still calls):

```tsx
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
```

Add two new tests:

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

test('footer renders aggregated git-diff line totals', () => {
  render(
    <AgentStatusPanel
      agentStatus={activeAgentStatus}
      cwd="/tmp/repo"
      onOpenDiff={() => {}}
    />
  )

  // From the useGitStatus mock above: 5+7 added, 2+1 removed.
  expect(screen.getByText('+12 / -3')).toBeInTheDocument()
})
```

- [ ] **Step 4: Update `WorkspaceView.test.tsx`**

The existing file mocks `useAgentStatus` at module scope (around lines 18-34) and `<AgentStatusPanel>` with a `capturedAgentStatusPanelProps` capture object (around lines 47-70). Extend the capture to include `agentStatus`.

Add the `AgentStatus` import near the top:

```tsx
import type { AgentStatus } from '../agent-status/types'
import { useAgentStatus } from '../agent-status/hooks/useAgentStatus'
```

Update `capturedAgentStatusPanelProps` and the mock factory:

```tsx
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

Reset the new field in `beforeEach`:

```tsx
capturedAgentStatusPanelProps.agentStatus = undefined
```

Add a new test inside the `describe('WorkspaceView', …)` block:

```tsx
test('lifts useAgentStatus and forwards the latest activeSessionId', async () => {
  render(<WorkspaceView />)

  // Wait for session restore to settle (the listSessions mock resolves
  // sess-1, so this proves activeSessionId is non-null).
  await screen.findByRole('button', { name: 'session 1' })

  const useAgentStatusMock = vi.mocked(useAgentStatus)
  const calls = useAgentStatusMock.mock.calls
  const lastArg = calls[calls.length - 1]?.[0] as string | null

  // Latest call arg, not call count — activeSessionId flips from null
  // to the restored id during mount, and React may re-render multiple
  // times. We assert the *value* of the most-recent call.
  expect(lastArg).toBe('sess-1')
})

test('passes the lifted agentStatus to AgentStatusPanel', async () => {
  render(<WorkspaceView />)

  await screen.findByRole('button', { name: 'session 1' })

  // The mocked useAgentStatus returns isActive: true / agentType: 'claude-code'.
  expect(capturedAgentStatusPanelProps.agentStatus).toMatchObject({
    isActive: true,
    agentType: 'claude-code',
  })
})
```

- [ ] **Step 5: Create `WorkspaceView.subscription.test.tsx`**

This is a separate file because it mocks `<Sidebar>` (the existing `WorkspaceView.test.tsx` keeps the real Sidebar so its session-list assertions still work).

```tsx
import type { ReactElement } from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkspaceView } from './WorkspaceView'
import type { AgentStatus } from '../agent-status/types'

// Mock TerminalPane / TerminalZone deps to avoid xterm.js in jsdom
vi.mock('../terminal/components/TerminalPane', () => ({
  TerminalPane: vi.fn(() => <div data-testid="terminal-pane-mock" />),
}))

vi.mock('../editor/hooks/useEditorBuffer', () => ({
  useEditorBuffer: () => ({
    filePath: null,
    originalContent: '',
    currentContent: '',
    isDirty: false,
    isLoading: false,
    openFile: vi.fn().mockResolvedValue(undefined),
    saveFile: vi.fn().mockResolvedValue(undefined),
    updateContent: vi.fn(),
  }),
}))

vi.mock('../terminal/services/terminalService', () => ({
  createTerminalService: vi.fn(() => ({
    spawn: vi.fn().mockResolvedValue({ sessionId: 'new-id', pid: 999 }),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    onData: vi.fn(() => Promise.resolve(() => {})),
    onExit: vi.fn(() => () => {}),
    onError: vi.fn(() => () => {}),
    listSessions: vi.fn().mockResolvedValue({
      activeSessionId: 'sess-1',
      sessions: [
        {
          id: 'sess-1',
          cwd: '~',
          status: {
            kind: 'Alive',
            pid: 1234,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    }),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    reorderSessions: vi.fn().mockResolvedValue(undefined),
    updateSessionCwd: vi.fn().mockResolvedValue(undefined),
  })),
}))

// CRITICAL: this mock returns a fresh object per call so reference
// equality distinguishes "one hook call shared by both children" from
// "one hook call per child". The previous WorkspaceView.test.tsx mock
// returns a singleton, which would defeat this assertion.
vi.mock('../agent-status/hooks/useAgentStatus', () => ({
  useAgentStatus: vi.fn(
    (): AgentStatus => ({
      isActive: true,
      agentType: 'claude-code',
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
    })
  ),
}))

const capturedSidebarProps: { agentStatus?: AgentStatus } = {}
const capturedPanelProps: { agentStatus?: AgentStatus } = {}

interface MockSidebarProps {
  agentStatus?: AgentStatus
}
interface MockPanelProps {
  agentStatus?: AgentStatus
}

vi.mock('./components/Sidebar', () => ({
  Sidebar: ({ agentStatus = undefined }: MockSidebarProps): ReactElement => {
    capturedSidebarProps.agentStatus = agentStatus
    return <div data-testid="sidebar-mock" />
  },
}))

vi.mock('../agent-status/components/AgentStatusPanel', () => ({
  AgentStatusPanel: ({
    agentStatus = undefined,
  }: MockPanelProps): ReactElement => {
    capturedPanelProps.agentStatus = agentStatus
    return <div data-testid="agent-status-panel-mock" />
  },
}))

describe('WorkspaceView lifted-subscription contract', () => {
  beforeEach(() => {
    capturedSidebarProps.agentStatus = undefined
    capturedPanelProps.agentStatus = undefined
  })

  test('Sidebar and AgentStatusPanel receive agentStatus from a single hook call', async () => {
    render(<WorkspaceView />)

    // Wait for the children to be rendered with their props captured.
    await screen.findByTestId('sidebar-mock')
    await screen.findByTestId('agent-status-panel-mock')

    expect(capturedSidebarProps.agentStatus).toBeDefined()
    expect(capturedPanelProps.agentStatus).toBeDefined()

    // Reference equality. Because the useAgentStatus mock above returns
    // a FRESH object per call (the factory runs anew each invocation),
    // two separate hook calls would yield two distinct objects, and
    // `toBe` would fail. A single hook call shared by both children
    // yields the same object reference and `toBe` passes.
    expect(capturedSidebarProps.agentStatus).toBe(
      capturedPanelProps.agentStatus
    )
  })
})
```

- [ ] **Step 6: Run all the new/changed tests to verify they fail**

```bash
npx vitest run \
  src/features/agent-status/components/ActivityFooter.test.tsx \
  src/features/workspace/components/Sidebar.test.tsx \
  src/features/agent-status/components/AgentStatusPanel.test.tsx \
  src/features/workspace/WorkspaceView.test.tsx \
  src/features/workspace/WorkspaceView.subscription.test.tsx
```

Expected: FAIL across all five files. Possible failure modes:

- `ActivityFooter` still requires `turnCount` → type/runtime error
- `Sidebar` doesn't accept `agentStatus` → type error; `<SidebarStatusHeader>` testid not in DOM
- `AgentStatusPanel` doesn't accept `agentStatus` → type error; `<StatusCard>` still rendered
- `WorkspaceView` doesn't lift `useAgentStatus` → captured props undefined

### 3.2 Update implementations

- [ ] **Step 7: Update `ActivityFooter.tsx`**

Replace the file contents:

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

- [ ] **Step 8: Update `Sidebar.tsx`**

Three edits:

**a)** Add the `agentStatus` prop to `SidebarProps`:

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

**b)** Destructure `agentStatus` in the component signature, alongside the other props.

**c)** Add the `SidebarStatusHeader` import alongside the existing imports at the top of `Sidebar.tsx`:

```tsx
import { SidebarStatusHeader } from './SidebarStatusHeader'
```

**d)** Replace the hardcoded "Agent header" block (lines roughly 222-240, the `<div className="flex items-center gap-3 px-4 py-4">…"Agent Alpha"…"System Idle"…</div>`) with this JSX inside the existing return statement (no leading semicolon — this is JSX nested inside the existing return, not a new top-level statement):

```jsx
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

> **Heads-up on prettier behavior:** the project uses no-semi prettier. If you copy a code-fenced block that starts with a JSX element into a TS source file at top-level, prettier may insert a leading semicolon (`;<div>…</div>`) to disambiguate from the previous statement. That's a hint your paste landed at the wrong scope — this snippet is meant to be placed _inside_ `Sidebar`'s existing return JSX, not as a top-level statement. If you see prettier add a leading `;`, undo and re-paste at the correct nesting level.

- [ ] **Step 9: Update `AgentStatusPanel.tsx`**

Replace the file contents:

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

- [ ] **Step 10: Update `WorkspaceView.tsx`**

Five edits:

**a)** Bump `SIDEBAR_MIN`:

```ts
const SIDEBAR_MIN = 240
```

**b)** Import the hook:

```ts
import { useAgentStatus } from '../agent-status/hooks/useAgentStatus'
```

**c)** Inside the component, after `useSessionManager`:

```ts
const agentStatus = useAgentStatus(activeSessionId)
```

**d)** Pass `agentStatus` to `<Sidebar>`:

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

**e)** Replace `sessionId={activeSessionId}` on `<AgentStatusPanel>` with `agentStatus={agentStatus}`:

```tsx
<AgentStatusPanel
  agentStatus={agentStatus}
  cwd={activeSession?.workingDirectory ?? '.'}
  onOpenDiff={handleOpenDiff}
  onOpenFile={handleOpenTestFile}
/>
```

### 3.3 Verify and commit

- [ ] **Step 11: Run all the changed test files**

```bash
npx vitest run \
  src/features/agent-status/components/ActivityFooter.test.tsx \
  src/features/workspace/components/Sidebar.test.tsx \
  src/features/agent-status/components/AgentStatusPanel.test.tsx \
  src/features/workspace/WorkspaceView.test.tsx \
  src/features/workspace/WorkspaceView.subscription.test.tsx
```

Expected: PASS across all five files.

- [ ] **Step 12: Type-check**

```bash
npm run type-check
```

Expected: PASS, no errors.

- [ ] **Step 13: Run the full test suite**

```bash
npm run test
```

Expected: PASS. If anything else regresses (other tests assumed `<StatusCard>` was inside the panel, or the old footer signature), fix it now and add the fix to this commit.

- [ ] **Step 14: Lint and format**

```bash
npm run lint
npm run format:check
```

Expected: PASS. Run `npm run lint:fix` and `npm run format` if anything fails.

- [ ] **Step 15: Stage everything and commit**

```bash
git add \
  src/features/agent-status/components/ActivityFooter.tsx \
  src/features/agent-status/components/ActivityFooter.test.tsx \
  src/features/workspace/components/Sidebar.tsx \
  src/features/workspace/components/Sidebar.test.tsx \
  src/features/agent-status/components/AgentStatusPanel.tsx \
  src/features/agent-status/components/AgentStatusPanel.test.tsx \
  src/features/workspace/WorkspaceView.tsx \
  src/features/workspace/WorkspaceView.test.tsx \
  src/features/workspace/WorkspaceView.subscription.test.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): move StatusCard to sidebar header; git-diff lines in footer

- Lift useAgentStatus to WorkspaceView; pass agentStatus to both Sidebar
  and AgentStatusPanel (one Tauri subscription, asserted via reference
  equality in WorkspaceView.subscription.test.tsx).
- Sidebar replaces hardcoded "Agent Alpha" header with <SidebarStatusHeader>;
  AgentStatusPanel drops <StatusCard>, takes agentStatus as a prop.
- ActivityFooter renders two cells (duration + lines); turnCount removed
  pending real turn-counting (separate issue).
- Lines now sum from useGitStatus's effectiveFiles via sumLines, matching
  the per-file numbers shown in <FilesChanged>.
- Bump SIDEBAR_MIN from 180 to 240 so StatusCard's grid-cols-2
  BudgetMetrics doesn't overflow at the narrowest sidebar width.

Spec: docs/superpowers/specs/2026-04-30-sidebar-status-header-design.md
EOF
)"
```

Expected: pre-commit passes (lint-staged → eslint + tsc clean), commit succeeds.

---

## Task 4: Visual verification at narrow sidebar width

**Files:** None (manual verification per spec section 5.2.1)

- [ ] **Step 1: Start the dev server**

```bash
npm run tauri:dev
```

(Or `npm run dev` if Tauri is unavailable.)

- [ ] **Step 2: Drag the sidebar to its minimum width**

Drag the right edge of the sidebar all the way left. Verify the resize stops at the new minimum (240px). The `<SidebarStatusHeader>` should render the `<StatusCard>` (when an agent is attached) without horizontal overflow.

- [ ] **Step 3: Verify worst-case `<BudgetMetrics>` variants**

Test all three variants of `<BudgetMetrics>` at 240px:

- **`SubscriberVariant`** — both 5h + 7d rate-limit bars + the "API Time" / "Tokens" cells. Trigger by attaching a Claude Code session that returns `rate_limits` in its statusline JSON.
- **`ApiKeyVariant`** — Cost / API Time / Tokens In / Tokens Out grid. Trigger by attaching a Claude Code session running with `ANTHROPIC_API_KEY` (no rate-limit data).
- **`FallbackVariant`** — Tokens In / Tokens Out only. Trigger by attaching a session that emits a context-window event but no cost or rate-limits yet.

If you cannot reproduce all three with real agents, render the panel with worst-case mock data:

```
cost.totalCostUsd        = 9999.99   → "$9999.99"
cost.totalApiDurationMs  = 9_999_000 → "9999.0s"
totalInputTokens         = 9_999_999 → "10.0M" (whichever formatTokens produces)
rateLimits.fiveHour      = 99.99%
```

- [ ] **Step 4: Inspect for horizontal overflow**

Open DevTools, hover the StatusCard, look for clipped or wrapped text inside the `MetricCell` values. Use `overflow: visible` temporarily on the outer card to confirm.

- [ ] **Step 5: Decide**

- **If no overflow at 240px** → `SIDEBAR_MIN = 240` is correct. Continue to Step 6.
- **If overflow at 240px** → raise `SIDEBAR_MIN` further (try 260, then 280) and re-verify. Add the bump as a small follow-up commit.

- [ ] **Step 6: Verify the `<SidebarStatusHeader>` idle state**

Reload the app. Before any agent is attached to the active session, confirm the idle placeholder renders: gradient avatar + active session name (or "No session" if none) + neutral dot + "Idle" label. Drag the sidebar to its minimum and confirm the idle layout also fits without overflow.

- [ ] **Step 7: Commit (only if SIDEBAR_MIN was raised above 240)**

```bash
git add src/features/workspace/WorkspaceView.tsx
git commit -m "fix(workspace): raise SIDEBAR_MIN to <verified-value> after empirical check"
```

---

## Task 5: File the deferred-`turnCount` issue

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

- **Spec coverage:**
  - § 5.1 (`<SidebarStatusHeader>`): Task 2 covers the active branch (delegates to `<StatusCard>`) and idle branch (inline JSX matching StatusCard chrome).
  - § 5.2 (`<StatusCard>` stays put): Verified — Task 2 imports from existing path; no source edit.
  - § 5.2.1 (`SIDEBAR_MIN` bump): Task 3 bumps to 240; Task 4 verifies and re-bumps if needed.
  - § 5.3 (Sidebar accepts `agentStatus`): Task 3, sub-step 8.
  - § 5.4 (AgentStatusPanel takes prop, drops StatusCard, uses sumLines): Task 3, sub-step 9.
  - § 5.5 (ActivityFooter drops turnCount): Task 3, sub-step 7.
  - § 5.6 (sumLines util): Task 1.
  - § 5.7 (WorkspaceView lifts hook + bumps SIDEBAR_MIN): Task 3, sub-step 10.
  - § 6 (test plan): each row mapped to the corresponding sub-step.
  - § 8 (follow-up): Task 5 files the deferred-turnCount issue.

- **Architectural assertion:** the "one Tauri subscription, not two" goal is asserted at runtime by `WorkspaceView.subscription.test.tsx`. The mock returns a fresh `AgentStatus` object per call, so reference equality across captured Sidebar / AgentStatusPanel props proves a single hook invocation feeds both children. TypeScript alone does not catch a regression where `useAgentStatus` is called twice with the same id.

- **Pre-commit hook compatibility:** Tasks 1, 2, and 3 each end in a type-clean tree. The pre-commit hook (`lint-staged` → `tsc --noEmit`) passes after every commit. There is no intermediate "type-error window" — the four files that change signature in Task 3 are all updated together in one commit.
