# Token Cache Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Anthropic prompt-caching efficiency in the right activity panel by closing the existing frontend gap (the wire payload's `currentUsage` is dropped by `useAgentStatus`), then rendering a `<TokenCache>` block that is a pure function of the latest snapshot.

**Architecture:** Six-task TDD cycle. Task 1 surfaces `currentUsage` through the hook in one atomic commit (type addition + normalization + tests bundled — the new field is required, so splitting them would break type-check at the intermediate commit). Tasks 2–4 build the pure utility module, the presentational component, and the panel wiring on top of that data. Task 5 verifies the wiring end-to-end through a workspace integration test. Task 6 is the final QA pass (lint + type-check + full suite). No Rust, no IPC commands, no new event subscriptions, no in-memory ring buffer, no sparkline. The component is mounted only when `status.isActive` is true and is a pure function of `usage`.

**Tech Stack:** React 19 + TypeScript (arrow components, explicit return types), Vitest + Testing Library (`test()`, not `it()`), Tailwind (existing `text-outline` / `text-outline-variant` / `bg-surface-container` / `font-mono` / `tabular-nums`), tokens from `docs/design/tokens.ts`.

**Authoritative spec:** `docs/superpowers/specs/2026-04-30-token-cache-block-design.md`. When this plan and the spec disagree, the spec wins; report the discrepancy and stop.

---

## File Structure

| File                                                             | Status | Responsibility                                                                                |
| ---------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| `src/features/agent-status/types/index.ts`                       | Modify | Add `CurrentUsageState` interface; extend `ContextWindowState` with `currentUsage`            |
| `src/features/agent-status/hooks/useAgentStatus.ts`              | Modify | Normalize `p.contextWindow.currentUsage` (lines 221-228); narrow bigint → number              |
| `src/features/agent-status/hooks/useAgentStatus.test.ts`         | Modify | Add tests covering currentUsage propagation, null fallback, session reset                     |
| `src/features/agent-status/utils/cacheRate.ts`                   | Create | Pure: `cacheBuckets`, `cacheHitRate`, `cacheTone`, `CacheTone` type, `CacheBuckets` interface |
| `src/features/agent-status/utils/cacheRate.test.ts`              | Create | Boundary + null + zero-total tests for the three pure functions                               |
| `src/features/agent-status/components/TokenCache.tsx`            | Create | Presentational component: header → stack bar → big % → caption → 3-col stat grid              |
| `src/features/agent-status/components/TokenCache.test.tsx`       | Create | Empty / populated / tone-boundary / pulse tests; no setInterval leaks                         |
| `src/features/agent-status/components/AgentStatusPanel.tsx`      | Modify | Insert `<TokenCache>` between `<ContextBucket>` and the scrollable region                     |
| `src/features/agent-status/components/AgentStatusPanel.test.tsx` | Modify | Assert mount slot, prop propagation, crash-safety on null currentUsage                        |
| `src/features/workspace/WorkspaceView.integration.test.tsx`      | Modify | Two test cases: populated + empty paths                                                       |

---

## Task 1: Surface `currentUsage` end-to-end (type + hook normalization)

**Why these are merged:** the new `ContextWindowState.currentUsage` field is **required**, not optional. If the type is added in one commit and the hook normalization in a separate later commit, the intermediate state fails `npm run type-check` because `useAgentStatus.ts:221-228` constructs `contextWindow` without the new field. The two changes must land in one atomic commit so every commit on the branch type-checks.

**Files:**

- Modify: `src/features/agent-status/types/index.ts:89-94`
- Modify: `src/features/agent-status/hooks/useAgentStatus.ts:221-228`
- Modify: `src/features/agent-status/hooks/useAgentStatus.test.ts`

- [ ] **Step 1: Write the failing tests first** (TDD red phase)

In `src/features/agent-status/hooks/useAgentStatus.test.ts`, after the existing `'filters status events by sessionId'` test (which ends near line 140), add:

```ts
test('surfaces currentUsage through normalization', async () => {
  const { result } = renderHook(() => useAgentStatus('session-1'))

  await vi.waitFor(() => {
    expect(eventListeners.get('agent-status')?.length).toBe(1)
  })

  act(() => {
    emit('agent-status', {
      sessionId: 'pty-session-1',
      modelId: 'sonnet-4-5',
      modelDisplayName: 'Sonnet 4.5',
      version: '1.0',
      agentSessionId: 'a-1',
      contextWindow: {
        usedPercentage: 42.5,
        remainingPercentage: 57.5,
        contextWindowSize: 200000,
        totalInputTokens: 85000,
        totalOutputTokens: 5000,
        currentUsage: {
          inputTokens: 700,
          outputTokens: 300,
          cacheCreationInputTokens: 1800,
          cacheReadInputTokens: 7500,
        },
      },
      cost: null,
      rateLimits: null,
    })
  })

  expect(result.current.contextWindow?.currentUsage).toEqual({
    inputTokens: 700,
    outputTokens: 300,
    cacheCreationInputTokens: 1800,
    cacheReadInputTokens: 7500,
  })
})

test('preserves null currentUsage', async () => {
  const { result } = renderHook(() => useAgentStatus('session-1'))

  await vi.waitFor(() => {
    expect(eventListeners.get('agent-status')?.length).toBe(1)
  })

  act(() => {
    emit('agent-status', {
      sessionId: 'pty-session-1',
      modelId: 'sonnet-4-5',
      modelDisplayName: 'Sonnet 4.5',
      version: '1.0',
      agentSessionId: 'a-1',
      contextWindow: {
        usedPercentage: 0,
        remainingPercentage: 100,
        contextWindowSize: 200000,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        currentUsage: null,
      },
      cost: null,
      rateLimits: null,
    })
  })

  expect(result.current.contextWindow?.currentUsage).toBeNull()
})

test('narrows bigint currentUsage tokens to number at the hook boundary', async () => {
  // The wire payload from Tauri carries `bigint` for each u64 token count
  // (see CurrentUsage binding). The hook MUST narrow these to `number` so
  // downstream consumers (cacheRate utilities, TokenCache component) can
  // operate on plain numbers without dealing with bigint arithmetic.
  const { result } = renderHook(() => useAgentStatus('session-1'))

  await vi.waitFor(() => {
    expect(eventListeners.get('agent-status')?.length).toBe(1)
  })

  act(() => {
    emit('agent-status', {
      sessionId: 'pty-session-1',
      modelId: null,
      modelDisplayName: null,
      version: null,
      agentSessionId: null,
      contextWindow: {
        usedPercentage: 0,
        remainingPercentage: 100,
        contextWindowSize: BigInt(200000),
        totalInputTokens: BigInt(0),
        totalOutputTokens: BigInt(0),
        currentUsage: {
          inputTokens: BigInt(700),
          outputTokens: BigInt(300),
          cacheCreationInputTokens: BigInt(1800),
          cacheReadInputTokens: BigInt(7500),
        },
      },
      cost: null,
      rateLimits: null,
    })
  })

  const usage = result.current.contextWindow?.currentUsage
  expect(usage).not.toBeNull()
  // Each value must be a plain `number`, not a bigint.
  expect(typeof usage?.inputTokens).toBe('number')
  expect(typeof usage?.outputTokens).toBe('number')
  expect(typeof usage?.cacheCreationInputTokens).toBe('number')
  expect(typeof usage?.cacheReadInputTokens).toBe('number')
  expect(usage).toEqual({
    inputTokens: 700,
    outputTokens: 300,
    cacheCreationInputTokens: 1800,
    cacheReadInputTokens: 7500,
  })
})

test('clears currentUsage when sessionId changes', async () => {
  const { result, rerender } = renderHook(
    ({ id }: { id: string | null }) => useAgentStatus(id),
    { initialProps: { id: 'session-1' } }
  )

  await vi.waitFor(() => {
    expect(eventListeners.get('agent-status')?.length).toBe(1)
  })

  act(() => {
    emit('agent-status', {
      sessionId: 'pty-session-1',
      modelId: null,
      modelDisplayName: null,
      version: null,
      agentSessionId: null,
      contextWindow: {
        usedPercentage: 10,
        remainingPercentage: 90,
        contextWindowSize: 200000,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        currentUsage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationInputTokens: 200,
          cacheReadInputTokens: 800,
        },
      },
      cost: null,
      rateLimits: null,
    })
  })

  expect(result.current.contextWindow?.currentUsage).not.toBeNull()

  rerender({ id: 'session-2' })

  expect(result.current.contextWindow).toBeNull()
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/features/agent-status/hooks/useAgentStatus.test.ts -t "currentUsage"`
Expected: FAIL — `currentUsage` is undefined on the result, OR TypeScript reports the field doesn't exist.

- [ ] **Step 3: Add `CurrentUsageState` and extend `ContextWindowState`** in `src/features/agent-status/types/index.ts`

Locate the existing `ContextWindowState` (line 89). Replace it with:

```ts
export interface CurrentUsageState {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
}

export interface ContextWindowState {
  usedPercentage: number
  contextWindowSize: number
  totalInputTokens: number
  totalOutputTokens: number
  currentUsage: CurrentUsageState | null
}
```

- [ ] **Step 4: Update normalization** in `src/features/agent-status/hooks/useAgentStatus.ts`

Find the existing `agent-status` listener at line 204, then the `contextWindow` normalization at lines 221-228. Replace those lines with:

```ts
            contextWindow: p.contextWindow
              ? {
                  usedPercentage: p.contextWindow.usedPercentage ?? 0,
                  contextWindowSize: Number(p.contextWindow.contextWindowSize),
                  totalInputTokens: Number(p.contextWindow.totalInputTokens),
                  totalOutputTokens: Number(p.contextWindow.totalOutputTokens),
                  currentUsage: p.contextWindow.currentUsage
                    ? {
                        inputTokens: Number(
                          p.contextWindow.currentUsage.inputTokens
                        ),
                        outputTokens: Number(
                          p.contextWindow.currentUsage.outputTokens
                        ),
                        cacheCreationInputTokens: Number(
                          p.contextWindow.currentUsage.cacheCreationInputTokens
                        ),
                        cacheReadInputTokens: Number(
                          p.contextWindow.currentUsage.cacheReadInputTokens
                        ),
                      }
                    : null,
                }
              : prev.contextWindow,
```

- [ ] **Step 5: Run the full hook suite + type-check**

Run: `npx vitest run src/features/agent-status/hooks/useAgentStatus.test.ts && npm run type-check`
Expected: ALL PASS — including the three new `currentUsage` tests AND every pre-existing test, AND the type-checker is happy because the new field is populated by the same commit that requires it.

- [ ] **Step 6: Commit (single atomic commit)**

```bash
git add \
  src/features/agent-status/types/index.ts \
  src/features/agent-status/hooks/useAgentStatus.ts \
  src/features/agent-status/hooks/useAgentStatus.test.ts
git commit -m "feat(agent-status): surface currentUsage through useAgentStatus"
```

---

## Task 2: Implement `cacheRate.ts` pure utilities

**Files:**

- Create: `src/features/agent-status/utils/cacheRate.ts`
- Create: `src/features/agent-status/utils/cacheRate.test.ts`

- [ ] **Step 1: Write the full failing test file** at `src/features/agent-status/utils/cacheRate.test.ts`

```ts
import { describe, test, expect } from 'vitest'
import { cacheBuckets, cacheHitRate, cacheTone } from './cacheRate'
import type { CurrentUsageState } from '../types'

const makeUsage = (
  cached: number,
  wrote: number,
  fresh: number
): CurrentUsageState => ({
  inputTokens: fresh,
  outputTokens: 0,
  cacheCreationInputTokens: wrote,
  cacheReadInputTokens: cached,
})

describe('cacheBuckets', () => {
  test('returns all zeros for null input', () => {
    expect(cacheBuckets(null)).toEqual({
      cached: 0,
      wrote: 0,
      fresh: 0,
      total: 0,
    })
  })

  test('returns all zeros for undefined input', () => {
    expect(cacheBuckets(undefined)).toEqual({
      cached: 0,
      wrote: 0,
      fresh: 0,
      total: 0,
    })
  })

  test('returns all zeros for fully zero usage', () => {
    expect(cacheBuckets(makeUsage(0, 0, 0))).toEqual({
      cached: 0,
      wrote: 0,
      fresh: 0,
      total: 0,
    })
  })

  test('sums populated buckets', () => {
    expect(cacheBuckets(makeUsage(7500, 1800, 700))).toEqual({
      cached: 7500,
      wrote: 1800,
      fresh: 700,
      total: 10000,
    })
  })
})

describe('cacheHitRate', () => {
  test('returns null for null input', () => {
    expect(cacheHitRate(null)).toBeNull()
  })

  test('returns null for undefined input', () => {
    expect(cacheHitRate(undefined)).toBeNull()
  })

  test('returns null when total is zero', () => {
    expect(cacheHitRate(makeUsage(0, 0, 0))).toBeNull()
  })

  test('returns 0 when only fresh tokens', () => {
    expect(cacheHitRate(makeUsage(0, 0, 1000))).toBe(0)
  })

  test('returns 1 when only cached tokens', () => {
    expect(cacheHitRate(makeUsage(1000, 0, 0))).toBe(1)
  })

  test('returns 0.5 for evenly split cached + fresh', () => {
    expect(cacheHitRate(makeUsage(500, 0, 500))).toBe(0.5)
  })

  test('uses canonical formula: cached / (cached + wrote + fresh)', () => {
    // 7500 / (7500 + 1800 + 700) === 0.75
    expect(cacheHitRate(makeUsage(7500, 1800, 700))).toBe(0.75)
  })
})

describe('cacheTone', () => {
  test('returns null for null rate', () => {
    expect(cacheTone(null)).toBeNull()
  })

  test('returns "cold" below 0.4', () => {
    expect(cacheTone(0)).toBe('cold')
    expect(cacheTone(0.39)).toBe('cold')
    expect(cacheTone(0.399999)).toBe('cold')
  })

  test('returns "warming" at and above 0.4, below 0.7', () => {
    expect(cacheTone(0.4)).toBe('warming')
    expect(cacheTone(0.5)).toBe('warming')
    expect(cacheTone(0.69)).toBe('warming')
    expect(cacheTone(0.699999)).toBe('warming')
  })

  test('returns "healthy" at and above 0.7', () => {
    expect(cacheTone(0.7)).toBe('healthy')
    expect(cacheTone(0.85)).toBe('healthy')
    expect(cacheTone(1.0)).toBe('healthy')
  })
})
```

- [ ] **Step 2: Run the test file to verify everything fails**

Run: `npx vitest run src/features/agent-status/utils/cacheRate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the implementation** at `src/features/agent-status/utils/cacheRate.ts`

```ts
import type { CurrentUsageState } from '../types'

export type CacheTone = 'healthy' | 'warming' | 'cold'

export interface CacheBuckets {
  cached: number
  wrote: number
  fresh: number
  total: number
}

export const cacheBuckets = (
  usage: CurrentUsageState | null | undefined
): CacheBuckets => {
  if (!usage) {
    return { cached: 0, wrote: 0, fresh: 0, total: 0 }
  }

  const cached = usage.cacheReadInputTokens
  const wrote = usage.cacheCreationInputTokens
  const fresh = usage.inputTokens

  return {
    cached,
    wrote,
    fresh,
    total: cached + wrote + fresh,
  }
}

export const cacheHitRate = (
  usage: CurrentUsageState | null | undefined
): number | null => {
  const { cached, total } = cacheBuckets(usage)

  if (total === 0) {
    return null
  }

  return cached / total
}

export const cacheTone = (rate: number | null): CacheTone | null => {
  if (rate === null) {
    return null
  }

  if (rate >= 0.7) {
    return 'healthy'
  }

  if (rate >= 0.4) {
    return 'warming'
  }

  return 'cold'
}
```

- [ ] **Step 4: Run the tests again to verify all pass**

Run: `npx vitest run src/features/agent-status/utils/cacheRate.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  src/features/agent-status/utils/cacheRate.ts \
  src/features/agent-status/utils/cacheRate.test.ts
git commit -m "feat(agent-status): add cacheRate pure utilities"
```

---

## Task 3: Build the `TokenCache` component

**Files:**

- Create: `src/features/agent-status/components/TokenCache.tsx`
- Create: `src/features/agent-status/components/TokenCache.test.tsx`

- [ ] **Step 1: Write the full failing test file** at `src/features/agent-status/components/TokenCache.test.tsx`

```tsx
import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TokenCache } from './TokenCache'
import type { CurrentUsageState } from '../types'

const makeUsage = (
  cached: number,
  wrote: number,
  fresh: number
): CurrentUsageState => ({
  inputTokens: fresh,
  outputTokens: 0,
  cacheCreationInputTokens: wrote,
  cacheReadInputTokens: cached,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TokenCache — empty state', () => {
  test('renders "no data yet" caption when usage is null', () => {
    render(<TokenCache usage={null} />)
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  test('renders "no data yet" when all buckets are zero', () => {
    render(<TokenCache usage={makeUsage(0, 0, 0)} />)
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  test('does not render the pulse dot in empty state', () => {
    render(<TokenCache usage={null} />)
    expect(screen.queryByTestId('token-cache-pulse')).toBeNull()
  })

  test('renders zero counts in the stat grid in empty state', () => {
    render(<TokenCache usage={null} />)

    const cached = screen.getByTestId('token-cache-stat-cached')
    const wrote = screen.getByTestId('token-cache-stat-wrote')
    const fresh = screen.getByTestId('token-cache-stat-fresh')

    expect(cached).toHaveTextContent('0')
    expect(wrote).toHaveTextContent('0')
    expect(fresh).toHaveTextContent('0')
  })
})

describe('TokenCache — populated', () => {
  test('renders the headline percentage with tabular-nums', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} />)
    const readout = screen.getByTestId('token-cache-percent')
    expect(readout).toHaveTextContent('75%')
    expect(readout.className).toMatch(/tabular-nums/)
  })

  test('renders "CACHED THIS TURN" caption', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} />)
    expect(screen.getByText(/cached this turn/i)).toBeInTheDocument()
  })

  test('renders the pulse dot when populated', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} />)
    expect(screen.getByTestId('token-cache-pulse')).toBeInTheDocument()
  })

  test('renders raw token counts in the stat grid', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} />)

    expect(screen.getByTestId('token-cache-stat-cached')).toHaveTextContent(
      '7.5k'
    )
    expect(screen.getByTestId('token-cache-stat-wrote')).toHaveTextContent(
      '1.8k'
    )
    expect(screen.getByTestId('token-cache-stat-fresh')).toHaveTextContent(
      '700'
    )
  })

  test('renders three labelled hints', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} />)
    expect(screen.getByText(/free reuse/i)).toBeInTheDocument()
    expect(screen.getByText(/uploaded/i)).toBeInTheDocument()
    expect(screen.getByText(/new tokens/i)).toBeInTheDocument()
  })
})

describe('TokenCache — tone thresholds', () => {
  test('cold tone below 0.4', () => {
    // 350 / (350 + 350 + 300) = 0.35 → cold
    render(<TokenCache usage={makeUsage(350, 350, 300)} />)
    const readout = screen.getByTestId('token-cache-percent')
    expect(readout).toHaveAttribute('data-tone', 'cold')
  })

  test('warming tone at exactly 0.4', () => {
    // 400 / (400 + 300 + 300) = 0.4 → warming
    render(<TokenCache usage={makeUsage(400, 300, 300)} />)
    const readout = screen.getByTestId('token-cache-percent')
    expect(readout).toHaveAttribute('data-tone', 'warming')
  })

  test('warming tone just below 0.7', () => {
    // 690 / (690 + 200 + 110) = 0.69 → warming
    render(<TokenCache usage={makeUsage(690, 200, 110)} />)
    const readout = screen.getByTestId('token-cache-percent')
    expect(readout).toHaveAttribute('data-tone', 'warming')
  })

  test('healthy tone at exactly 0.7', () => {
    // 700 / (700 + 200 + 100) = 0.7 → healthy
    render(<TokenCache usage={makeUsage(700, 200, 100)} />)
    const readout = screen.getByTestId('token-cache-percent')
    expect(readout).toHaveAttribute('data-tone', 'healthy')
  })
})

describe('TokenCache — stack bar', () => {
  test('renders three segments summing to ~100% in populated case', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} />)

    const cached = screen.getByTestId('token-cache-stack-cached')
    const wrote = screen.getByTestId('token-cache-stack-wrote')
    const fresh = screen.getByTestId('token-cache-stack-fresh')

    const widths = [
      parseFloat(cached.style.width),
      parseFloat(wrote.style.width),
      parseFloat(fresh.style.width),
    ]
    const sum = widths.reduce((a, b) => a + b, 0)

    expect(sum).toBeGreaterThan(99.9)
    expect(sum).toBeLessThan(100.1)
  })

  test('renders the tonal empty band in the zero state', () => {
    render(<TokenCache usage={null} />)
    const empty = screen.getByTestId('token-cache-stack-empty')
    expect(empty).toBeInTheDocument()
    // Tonal background, no border (UNIFIED.md §8 + DESIGN.md §23).
    expect(empty.className).toMatch(/bg-surface-container-high/)
    expect(empty.className).not.toMatch(/\bborder\b/)
    expect(screen.queryByTestId('token-cache-stack-cached')).toBeNull()
  })
})

describe('TokenCache — pulse dot uses Tailwind animation', () => {
  test('pulse dot has the animate-pulse class when populated', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} />)
    expect(screen.getByTestId('token-cache-pulse')).toHaveClass('animate-pulse')
  })

  test('does not leak any timers across unmount', () => {
    vi.useFakeTimers()
    const { unmount } = render(
      <TokenCache usage={makeUsage(7500, 1800, 700)} />
    )
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test file to verify everything fails**

Run: `npx vitest run src/features/agent-status/components/TokenCache.test.tsx`
Expected: FAIL — `TokenCache` not exported.

- [ ] **Step 3: Create the implementation** at `src/features/agent-status/components/TokenCache.tsx`

```tsx
import type { ReactElement } from 'react'
import type { CurrentUsageState } from '../types'
import {
  cacheBuckets,
  cacheHitRate,
  cacheTone,
  type CacheTone,
} from '../utils/cacheRate'
import { formatTokens } from './BudgetMetrics'

// Pulse animation: use Tailwind's built-in `animate-pulse` to match the
// existing pulse-dot pattern (ActivityEvent.tsx:180, ToolCallSummary.tsx:45,
// FileStatusBar.tsx:37). Do NOT import `stateToken` from docs/design/tokens —
// that file is the design reference, not a runtime token source, and is not
// imported anywhere in src/.

export interface TokenCacheProps {
  usage: CurrentUsageState | null
}

const TONE_TEXT: Record<CacheTone, string> = {
  healthy: 'text-success',
  warming: 'text-primary-container',
  cold: 'text-tertiary',
}

const TONE_BG: Record<CacheTone, string> = {
  healthy: 'bg-success',
  warming: 'bg-primary-container',
  cold: 'bg-tertiary',
}

const StackBar = ({
  cached,
  wrote,
  fresh,
  total,
}: {
  cached: number
  wrote: number
  fresh: number
  total: number
}): ReactElement => {
  if (total === 0) {
    // Tonal empty band — no segments, no border. Per UNIFIED.md §8
    // ("1px borders for sectioning — tonal shift only") and DESIGN.md §23
    // (ghost borders only at 15% opacity), the empty state uses a slightly
    // raised tonal background instead of a full-opacity outline.
    return (
      <div
        data-testid="token-cache-stack-empty"
        className="h-1.5 w-full rounded-full bg-surface-container-high"
      />
    )
  }

  const cachedPct = (cached / total) * 100
  const wrotePct = (wrote / total) * 100
  const freshPct = (fresh / total) * 100

  return (
    <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full">
      <div
        data-testid="token-cache-stack-cached"
        className="bg-success"
        style={{ width: `${cachedPct}%` }}
      />
      <div
        data-testid="token-cache-stack-wrote"
        className="bg-primary-container"
        style={{ width: `${wrotePct}%` }}
      />
      <div
        data-testid="token-cache-stack-fresh"
        className="bg-tertiary"
        style={{ width: `${freshPct}%` }}
      />
    </div>
  )
}

const StatCell = ({
  label,
  value,
  hint,
  testId,
}: {
  label: string
  value: string
  hint: string
  testId: string
}): ReactElement => (
  <div className="flex flex-col gap-1 rounded-lg bg-surface-container px-2.5 py-2">
    <span className="text-[8px] font-bold uppercase tracking-[0.08em] text-outline">
      {label}
    </span>
    <span
      data-testid={testId}
      className="font-mono text-sm font-semibold tabular-nums text-on-surface"
    >
      {value}
    </span>
    <span className="text-[8px] text-outline-variant">{hint}</span>
  </div>
)

export const TokenCache = ({ usage }: TokenCacheProps): ReactElement => {
  const buckets = cacheBuckets(usage)
  const rate = cacheHitRate(usage)
  const tone = cacheTone(rate)
  const isEmpty = rate === null

  return (
    <div
      data-testid="token-cache"
      className="flex flex-col gap-2 rounded-lg bg-surface-container-low px-2.5 py-2"
    >
      <span className="text-[8px] font-bold uppercase tracking-[0.08em] text-outline">
        Token Cache
      </span>

      <StackBar {...buckets} />

      <div className="flex items-center gap-2">
        <span
          data-testid="token-cache-percent"
          data-tone={tone ?? 'empty'}
          className={`font-mono text-[2.25rem] leading-none font-semibold tabular-nums ${
            tone ? TONE_TEXT[tone] : 'text-outline-variant'
          }`}
        >
          {isEmpty ? '—' : `${Math.round(rate * 100)}%`}
        </span>
        {!isEmpty && tone ? (
          <span
            data-testid="token-cache-pulse"
            className={`h-2 w-2 animate-pulse rounded-full ${TONE_BG[tone]}`}
          />
        ) : null}
      </div>

      <span
        className={`text-[8px] font-bold uppercase tracking-[0.08em] ${
          isEmpty ? 'text-outline-variant' : 'text-outline'
        }`}
      >
        {isEmpty ? 'no data yet' : 'cached this turn'}
      </span>

      <div className="grid grid-cols-3 gap-2">
        <StatCell
          label="cached"
          value={formatTokens(buckets.cached)}
          hint="free reuse"
          testId="token-cache-stat-cached"
        />
        <StatCell
          label="wrote"
          value={formatTokens(buckets.wrote)}
          hint="uploaded"
          testId="token-cache-stat-wrote"
        />
        <StatCell
          label="fresh"
          value={formatTokens(buckets.fresh)}
          hint="new tokens"
          testId="token-cache-stat-fresh"
        />
      </div>
    </div>
  )
}

export default TokenCache
```

- [ ] **Step 4: Run the test file to verify all pass**

Run: `npx vitest run src/features/agent-status/components/TokenCache.test.tsx`
Expected: ALL PASS.

> If any tone or pulse assertion fails because Tailwind classes (`bg-success`, `text-success`, `bg-primary-container`, `bg-tertiary`, `text-tertiary`, `text-primary-container`, `bg-surface-container-low`, `bg-surface-container-high`) are not in `tailwind.config.js`, audit the config: every class used here must already have a token; if any are missing, add them as a follow-up Task before continuing. Do NOT invent new color tokens — they all should map to existing `semantic.*` / `primary.*` / `surface.*` entries in `docs/design/tokens.ts`.

- [ ] **Step 5: Commit**

```bash
git add \
  src/features/agent-status/components/TokenCache.tsx \
  src/features/agent-status/components/TokenCache.test.tsx
git commit -m "feat(agent-status): add TokenCache presentational component"
```

---

## Task 4: Wire `<TokenCache>` into `AgentStatusPanel`

**Files:**

- Modify: `src/features/agent-status/components/AgentStatusPanel.tsx`
- Modify: `src/features/agent-status/components/AgentStatusPanel.test.tsx`

- [ ] **Step 1: Write the failing test cases** in `AgentStatusPanel.test.tsx`

Append to the existing `describe('AgentStatusPanel', () => { ... })` block. The first test asserts that the `TokenCache` root element appears in the correct DOM slot — between `ContextBucket` and the scrollable region — using `compareDocumentPosition`. Spec §4 (and the design doc anatomy) require this slot exactly.

```ts
test('renders TokenCache populated with the canonical hit rate', async () => {
  const { useAgentStatus } = await import('../hooks/useAgentStatus')
  vi.mocked(useAgentStatus).mockReturnValue({
    ...defaultStatus,
    isActive: true,
    agentType: 'claude-code',
    sessionId: 'session-1',
    contextWindow: {
      usedPercentage: 10,
      contextWindowSize: 200000,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      currentUsage: {
        inputTokens: 700,
        outputTokens: 0,
        cacheCreationInputTokens: 1800,
        cacheReadInputTokens: 7500,
      },
    },
  })

  render(<AgentStatusPanel {...defaultProps} sessionId="session-1" />)

  const percent = screen.getByTestId('token-cache-percent')
  expect(percent).toHaveTextContent('75%')
})

test('renders TokenCache empty state when currentUsage is null', async () => {
  const { useAgentStatus } = await import('../hooks/useAgentStatus')
  vi.mocked(useAgentStatus).mockReturnValue({
    ...defaultStatus,
    isActive: true,
    agentType: 'claude-code',
    sessionId: 'session-1',
    contextWindow: null,
  })

  render(<AgentStatusPanel {...defaultProps} sessionId="session-1" />)

  expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
})

test('mounts TokenCache between ContextBucket and the scrollable region', async () => {
  const { useAgentStatus } = await import('../hooks/useAgentStatus')
  vi.mocked(useAgentStatus).mockReturnValue({
    ...defaultStatus,
    isActive: true,
    agentType: 'claude-code',
    sessionId: 'session-1',
    contextWindow: {
      usedPercentage: 10,
      contextWindowSize: 200000,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      currentUsage: {
        inputTokens: 700,
        outputTokens: 0,
        cacheCreationInputTokens: 1800,
        cacheReadInputTokens: 7500,
      },
    },
  })

  render(<AgentStatusPanel {...defaultProps} sessionId="session-1" />)

  const panel = screen.getByTestId('agent-status-panel')
  const tokenCache = screen.getByTestId('token-cache')
  const scrollable = panel.querySelector('.thin-scrollbar')

  // DOM-order requirements from the design spec:
  //   StatusCard → ContextBucket → TokenCache  (static top region, in this order)
  //                                ↓
  //                         scrollable region

  // 1. TokenCache must be the LAST child of the static top region
  //    (i.e., it follows StatusCard and ContextBucket, never precedes them).
  const staticTop = panel.firstElementChild
  expect(staticTop).not.toBeNull()
  expect(staticTop?.lastElementChild).toBe(tokenCache)

  // 2. TokenCache must precede the scrollable region in document order.
  expect(scrollable).not.toBeNull()
  const positionRelativeToScrollable =
    tokenCache.compareDocumentPosition(scrollable as Node)
  expect(
    positionRelativeToScrollable & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/features/agent-status/components/AgentStatusPanel.test.tsx -t "TokenCache"`
Expected: FAIL — TokenCache is not in the panel yet.

- [ ] **Step 3: Wire the component** in `AgentStatusPanel.tsx`

Add the import alongside the others at the top of the file:

```ts
import { TokenCache } from './TokenCache'
```

Then, in the JSX (lines 60-79 in the current file), insert `<TokenCache>` between `<ContextBucket>` and the closing tag of the static top region:

```diff
            <ContextBucket
              usedPercentage={status.contextWindow?.usedPercentage ?? null}
              contextWindowSize={
                status.contextWindow?.contextWindowSize ?? 200_000
              }
              totalInputTokens={status.contextWindow?.totalInputTokens ?? 0}
              totalOutputTokens={status.contextWindow?.totalOutputTokens ?? 0}
            />
+           <TokenCache usage={status.contextWindow?.currentUsage ?? null} />
          </div>

          <div className="thin-scrollbar flex-1 overflow-y-auto">
```

- [ ] **Step 4: Run the panel tests + the full agent-status suite**

Run: `npx vitest run src/features/agent-status`
Expected: ALL PASS, including all pre-existing panel tests (the change is additive).

- [ ] **Step 5: Commit**

```bash
git add \
  src/features/agent-status/components/AgentStatusPanel.tsx \
  src/features/agent-status/components/AgentStatusPanel.test.tsx
git commit -m "feat(agent-status): mount TokenCache in AgentStatusPanel"
```

---

## Task 5: Workspace integration test

**Files:**

- Modify: `src/features/workspace/WorkspaceView.integration.test.tsx`

- [ ] **Step 1: Locate the existing workspace test setup**

The file already mocks `useAgentStatus` with a default object (lines 22-37 in the current file). Find the `describe` or test that exercises the panel; if there's already a "renders the agent status panel" or similar test, the new tests can sit beside it. Otherwise, append a new `describe('WorkspaceView — TokenCache wiring', () => { ... })` block.

- [ ] **Step 2: Write the two failing test cases**

Inside the new `describe` block (or beside the existing panel test):

```tsx
test('renders TokenCache with healthy headline when currentUsage is populated', async () => {
  const { useAgentStatus } =
    await import('../agent-status/hooks/useAgentStatus')
  vi.mocked(useAgentStatus).mockReturnValue({
    isActive: true,
    agentType: 'claude-code',
    modelId: 'sonnet-4-5',
    modelDisplayName: 'Sonnet 4.5',
    version: '1.0',
    sessionId: 'sess-1',
    agentSessionId: 'a-1',
    contextWindow: {
      usedPercentage: 30,
      contextWindowSize: 200000,
      totalInputTokens: 60000,
      totalOutputTokens: 1200,
      currentUsage: {
        inputTokens: 700,
        outputTokens: 0,
        cacheCreationInputTokens: 1800,
        cacheReadInputTokens: 7500,
      },
    },
    cost: null,
    rateLimits: null,
    toolCalls: { total: 0, byType: {}, active: null },
    recentToolCalls: [],
    testRun: null,
  })

  render(<WorkspaceView />)

  await waitFor(() => {
    const percent = screen.getByTestId('token-cache-percent')
    expect(percent).toHaveTextContent('75%')
  })
})

test('renders TokenCache empty state when currentUsage is null', async () => {
  const { useAgentStatus } =
    await import('../agent-status/hooks/useAgentStatus')
  vi.mocked(useAgentStatus).mockReturnValue({
    isActive: true,
    agentType: 'claude-code',
    modelId: null,
    modelDisplayName: null,
    version: null,
    sessionId: 'sess-1',
    agentSessionId: null,
    contextWindow: null,
    cost: null,
    rateLimits: null,
    toolCalls: { total: 0, byType: {}, active: null },
    recentToolCalls: [],
    testRun: null,
  })

  render(<WorkspaceView />)

  await waitFor(() => {
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the integration tests**

Run: `npx vitest run src/features/workspace/WorkspaceView.integration.test.tsx`
Expected: ALL PASS, including pre-existing integration tests.

- [ ] **Step 4: Commit**

```bash
git add src/features/workspace/WorkspaceView.integration.test.tsx
git commit -m "test(workspace): integration tests for TokenCache wiring"
```

---

## Task 6: Final verification (full test suite + lint + type-check)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: ALL PASS, no regressions.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Run type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 4: Run prettier check**

Run: `npm run format:check`
Expected: clean. If the formatter complains, run `npm run format` and amend the last commit.

- [ ] **Step 5: Visual smoke (optional but encouraged)**

If `npm run tauri:dev` is already running on the user's machine, the changes hot-reload. Inspect the right panel: when an agent is active and Claude Code emits its first statusline.json with `currentUsage` populated, the Token Cache block should render between the context bucket and the activity feed with a percentage, stack bar, and stat grid. If the block stays in the empty "no data yet" state, that's the expected fallback.

- [ ] **Step 6: Final summary commit (optional, only if any auto-fix changes accumulated)**

If steps 1–4 produced any auto-fix changes, commit them as `chore: format auto-fix`. Otherwise no additional commit.

---

## Self-Review Checklist (run before declaring done)

- [ ] Every task in §Tasks maps to at least one file in the §File Structure table; no orphan tasks.
- [ ] No "TBD" / "TODO" / "implement later" / placeholder text in any task body.
- [ ] Every method, type, and class referenced in a later task is defined in an earlier task. Specifically: `CurrentUsageState` (Task 1) → used in Tasks 2-5; `cacheBuckets` / `cacheHitRate` / `cacheTone` (Task 2) → used in Task 3; `TokenCache` (Task 3) → mounted in Task 4; mounted panel → tested in Task 5.
- [ ] Field names match exactly: `cacheReadInputTokens`, `cacheCreationInputTokens`, `inputTokens`, `outputTokens` — never abbreviated, never reordered.
- [ ] Tone thresholds match the spec: `>= 0.7 → 'healthy'`, `>= 0.4 → 'warming'`, `< 0.4 → 'cold'`. Boundary cases tested at exactly 0.4 and 0.7.
- [ ] Pulse uses Tailwind's `animate-pulse` class (matches `ActivityEvent.tsx:180`, `ToolCallSummary.tsx:45`, `FileStatusBar.tsx:37`); no `setInterval`, no import of `stateToken` from `docs/design/tokens.ts`.
- [ ] Task 4's mount-slot test asserts DOM order via `compareDocumentPosition` against the scrollable region AND verifies `TokenCache` is the last child of the static top region (so it follows `StatusCard` and `ContextBucket`).
- [ ] Task 1 lands in a single atomic commit — type addition + hook normalization + tests — so every commit on the branch type-checks (no intermediate state where `ContextWindowState.currentUsage` is required but unset).
- [ ] No mocks introduced into pure-utility tests in Task 2 (they are pure functions).
- [ ] No new Tauri commands, no new event subscriptions, no transcript reading, no Rust changes — verify by grepping the diff for `invoke(`, `listen(`, `tauri::command`.

---

## Out of scope (deferred to a follow-up paired spec)

- In-session sparkline (12-sample trend line)
- History bars of past sessions (Claude-web style)
- Global status bar `⚡ N% cached` indicator
- Rust transcript-JSONL reader for historical samples
- Schema-v2 extension to `app_data_dir/sessions.json` for per-session cache history

These are linked — the indicator and history bars need a historical data source, and the data source needs persistence. They will be addressed in a single follow-up spec.
