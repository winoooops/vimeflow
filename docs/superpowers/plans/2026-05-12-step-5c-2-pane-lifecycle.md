# Step 5c-2 — Pane Lifecycle (addPane / removePane / placeholder / X-close / auto-shrink) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship pane _lifecycle_ mutations on top of 5c-1's passive layout picker. Per-pane X-close on multi-pane sessions, a `+ click to add pane` placeholder in empty grid tracks, and auto-shrink of `session.layout` on close. Closes 5c-1 Decision #10's deferred Rust active-pane sync.

**Architecture:** Two new pure reducers (`applyAddPane`, `applyRemovePane`) live in `src/features/sessions/utils/paneLifecycle.ts` alongside three small helpers (`autoShrinkLayoutFor`, `pickNextActivePaneId`, `nextFreePaneId`). The reducers return `{ sessions, appended }` / `{ sessions, removedPtyId?, newActivePtyId? }` so the React-bound wrapper in `useSessionManager` can detect no-ops and recover spawned/killed PTYs. A per-session `pendingPaneOps: Set<string>` ref serializes pane mutations on the same session, closing the 2-pane double-close race and the parallel-add collision race. A new `EmptySlot` component renders the `+` button; SplitView mounts one per empty grid track. `TerminalPane.onClose` widens to `(sessionId, paneId)`.

**Tech Stack:** TypeScript, React 19, Tailwind CSS, Vitest + @testing-library/react, framer-motion v12.38, xterm.js. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-05-12-step-5c-2-pane-lifecycle-design.md`

---

## File Structure

**New (4 files):**

- `src/features/sessions/utils/paneLifecycle.ts` — `applyAddPane`, `applyRemovePane`, `autoShrinkLayoutFor`, `pickNextActivePaneId`, `nextFreePaneId`, `ApplyAddPaneResult`, `ApplyRemovePaneResult`
- `src/features/sessions/utils/paneLifecycle.test.ts`
- `src/features/terminal/components/SplitView/EmptySlot.tsx` — `+` button placeholder
- `src/features/terminal/components/SplitView/EmptySlot.test.tsx`

**Modified (10 files):**

- `src/features/sessions/hooks/useSessionManager.ts` — `pendingPaneOps` ref, `LAYOUTS` import, `addPane`, `removePane`, `setSessionActivePane` Rust sync
- `src/features/sessions/hooks/useSessionManager.test.ts`
- `src/features/terminal/components/SplitView/SplitView.tsx` — `onAddPane` / `onClosePane` props, EmptySlot mounting, `onClose` pass-through guarded by `panes.length > 1`
- `src/features/terminal/components/SplitView/SplitView.test.tsx`
- `src/features/terminal/components/TerminalPane/index.tsx` — widen `onClose: (sessionId, paneId) => void`
- `src/features/terminal/components/TerminalPane/index.test.tsx`
- `src/features/workspace/WorkspaceView.tsx` — destructure + plumb `addPane` / `removePane` to `TerminalZone`
- `src/features/workspace/WorkspaceView.test.tsx`
- `src/features/workspace/components/TerminalZone.tsx` — thread `onAddPane` / `onClosePane` props to `SplitView`
- `src/features/workspace/components/TerminalZone.test.tsx`
- `docs/roadmap/progress.yaml` — flip `ui-s5c-2` `pending` → `in_progress` at PR open

---

## Task 1: Pure helpers — `autoShrinkLayoutFor`, `pickNextActivePaneId`, `nextFreePaneId`

**Files:**

- Create: `src/features/sessions/utils/paneLifecycle.ts`
- Create: `src/features/sessions/utils/paneLifecycle.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/sessions/utils/paneLifecycle.test.ts
// cspell:ignore vsplit hsplit
import { describe, expect, test } from 'vitest'
import {
  autoShrinkLayoutFor,
  nextFreePaneId,
  pickNextActivePaneId,
} from './paneLifecycle'
import type { Pane } from '../types'

const mockPane = (overrides: Partial<Pane> = {}): Pane => ({
  id: 'p0',
  ptyId: 'pty-0',
  cwd: '/home/test',
  agentType: 'generic',
  status: 'running',
  active: true,
  ...overrides,
})

describe('autoShrinkLayoutFor', () => {
  test('1 pane → single', () => {
    expect(autoShrinkLayoutFor(1, 'quad')).toBe('single')
    expect(autoShrinkLayoutFor(1, 'vsplit')).toBe('single')
    expect(autoShrinkLayoutFor(1, 'hsplit')).toBe('single')
  })
  test('0 panes → single (defensive)', () => {
    expect(autoShrinkLayoutFor(0, 'vsplit')).toBe('single')
  })
  test('2 panes from hsplit → hsplit (preserves horizontal)', () => {
    expect(autoShrinkLayoutFor(2, 'hsplit')).toBe('hsplit')
  })
  test('2 panes from non-hsplit → vsplit', () => {
    expect(autoShrinkLayoutFor(2, 'vsplit')).toBe('vsplit')
    expect(autoShrinkLayoutFor(2, 'threeRight')).toBe('vsplit')
    expect(autoShrinkLayoutFor(2, 'quad')).toBe('vsplit')
    expect(autoShrinkLayoutFor(2, 'single')).toBe('vsplit')
  })
  test('3 panes → threeRight', () => {
    expect(autoShrinkLayoutFor(3, 'quad')).toBe('threeRight')
    expect(autoShrinkLayoutFor(3, 'vsplit')).toBe('threeRight')
  })
  test('≥4 panes → currentLayoutId (defensive)', () => {
    expect(autoShrinkLayoutFor(4, 'quad')).toBe('quad')
    expect(autoShrinkLayoutFor(5, 'quad')).toBe('quad')
  })
})

describe('pickNextActivePaneId', () => {
  test('prev exists → prev.id', () => {
    const panes = [mockPane({ id: 'p0' }), mockPane({ id: 'p1' })]
    expect(pickNextActivePaneId(panes, 1)).toBe('p0')
  })
  test('closing first pane (no prev) → successor.id', () => {
    const panes = [
      mockPane({ id: 'p0' }),
      mockPane({ id: 'p1' }),
      mockPane({ id: 'p2' }),
    ]
    expect(pickNextActivePaneId(panes, 0)).toBe('p1')
  })
  test('closing only pane (panes.length=1) → null', () => {
    expect(pickNextActivePaneId([mockPane()], 0)).toBeNull()
  })
  test('empty array → null', () => {
    expect(pickNextActivePaneId([], 0)).toBeNull()
  })
})

describe('nextFreePaneId', () => {
  test('empty → p0', () => {
    expect(nextFreePaneId([])).toBe('p0')
  })
  test('contiguous → next index', () => {
    expect(nextFreePaneId([mockPane({ id: 'p0' })])).toBe('p1')
    expect(
      nextFreePaneId([mockPane({ id: 'p0' }), mockPane({ id: 'p1' })])
    ).toBe('p2')
  })
  test('fills hole left by a remove', () => {
    expect(
      nextFreePaneId([mockPane({ id: 'p0' }), mockPane({ id: 'p2' })])
    ).toBe('p1')
  })
  test('unordered array still finds smallest free id', () => {
    expect(
      nextFreePaneId([
        mockPane({ id: 'p1' }),
        mockPane({ id: 'p0' }),
        mockPane({ id: 'p2' }),
      ])
    ).toBe('p3')
  })
})
```

- [ ] **Step 2: Run tests, expect fail (module not found)**

Run: `npx vitest run src/features/sessions/utils/paneLifecycle.test.ts`
Expected: FAIL with `Cannot find module './paneLifecycle'`.

- [ ] **Step 3: Implement the three helpers**

```ts
// src/features/sessions/utils/paneLifecycle.ts
// cspell:ignore vsplit hsplit
import type { LayoutId, Pane } from '../types'

export const autoShrinkLayoutFor = (
  nextPaneCount: number,
  currentLayoutId: LayoutId
): LayoutId => {
  if (nextPaneCount <= 1) return 'single'
  if (nextPaneCount === 2) {
    return currentLayoutId === 'hsplit' ? 'hsplit' : 'vsplit'
  }
  if (nextPaneCount === 3) return 'threeRight'
  // Defensive — removePane clamps to `panes.length − 1`, so 4 is
  // only reachable from a 5-pane fixture (5b's clamp would reject).
  return currentLayoutId
}

export const pickNextActivePaneId = (
  panes: readonly Pane[],
  closedIdx: number
): string | null => {
  // `panes` is the BEFORE-splice array; caller has verified
  // panes[closedIdx] exists (or the helper handles null).
  const prev = panes[closedIdx - 1]
  if (prev) return prev.id
  const next = panes[closedIdx + 1]
  return next?.id ?? null
}

export const nextFreePaneId = (panes: readonly Pane[]): string => {
  const ids = new Set(panes.map((p) => p.id))
  let n = 0
  // Linear scan is fine for capacity ≤ 4 (canonical layouts max at quad).
  while (ids.has(`p${n}`)) n += 1
  return `p${n}`
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/features/sessions/utils/paneLifecycle.test.ts`
Expected: PASS — three describe blocks, all green.

- [ ] **Step 5: Commit**

```bash
git add src/features/sessions/utils/paneLifecycle.ts src/features/sessions/utils/paneLifecycle.test.ts
git commit -m "feat(sessions): paneLifecycle pure helpers (autoShrink, pickNextActive, nextFreePaneId)"
```

---

## Task 2: `applyAddPane` reducer + `ApplyAddPaneResult`

**Files:**

- Modify: `src/features/sessions/utils/paneLifecycle.ts`
- Modify: `src/features/sessions/utils/paneLifecycle.test.ts`

- [ ] **Step 1: Add failing tests for `applyAddPane`**

Append to `src/features/sessions/utils/paneLifecycle.test.ts`:

```ts
import { emptyActivity } from '../constants'
import type { Session } from '../types'
import { applyAddPane } from './paneLifecycle'

const mockSession = (overrides: Partial<Session> = {}): Session => ({
  id: 's0',
  projectId: 'proj-1',
  name: 'test',
  status: 'running',
  workingDirectory: '/home/test',
  agentType: 'generic',
  layout: 'vsplit',
  panes: [mockPane({ id: 'p0', active: true })],
  createdAt: '2026-05-12T00:00:00Z',
  lastActivityAt: '2026-05-12T00:00:00Z',
  activity: { ...emptyActivity },
  ...overrides,
})

describe('applyAddPane', () => {
  const newPane: Pane = {
    id: 'p1',
    ptyId: 'pty-1',
    cwd: '/home/test',
    agentType: 'generic',
    status: 'running',
    active: true,
  }

  test('appends pane and flips existing pane to inactive', () => {
    const sessions = [mockSession()]
    const result = applyAddPane(sessions, 's0', newPane, 2)
    expect(result.appended).toBe(true)
    expect(result.sessions[0].panes).toHaveLength(2)
    expect(result.sessions[0].panes[0].active).toBe(false)
    expect(result.sessions[0].panes[1].id).toBe('p1')
    expect(result.sessions[0].panes[1].active).toBe(true)
  })

  test('re-derives workingDirectory + agentType from new active pane', () => {
    const sessions = [mockSession()]
    const cli: Pane = { ...newPane, cwd: '/tmp/scratch', agentType: 'codex' }
    const result = applyAddPane(sessions, 's0', cli, 2)
    expect(result.sessions[0].workingDirectory).toBe('/tmp/scratch')
    expect(result.sessions[0].agentType).toBe('codex')
  })

  test('re-derives Session.status via deriveSessionStatus', () => {
    const sessions = [
      mockSession({
        status: 'completed',
        panes: [mockPane({ id: 'p0', status: 'completed', active: true })],
      }),
    ]
    const result = applyAddPane(sessions, 's0', newPane, 2)
    expect(result.sessions[0].status).toBe('running')
  })

  test('no-op on missing sessionId (same reference)', () => {
    const sessions = [mockSession()]
    const result = applyAddPane(sessions, 'unknown', newPane, 2)
    expect(result.appended).toBe(false)
    expect(result.sessions).toBe(sessions)
  })

  test('no-op on pane id collision (same reference)', () => {
    const sessions = [mockSession()]
    const dup: Pane = { ...newPane, id: 'p0' }
    const result = applyAddPane(sessions, 's0', dup, 2)
    expect(result.appended).toBe(false)
    expect(result.sessions).toBe(sessions)
  })

  test('no-op when panes.length >= capacity', () => {
    const sessions = [
      mockSession({
        panes: [
          mockPane({ id: 'p0', active: false }),
          mockPane({ id: 'p1', active: true }),
        ],
      }),
    ]
    const result = applyAddPane(sessions, 's0', newPane, 2)
    expect(result.appended).toBe(false)
    expect(result.sessions).toBe(sessions)
  })

  test('leaves other sessions untouched', () => {
    const s1 = mockSession({ id: 's1', panes: [mockPane({ id: 'p0' })] })
    const sessions = [mockSession(), s1]
    const result = applyAddPane(sessions, 's0', newPane, 2)
    expect(result.sessions[1]).toBe(s1)
  })
})
```

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest run src/features/sessions/utils/paneLifecycle.test.ts -t applyAddPane`
Expected: FAIL — `applyAddPane is not exported` and `ApplyAddPaneResult` missing.

- [ ] **Step 3: Implement `applyAddPane` + `ApplyAddPaneResult`**

Update `src/features/sessions/utils/paneLifecycle.ts`:

```ts
// cspell:ignore vsplit hsplit
import type { LayoutId, Pane, Session } from '../types'
import { deriveSessionStatus } from './sessionStatus'

export interface ApplyAddPaneResult {
  sessions: Session[]
  /** True when the new pane was actually appended; false on no-op
   *  branches (missing session, pane id collision, capacity full at
   *  commit time). The consumer kills the freshly spawned PTY when
   *  `appended === false` so a race-lost spawn doesn't orphan a
   *  live PTY in Rust. */
  appended: boolean
}

// ... existing helpers stay above ...

export const applyAddPane = (
  sessions: Session[],
  sessionId: string,
  newPane: Pane,
  capacity: number
): ApplyAddPaneResult => {
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1) return { sessions, appended: false }

  const session = sessions[idx]
  // Capacity guard — runs against the latest committed `prev` so a
  // concurrent addPane that filled the slot during this call's await
  // window is detected at commit time.
  if (session.panes.length >= capacity) {
    return { sessions, appended: false }
  }
  // Pane id collision (defense-in-depth — the wrapper's
  // nextFreePaneId should never produce a duplicate).
  if (session.panes.some((p) => p.id === newPane.id)) {
    return { sessions, appended: false }
  }

  const existing = session.panes.map((p) =>
    p.active === false ? p : { ...p, active: false }
  )
  const panes: Pane[] = [...existing, { ...newPane, active: true }]

  const updated: Session = {
    ...session,
    panes,
    status: deriveSessionStatus(panes),
    workingDirectory: newPane.cwd,
    agentType: newPane.agentType,
  }

  return {
    sessions: [...sessions.slice(0, idx), updated, ...sessions.slice(idx + 1)],
    appended: true,
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/features/sessions/utils/paneLifecycle.test.ts -t applyAddPane`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/sessions/utils/paneLifecycle.ts src/features/sessions/utils/paneLifecycle.test.ts
git commit -m "feat(sessions): applyAddPane reducer with capacity guard + status re-derive"
```

---

## Task 3: `applyRemovePane` reducer + `ApplyRemovePaneResult`

**Files:**

- Modify: `src/features/sessions/utils/paneLifecycle.ts`
- Modify: `src/features/sessions/utils/paneLifecycle.test.ts`

- [ ] **Step 1: Add failing tests for `applyRemovePane`**

Append to `paneLifecycle.test.ts`:

```ts
import { applyRemovePane } from './paneLifecycle'

describe('applyRemovePane', () => {
  const twoPaneSession = (active: 'p0' | 'p1' = 'p0'): Session =>
    mockSession({
      layout: 'vsplit',
      panes: [
        mockPane({
          id: 'p0',
          ptyId: 'pty-0',
          cwd: '/dir-0',
          agentType: 'claude-code',
          active: active === 'p0',
        }),
        mockPane({
          id: 'p1',
          ptyId: 'pty-1',
          cwd: '/dir-1',
          agentType: 'codex',
          active: active === 'p1',
        }),
      ],
    })

  test('removes pane + auto-shrinks layout (vsplit → single)', () => {
    const sessions = [twoPaneSession('p0')]
    const result = applyRemovePane(sessions, 's0', 'p1', 'vsplit')
    expect(result.sessions[0].panes).toHaveLength(1)
    expect(result.sessions[0].layout).toBe('single')
    expect(result.removedPtyId).toBe('pty-1')
  })

  test('closing active pane rotates to predecessor + sets newActivePtyId', () => {
    const sessions = [twoPaneSession('p1')]
    const result = applyRemovePane(sessions, 's0', 'p1', 'vsplit')
    expect(result.sessions[0].panes[0].active).toBe(true)
    expect(result.sessions[0].panes[0].id).toBe('p0')
    expect(result.newActivePtyId).toBe('pty-0')
    expect(result.sessions[0].workingDirectory).toBe('/dir-0')
    expect(result.sessions[0].agentType).toBe('claude-code')
  })

  test('closing inactive pane leaves active flag untouched (no newActivePtyId)', () => {
    const sessions = [twoPaneSession('p0')]
    const result = applyRemovePane(sessions, 's0', 'p1', 'vsplit')
    expect(result.sessions[0].panes[0].active).toBe(true)
    expect(result.newActivePtyId).toBeUndefined()
  })

  test('closing in quad → threeRight (3 remaining)', () => {
    const sessions = [
      mockSession({
        layout: 'quad',
        panes: [
          mockPane({ id: 'p0', ptyId: 'pty-0', active: true }),
          mockPane({ id: 'p1', ptyId: 'pty-1', active: false }),
          mockPane({ id: 'p2', ptyId: 'pty-2', active: false }),
          mockPane({ id: 'p3', ptyId: 'pty-3', active: false }),
        ],
      }),
    ]
    const result = applyRemovePane(sessions, 's0', 'p3', 'quad')
    expect(result.sessions[0].panes).toHaveLength(3)
    expect(result.sessions[0].layout).toBe('threeRight')
  })

  test('hsplit → hsplit preservation (close 1 of 2 → single)', () => {
    const sessions = [twoPaneSession('p0')]
    sessions[0].layout = 'hsplit'
    const result = applyRemovePane(sessions, 's0', 'p1', 'hsplit')
    expect(result.sessions[0].layout).toBe('single')
  })

  test('re-derives Session.status via deriveSessionStatus', () => {
    const sessions = [
      mockSession({
        status: 'running',
        layout: 'vsplit',
        panes: [
          mockPane({ id: 'p0', status: 'completed', active: false }),
          mockPane({ id: 'p1', status: 'running', active: true }),
        ],
      }),
    ]
    const result = applyRemovePane(sessions, 's0', 'p1', 'vsplit')
    // After remove: panes=[{p0, completed}], status='completed'
    expect(result.sessions[0].status).toBe('completed')
  })

  test('no-op on missing sessionId', () => {
    const sessions = [twoPaneSession()]
    const result = applyRemovePane(sessions, 'unknown', 'p0', 'vsplit')
    expect(result.sessions).toBe(sessions)
    expect(result.removedPtyId).toBeUndefined()
  })

  test('no-op on missing paneId', () => {
    const sessions = [twoPaneSession()]
    const result = applyRemovePane(sessions, 's0', 'pX', 'vsplit')
    expect(result.sessions).toBe(sessions)
    expect(result.removedPtyId).toBeUndefined()
  })

  test('no-op on single-pane session (panes.length <= 1)', () => {
    const sessions = [mockSession({ layout: 'single' })]
    const result = applyRemovePane(sessions, 's0', 'p0', 'single')
    expect(result.sessions).toBe(sessions)
    expect(result.removedPtyId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest run src/features/sessions/utils/paneLifecycle.test.ts -t applyRemovePane`
Expected: FAIL (`applyRemovePane is not exported`).

- [ ] **Step 3: Implement `applyRemovePane` + `ApplyRemovePaneResult`**

Append to `src/features/sessions/utils/paneLifecycle.ts`:

```ts
export interface ApplyRemovePaneResult {
  sessions: Session[]
  /** Set when a pane was actually spliced out; absent on no-op
   *  branches. Consumer drops PTY bookkeeping for this id. */
  removedPtyId?: string
  /** Set only when the removed pane was the active one AND a
   *  successor was chosen. Consumer fires
   *  `service.setActiveSession(newActivePtyId)` outside the reducer. */
  newActivePtyId?: string
}

export const applyRemovePane = (
  sessions: Session[],
  sessionId: string,
  paneId: string,
  currentLayoutId: LayoutId
): ApplyRemovePaneResult => {
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1) return { sessions }

  const session = sessions[idx]
  const closedIdx = session.panes.findIndex((p) => p.id === paneId)
  if (closedIdx === -1) return { sessions }

  // Decision #8 — never let the reducer produce panes.length === 0;
  // the consumer (`removePane` in useSessionManager) warns earlier.
  if (session.panes.length <= 1) return { sessions }

  const closedPane = session.panes[closedIdx]
  const wasActive = closedPane.active

  const remaining = [
    ...session.panes.slice(0, closedIdx),
    ...session.panes.slice(closedIdx + 1),
  ]

  let panes = remaining
  let newActivePtyId: string | undefined

  if (wasActive) {
    const nextActiveId = pickNextActivePaneId(session.panes, closedIdx)
    panes = remaining.map((p) =>
      p.id === nextActiveId ? { ...p, active: true } : p
    )
    newActivePtyId = panes.find((p) => p.active)?.ptyId
  }

  const nextLayout = autoShrinkLayoutFor(remaining.length, currentLayoutId)
  const active = panes.find((p) => p.active)
  const updated: Session = {
    ...session,
    panes,
    layout: nextLayout,
    status: deriveSessionStatus(panes),
    workingDirectory: active?.cwd ?? session.workingDirectory,
    agentType: active?.agentType ?? session.agentType,
  }

  return {
    sessions: [...sessions.slice(0, idx), updated, ...sessions.slice(idx + 1)],
    removedPtyId: closedPane.ptyId,
    newActivePtyId,
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/features/sessions/utils/paneLifecycle.test.ts`
Expected: PASS — all 23+ cases across describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/features/sessions/utils/paneLifecycle.ts src/features/sessions/utils/paneLifecycle.test.ts
git commit -m "feat(sessions): applyRemovePane reducer with auto-shrink + status re-derive"
```

---

## Task 4: `useSessionManager.addPane` mutation (with `pendingPaneOps` ref + LAYOUTS import)

**Files:**

- Modify: `src/features/sessions/hooks/useSessionManager.ts`
- Modify: `src/features/sessions/hooks/useSessionManager.test.ts`

- [ ] **Step 1: Add failing tests for `addPane`**

Append to `src/features/sessions/hooks/useSessionManager.test.ts`. Match the existing `renderHook` + `createMockTerminalService` patterns already used by `setSessionLayout` / `setSessionActivePane` tests landed in 5c-1. Tests cover: success path, pre-flight capacity guard, post-spawn race recovery (`appended === false`), per-session serialization gate, and Rust setActiveSession sync.

```ts
// Inside the existing describe('useSessionManager', ...) block, add:

describe('addPane', () => {
  test('appends a pane and fires service.setActiveSession on active session', async () => {
    const { service, spawn, setActiveSession } =
      createMockTerminalServiceForPane()
    spawn.mockResolvedValueOnce({
      sessionId: 'pty-new',
      pid: 4242,
      cwd: '/home/test/added',
    })
    const { result } = renderManagerWithSession(service, {
      layout: 'vsplit',
      panes: [makePane({ id: 'p0', ptyId: 'pty-0', cwd: '/home/test' })],
    })

    await act(async () => {
      result.current.addPane(result.current.sessions[0].id)
      await flushPromises()
    })

    const session = result.current.sessions[0]
    expect(session.panes).toHaveLength(2)
    expect(session.panes[1].id).toBe('p1')
    expect(session.panes[1].active).toBe(true)
    expect(spawn).toHaveBeenCalledWith({
      cwd: '/home/test',
      env: {},
      enableAgentBridge: true,
    })
    expect(setActiveSession).toHaveBeenCalledWith('pty-new')
  })

  test('does NOT fire setActiveSession when session is not active', async () => {
    const { service, spawn, setActiveSession } =
      createMockTerminalServiceForPane()
    spawn.mockResolvedValueOnce({
      sessionId: 'pty-new',
      pid: 4242,
      cwd: '/home/test',
    })
    const { result } = renderManagerWithTwoSessions(service)
    // Active session is s0; we addPane on s1.
    await act(async () => {
      result.current.addPane('s1')
      await flushPromises()
    })

    expect(setActiveSession).not.toHaveBeenCalled()
  })

  test('pre-flight rejects when panes.length >= capacity', async () => {
    const { service, spawn } = createMockTerminalServiceForPane()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { result } = renderManagerWithSession(service, {
      layout: 'vsplit',
      panes: [
        makePane({ id: 'p0', active: false }),
        makePane({ id: 'p1', active: true }),
      ],
    })

    act(() => {
      result.current.addPane(result.current.sessions[0].id)
    })

    expect(spawn).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('kills orphan PTY when reducer rejects at commit (layout shrunk during spawn)', async () => {
    // Deterministic capacity race: a separate `setSessionLayout`
    // shrinks the session from `vsplit` (capacity 2) to `single`
    // (capacity 1) while `addPane`'s spawn is in flight.
    // `setSessionLayout` is not gated by `pendingPaneOps`, so it
    // commits immediately. When the spawn resolves and
    // `applyAddPane` runs against the latest committed state,
    // `panes.length (1) >= capacity (1)` and the reducer returns
    // `{ appended: false }`. The wrapper's recovery branch kills
    // the orphan PTY and drops bookkeeping.
    const { service, spawn, kill } = createMockTerminalServiceForPane()
    let resolveSpawn: (v: {
      sessionId: string
      pid: number
      cwd: string
    }) => void = () => undefined
    spawn.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveSpawn = res
        })
    )
    kill.mockResolvedValue(undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { result } = renderManagerWithSession(service, {
      layout: 'vsplit',
      panes: [makePane({ id: 'p0', active: true })],
    })

    // Pre-flight passes: 1 pane, vsplit capacity 2.
    act(() => {
      result.current.addPane(result.current.sessions[0].id)
    })
    // Shrink layout while spawn is pending.
    act(() => {
      result.current.setSessionLayout(result.current.sessions[0].id, 'single')
    })

    // Resolve the spawn — reducer commit sees capacity = 1.
    await act(async () => {
      resolveSpawn({ sessionId: 'pty-orphan', pid: 1234, cwd: '/home/test' })
      await flushPromises()
    })

    expect(kill).toHaveBeenCalledWith({ sessionId: 'pty-orphan' })
    expect(result.current.sessions[0].panes).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('reducer rejected commit')
    )
    warn.mockRestore()
  })

  test('serialization: second addPane while first in-flight is rejected', async () => {
    const { service, spawn } = createMockTerminalServiceForPane()
    let resolveSpawn: (v: {
      sessionId: string
      pid: number
      cwd: string
    }) => void = () => undefined
    spawn.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveSpawn = res
        })
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { result } = renderManagerWithSession(service, {
      layout: 'vsplit',
      panes: [makePane({ id: 'p0', active: true })],
    })

    act(() => {
      result.current.addPane(result.current.sessions[0].id)
    })
    // Second addPane while the first is awaiting spawn:
    act(() => {
      result.current.addPane(result.current.sessions[0].id)
    })

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('another pane op in flight')
    )

    // Resolve the first spawn so the test cleans up.
    await act(async () => {
      resolveSpawn({ sessionId: 'pty-1', pid: 99, cwd: '/home/test' })
      await flushPromises()
    })
    warn.mockRestore()
  })

  test('pendingSpawns increments + decrements (also on spawn failure)', async () => {
    const { service, spawn } = createMockTerminalServiceForPane()
    spawn.mockRejectedValueOnce(new Error('spawn boom'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { result } = renderManagerWithSession(service, {
      layout: 'vsplit',
      panes: [makePane({ id: 'p0', active: true })],
    })

    await act(async () => {
      result.current.addPane(result.current.sessions[0].id)
      await flushPromises()
    })

    // pendingSpawns is internal; assert auto-create-on-empty wouldn't
    // fire (i.e., the counter is back to 0 after spawn failure).
    expect(result.current.sessions[0].panes).toHaveLength(1)
    warn.mockRestore()
  })
})
```

The helpers `createMockTerminalServiceForPane`, `renderManagerWithSession`, `renderManagerWithTwoSessions`, `makePane`, and `flushPromises` reuse the same patterns the 5c-1 tests added at the top of `useSessionManager.test.ts`. If they don't exist yet (or have different names), inline the relevant `service = createTerminalService(...)` + `renderHook(() => useSessionManager(service, { autoCreateOnEmpty: false }))` setup directly per test.

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest run src/features/sessions/hooks/useSessionManager.test.ts -t "addPane"`
Expected: FAIL — `result.current.addPane is not a function`.

- [ ] **Step 3: Implement `addPane` + `pendingPaneOps` ref + `LAYOUTS` import**

Update `src/features/sessions/hooks/useSessionManager.ts`:

```ts
// At the top, with the other imports:
import { LAYOUTS } from '../../terminal/components/SplitView/layouts'
import {
  applyAddPane,
  nextFreePaneId,
} from '../utils/paneLifecycle'

// Add to the SessionManager interface (near setSessionLayout):
addPane: (sessionId: string) => void

// Inside useSessionManager body, alongside other refs:
const pendingPaneOps = useRef<Set<string>>(new Set())

// New mutation, declared after setSessionActivePane:
const addPane = useCallback(
  (sessionId: string): void => {
    if (pendingPaneOps.current.has(sessionId)) {
      // eslint-disable-next-line no-console
      console.warn(
        `addPane: another pane op in flight for ${sessionId}; ignoring`
      )
      return
    }
    const session = sessionsRef.current.find((s) => s.id === sessionId)
    if (!session) {
      // eslint-disable-next-line no-console
      console.warn(`addPane: no session ${sessionId}`)
      return
    }
    const activePane = findActivePane(session)
    if (!activePane) {
      // eslint-disable-next-line no-console
      console.warn(`addPane: session ${sessionId} has no active pane`)
      return
    }
    if (session.panes.length >= LAYOUTS[session.layout].capacity) {
      // eslint-disable-next-line no-console
      console.warn(
        `addPane: session ${sessionId} is at capacity for layout ${session.layout}`
      )
      return
    }

    pendingPaneOps.current.add(sessionId)
    setPendingSpawns((c) => c + 1)
    void (async (): Promise<void> => {
      try {
        const result = await service.spawn({
          cwd: activePane.cwd,
          env: {},
          enableAgentBridge: true,
        })

        const restoreData: RestoreData = {
          sessionId: result.sessionId,
          cwd: result.cwd,
          pid: result.pid,
          replayData: '',
          replayEndOffset: 0,
          bufferedEvents: [],
        }

        const fresh = sessionsRef.current.find((s) => s.id === sessionId)
        if (!fresh) {
          // eslint-disable-next-line promise/prefer-await-to-then,@typescript-eslint/no-empty-function
          service.kill({ sessionId: result.sessionId }).catch(() => {})
          return
        }

        const newPane: Pane = {
          id: nextFreePaneId(fresh.panes),
          ptyId: result.sessionId,
          cwd: result.cwd,
          agentType: 'generic',
          status: 'running',
          active: true,
          pid: result.pid,
          restoreData,
        }

        // NOTE: don't touch `restoreDataRef.current` here. The public
        // map is a zombie (F4 in useSessionManager.ts) — the live
        // restoreData source is `pane.restoreData`, which `newPane`
        // already carries. Skipping the set means we don't need a
        // matching delete on the rollback path.
        registerPending(result.sessionId)

        let appended = false
        flushSync(() => {
          setSessions((prev) => {
            const target = prev.find((s) => s.id === sessionId)
            const capacityAtCommit = target
              ? LAYOUTS[target.layout].capacity
              : 0
            const r = applyAddPane(prev, sessionId, newPane, capacityAtCommit)
            appended = r.appended
            return r.sessions
          })
        })

        if (!appended) {
          // eslint-disable-next-line promise/prefer-await-to-then,@typescript-eslint/no-empty-function
          service.kill({ sessionId: result.sessionId }).catch(() => {})
          // Drop pty-data buffer entries the orchestrator queued for
          // the orphan during the spawn window — registerPending
          // started buffering; without dropAllForPty those events
          // leak until the next session commit.
          dropAllForPty(result.sessionId)
          // eslint-disable-next-line no-console
          console.warn(
            `addPane: reducer rejected commit for ${sessionId}; orphan killed`
          )
          return
        }

        if (sessionId === activeSessionIdRef.current) {
          // eslint-disable-next-line promise/prefer-await-to-then
          service.setActiveSession(result.sessionId).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('addPane: setActiveSession failed', err)
          })
        }
        registerPtySession(result.sessionId, result.sessionId, result.cwd)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('addPane: spawn failed', err)
      } finally {
        setPendingSpawns((c) => c - 1)
        pendingPaneOps.current.delete(sessionId)
      }
    })()
  },
  [activeSessionIdRef, dropAllForPty, registerPending, service]
)

// Add `addPane` to the returned manager object:
return {
  // ... existing fields ...
  addPane,
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/features/sessions/hooks/useSessionManager.test.ts -t "addPane"`
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/sessions/hooks/useSessionManager.ts src/features/sessions/hooks/useSessionManager.test.ts
git commit -m "feat(sessions): addPane mutation with capacity guard + pendingPaneOps serialization"
```

---

## Task 5: `useSessionManager.removePane` mutation

**Files:**

- Modify: `src/features/sessions/hooks/useSessionManager.ts`
- Modify: `src/features/sessions/hooks/useSessionManager.test.ts`

- [ ] **Step 1: Add failing tests for `removePane`**

Append to `useSessionManager.test.ts`:

```ts
describe('removePane', () => {
  test('kills the PTY, splices the pane, auto-shrinks the layout', async () => {
    const { service, kill } = createMockTerminalServiceForPane()
    kill.mockResolvedValueOnce(undefined)
    const { result } = renderManagerWithSession(service, {
      layout: 'vsplit',
      panes: [
        makePane({ id: 'p0', ptyId: 'pty-0', active: true }),
        makePane({ id: 'p1', ptyId: 'pty-1', active: false }),
      ],
    })

    await act(async () => {
      result.current.removePane(result.current.sessions[0].id, 'p1')
      await flushPromises()
    })

    expect(kill).toHaveBeenCalledWith({ sessionId: 'pty-1' })
    expect(result.current.sessions[0].panes).toHaveLength(1)
    expect(result.current.sessions[0].layout).toBe('single')
  })

  test('rotates active pane + fires setActiveSession when closing the active pane', async () => {
    const { service, kill, setActiveSession } =
      createMockTerminalServiceForPane()
    kill.mockResolvedValueOnce(undefined)
    const { result } = renderManagerWithSession(service, {
      layout: 'vsplit',
      panes: [
        makePane({ id: 'p0', ptyId: 'pty-0', active: false }),
        makePane({ id: 'p1', ptyId: 'pty-1', active: true }),
      ],
    })

    await act(async () => {
      result.current.removePane(result.current.sessions[0].id, 'p1')
      await flushPromises()
    })

    expect(setActiveSession).toHaveBeenCalledWith('pty-0')
    expect(result.current.sessions[0].panes[0].active).toBe(true)
  })

  test('does NOT fire setActiveSession when removing on a non-active session tab', async () => {
    const { service, kill, setActiveSession } =
      createMockTerminalServiceForPane()
    kill.mockResolvedValueOnce(undefined)
    const { result } = renderManagerWithTwoSessions(service)
    // active is s0; remove a pane on s1.
    await act(async () => {
      result.current.removePane('s1', 'p1')
      await flushPromises()
    })
    expect(setActiveSession).not.toHaveBeenCalled()
  })

  test('warns + no-ops when session has only one pane', () => {
    const { service, kill } = createMockTerminalServiceForPane()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { result } = renderManagerWithSession(service, {
      layout: 'single',
      panes: [makePane({ id: 'p0', ptyId: 'pty-0', active: true })],
    })

    act(() => {
      result.current.removePane(result.current.sessions[0].id, 'p0')
    })

    expect(kill).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('refusing to remove the last pane')
    )
    warn.mockRestore()
  })

  test('keeps React state when service.kill rejects', async () => {
    const { service, kill } = createMockTerminalServiceForPane()
    kill.mockRejectedValueOnce(new Error('kill boom'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { result } = renderManagerWithSession(service, {
      layout: 'vsplit',
      panes: [
        makePane({ id: 'p0', ptyId: 'pty-0', active: true }),
        makePane({ id: 'p1', ptyId: 'pty-1', active: false }),
      ],
    })

    await act(async () => {
      result.current.removePane(result.current.sessions[0].id, 'p1')
      await flushPromises()
    })

    expect(result.current.sessions[0].panes).toHaveLength(2)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('serialization: second removePane while first in-flight is rejected', async () => {
    const { service, kill } = createMockTerminalServiceForPane()
    let resolveKill: () => void = () => undefined
    kill.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          resolveKill = res
        })
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { result } = renderManagerWithSession(service, {
      layout: 'vsplit',
      panes: [
        makePane({ id: 'p0', ptyId: 'pty-0', active: true }),
        makePane({ id: 'p1', ptyId: 'pty-1', active: false }),
      ],
    })

    act(() => {
      result.current.removePane(result.current.sessions[0].id, 'p0')
    })
    act(() => {
      result.current.removePane(result.current.sessions[0].id, 'p1')
    })

    expect(kill).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('another pane op in flight')
    )

    await act(async () => {
      resolveKill()
      await flushPromises()
    })
    warn.mockRestore()
  })
})
```

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest run src/features/sessions/hooks/useSessionManager.test.ts -t "removePane"`
Expected: FAIL — `result.current.removePane is not a function`.

- [ ] **Step 3: Implement `removePane`**

Update `src/features/sessions/hooks/useSessionManager.ts`:

```ts
// At the top, with the other utils imports:
import { applyRemovePane } from '../utils/paneLifecycle'

// SessionManager interface gains:
removePane: (sessionId: string, paneId: string) => void

// Body — declared after addPane:
const removePane = useCallback(
  (sessionId: string, paneId: string): void => {
    if (pendingPaneOps.current.has(sessionId)) {
      // eslint-disable-next-line no-console
      console.warn(
        `removePane: another pane op in flight for ${sessionId}; ignoring`
      )
      return
    }

    const session = sessionsRef.current.find((s) => s.id === sessionId)
    if (!session) {
      // eslint-disable-next-line no-console
      console.warn(`removePane: no session ${sessionId}`)
      return
    }
    const target = session.panes.find((p) => p.id === paneId)
    if (!target) {
      // eslint-disable-next-line no-console
      console.warn(
        `removePane: no pane ${paneId} in session ${sessionId}`
      )
      return
    }
    if (session.panes.length === 1) {
      // eslint-disable-next-line no-console
      console.warn(
        `removePane: refusing to remove the last pane in ${sessionId}; ` +
          `use removeSession instead`
      )
      return
    }

    pendingPaneOps.current.add(sessionId)
    void (async (): Promise<void> => {
      try {
        try {
          await service.kill({ sessionId: target.ptyId })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('removePane: kill failed; pane preserved', err)
          return
        }

        dropAllForPty(target.ptyId)
        restoreDataRef.current.delete(target.ptyId)
        unregisterPtySession(target.ptyId)

        let computedActivePtyId: string | undefined
        flushSync(() => {
          setSessions((prev) => {
            const fresh = prev.find((s) => s.id === sessionId)
            const layoutAtCommit = fresh?.layout ?? session.layout
            const r = applyRemovePane(prev, sessionId, paneId, layoutAtCommit)
            computedActivePtyId = r.newActivePtyId
            return r.sessions
          })
        })

        if (
          computedActivePtyId !== undefined &&
          sessionId === activeSessionIdRef.current
        ) {
          // eslint-disable-next-line promise/prefer-await-to-then
          service.setActiveSession(computedActivePtyId).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('removePane: setActiveSession failed', err)
          })
        }
      } finally {
        pendingPaneOps.current.delete(sessionId)
      }
    })()
  },
  [activeSessionIdRef, dropAllForPty, service]
)

// Add `removePane` to the returned manager object.
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/features/sessions/hooks/useSessionManager.test.ts -t "removePane"`
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/sessions/hooks/useSessionManager.ts src/features/sessions/hooks/useSessionManager.test.ts
git commit -m "feat(sessions): removePane mutation with auto-shrink + pendingPaneOps serialization"
```

---

## Task 6: `useSessionManager.setSessionActivePane` — Rust sync (Decision #5)

**Files:**

- Modify: `src/features/sessions/hooks/useSessionManager.ts`
- Modify: `src/features/sessions/hooks/useSessionManager.test.ts`

- [ ] **Step 1: Add failing tests for the Rust-sync addition**

Append to the existing `describe('setSessionActivePane', ...)` block in `useSessionManager.test.ts`:

```ts
test('fires service.setActiveSession when sessionId === activeSessionId', () => {
  const { service, setActiveSession } = createMockTerminalServiceForPane()
  const { result } = renderManagerWithSession(service, {
    layout: 'vsplit',
    panes: [
      makePane({ id: 'p0', ptyId: 'pty-0', active: true }),
      makePane({ id: 'p1', ptyId: 'pty-1', active: false }),
    ],
  })

  // Reset any setActiveSession calls fired during render / restore.
  setActiveSession.mockClear()

  act(() => {
    result.current.setSessionActivePane(result.current.sessions[0].id, 'p1')
  })

  expect(setActiveSession).toHaveBeenCalledWith('pty-1')
})

test('does NOT fire service.setActiveSession when sessionId is a different session', () => {
  const { service, setActiveSession } = createMockTerminalServiceForPane()
  const { result } = renderManagerWithTwoSessions(service)
  // active session is s0; rotate panes inside s1.
  setActiveSession.mockClear()

  act(() => {
    result.current.setSessionActivePane('s1', 'p1')
  })

  expect(setActiveSession).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest run src/features/sessions/hooks/useSessionManager.test.ts -t "setSessionActivePane"`
Expected: New tests FAIL — `setActiveSession` not called (only the 5c-1 behaviour exists).

- [ ] **Step 3: Add the Rust-sync call to `setSessionActivePane`**

Inside the existing `setSessionActivePane` body in `useSessionManager.ts`, immediately after the `setSessions((prev) => applyActivePane(prev, sessionId, paneId))` line, append:

```ts
if (sessionId === activeSessionIdRef.current) {
  // eslint-disable-next-line promise/prefer-await-to-then
  service.setActiveSession(target.ptyId).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('setSessionActivePane: setActiveSession failed', err)
  })
}
```

Also extend the `useCallback` dependency list to include `activeSessionIdRef` and `service` if they aren't already captured. (Linter will flag missing deps; add them explicitly.)

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/features/sessions/hooks/useSessionManager.test.ts -t "setSessionActivePane"`
Expected: PASS (all setSessionActivePane cases — pre-existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/features/sessions/hooks/useSessionManager.ts src/features/sessions/hooks/useSessionManager.test.ts
git commit -m "feat(sessions): sync Rust active PTY on setSessionActivePane rotation"
```

---

## Task 7: `TerminalPane.onClose` signature widening

**Files:**

- Modify: `src/features/terminal/components/TerminalPane/index.tsx`
- Modify: `src/features/terminal/components/TerminalPane/index.test.tsx`

- [ ] **Step 1: Update the existing `onClose` test for the widened signature**

Find the existing `onClose` test in `src/features/terminal/components/TerminalPane/index.test.tsx`. Update its assertion to expect both ids:

```tsx
test('handleClose forwards session.id and pane.id to onClose', () => {
  const onClose = vi.fn()
  const session = makeSession({ id: 's-test' })
  const pane = session.panes[0] // id 'p0'
  render(
    <TerminalPane
      session={session}
      pane={pane}
      isActive
      service={createMockTerminalService()}
      onClose={onClose}
    />
  )
  // The X-close button lives in HeaderActions with aria-label "close pane".
  fireEvent.click(screen.getByRole('button', { name: /close pane/i }))
  expect(onClose).toHaveBeenCalledWith('s-test', 'p0')
})
```

If the existing test asserts `onClose).toHaveBeenCalledWith('s-test')` (single arg), change it to the two-arg form above. Add the `'p0'` argument expectation.

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest run src/features/terminal/components/TerminalPane/index.test.tsx`
Expected: FAIL — the existing single-arg `handleClose` only passes `session.id`.

- [ ] **Step 3: Widen `onClose` in `TerminalPane/index.tsx`**

```tsx
// In the interface near the top:
export interface TerminalPaneProps {
  // ... existing fields ...
  /** Widened in 5c-2 from `(sessionId) => void` so multi-pane
   *  callers (SplitView) can address the closed pane without
   *  bind-trickery. */
  onClose?: (sessionId: string, paneId: string) => void
  // ... existing fields ...
}

// In the body, update handleClose:
const handleClose = useCallback((): void => {
  onClose?.(session.id, pane.id)
}, [onClose, session.id, pane.id])
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/features/terminal/components/TerminalPane/index.test.tsx`
Expected: PASS.

Also run the broader terminal test bucket to make sure no other consumer's expectations broke:

Run: `npx vitest run src/features/terminal`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/components/TerminalPane/index.tsx src/features/terminal/components/TerminalPane/index.test.tsx
git commit -m "refactor(terminal-pane): widen onClose to (sessionId, paneId)"
```

---

## Task 8: `EmptySlot` component

**Files:**

- Create: `src/features/terminal/components/SplitView/EmptySlot.tsx`
- Create: `src/features/terminal/components/SplitView/EmptySlot.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/features/terminal/components/SplitView/EmptySlot.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { EmptySlot } from './EmptySlot'

describe('EmptySlot', () => {
  test('renders a button with aria-label "add pane"', () => {
    render(<EmptySlot sessionId="s-test" onAddPane={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: /add pane/i })
    ).toBeInTheDocument()
  })

  test('click fires onAddPane(sessionId)', () => {
    const onAddPane = vi.fn()
    render(<EmptySlot sessionId="s-test" onAddPane={onAddPane} />)
    fireEvent.click(screen.getByRole('button', { name: /add pane/i }))
    expect(onAddPane).toHaveBeenCalledWith('s-test')
  })

  test('click does NOT bubble to ancestor handlers (stopPropagation)', () => {
    const onAddPane = vi.fn()
    const onWrapperClick = vi.fn()
    render(
      <div onClick={onWrapperClick}>
        <EmptySlot sessionId="s-test" onAddPane={onAddPane} />
      </div>
    )
    fireEvent.click(screen.getByRole('button', { name: /add pane/i }))
    expect(onAddPane).toHaveBeenCalledTimes(1)
    expect(onWrapperClick).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest run src/features/terminal/components/SplitView/EmptySlot.test.tsx`
Expected: FAIL — `Cannot find module './EmptySlot'`.

- [ ] **Step 3: Implement `EmptySlot.tsx`**

```tsx
// src/features/terminal/components/SplitView/EmptySlot.tsx
import type { MouseEvent, ReactElement } from 'react'

export interface EmptySlotProps {
  sessionId: string
  onAddPane: (sessionId: string) => void
}

export const EmptySlot = ({
  sessionId,
  onAddPane,
}: EmptySlotProps): ReactElement => {
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    // Stop propagation so the slot-click (`onSetActivePane`, 5c-1)
    // doesn't fire — the empty slot has no pane to activate.
    event.stopPropagation()
    onAddPane(sessionId)
  }

  return (
    <div
      data-testid="empty-slot"
      className="flex h-full w-full items-center justify-center rounded-[10px] border border-dashed border-on-surface/15 bg-surface-container/30"
    >
      <button
        type="button"
        aria-label="add pane"
        onClick={handleClick}
        className="flex flex-col items-center gap-2 rounded-md px-4 py-3 text-on-surface-muted transition-colors hover:bg-on-surface/5 hover:text-on-surface"
      >
        <span className="text-2xl leading-none">+</span>
        <span className="font-mono text-xs uppercase tracking-wider">
          add pane
        </span>
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/features/terminal/components/SplitView/EmptySlot.test.tsx`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/components/SplitView/EmptySlot.tsx src/features/terminal/components/SplitView/EmptySlot.test.tsx
git commit -m "feat(terminal): EmptySlot component (+ click to add pane)"
```

---

## Task 9: `SplitView` — `onAddPane` + `onClosePane` props, EmptySlot mounting, `onClose` pass-through

**Files:**

- Modify: `src/features/terminal/components/SplitView/SplitView.tsx`
- Modify: `src/features/terminal/components/SplitView/SplitView.test.tsx`

- [ ] **Step 1: Add failing tests to `SplitView.test.tsx`**

Append (or merge into existing describe block) in `src/features/terminal/components/SplitView/SplitView.test.tsx`:

```tsx
// New imports if not already present:
import { TerminalPane } from '../TerminalPane'
vi.mock('../TerminalPane', () => ({
  TerminalPane: vi.fn(() => null),
}))

describe('EmptySlot mounting', () => {
  test('single layout never renders EmptySlot', () => {
    render(
      <SplitView
        session={makeSession({ layout: 'single', panes: [makePane('p0')] })}
        service={createMockTerminalService()}
        isActive
        onAddPane={vi.fn()}
      />
    )
    expect(screen.queryAllByTestId('empty-slot')).toHaveLength(0)
  })

  test('vsplit with 1 pane renders 1 EmptySlot', () => {
    render(
      <SplitView
        session={makeSession({ layout: 'vsplit', panes: [makePane('p0')] })}
        service={createMockTerminalService()}
        isActive
        onAddPane={vi.fn()}
      />
    )
    expect(screen.getAllByTestId('empty-slot')).toHaveLength(1)
  })

  test('quad with 2 panes renders 2 EmptySlots', () => {
    render(
      <SplitView
        session={makeSession({
          layout: 'quad',
          panes: [makePane('p0'), makePane('p1', false)],
        })}
        service={createMockTerminalService()}
        isActive
        onAddPane={vi.fn()}
      />
    )
    expect(screen.getAllByTestId('empty-slot')).toHaveLength(2)
  })

  test('onAddPane undefined → no EmptySlot rendered', () => {
    render(
      <SplitView
        session={makeSession({ layout: 'vsplit', panes: [makePane('p0')] })}
        service={createMockTerminalService()}
        isActive
      />
    )
    expect(screen.queryAllByTestId('empty-slot')).toHaveLength(0)
  })

  test('clicking EmptySlot fires onAddPane(session.id)', () => {
    const onAddPane = vi.fn()
    const session = makeSession({
      id: 's-empty',
      layout: 'vsplit',
      panes: [makePane('p0')],
    })
    render(
      <SplitView
        session={session}
        service={createMockTerminalService()}
        isActive
        onAddPane={onAddPane}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add pane/i }))
    expect(onAddPane).toHaveBeenCalledWith('s-empty')
  })
})

describe('onClose pass-through (Decision #4)', () => {
  test('multi-pane session passes onClose to TerminalPane', () => {
    const onClosePane = vi.fn()
    const session = makeSession({
      layout: 'vsplit',
      panes: [makePane('p0', true), makePane('p1', false)],
    })
    render(
      <SplitView
        session={session}
        service={createMockTerminalService()}
        isActive
        onClosePane={onClosePane}
      />
    )
    // Each TerminalPane call receives onClose === onClosePane.
    expect(vi.mocked(TerminalPane).mock.calls[0]?.[0]?.onClose).toBe(
      onClosePane
    )
  })

  test('single-pane session passes onClose === undefined', () => {
    const onClosePane = vi.fn()
    const session = makeSession({ layout: 'single', panes: [makePane('p0')] })
    render(
      <SplitView
        session={session}
        service={createMockTerminalService()}
        isActive
        onClosePane={onClosePane}
      />
    )
    expect(vi.mocked(TerminalPane).mock.calls[0]?.[0]?.onClose).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest run src/features/terminal/components/SplitView/SplitView.test.tsx`
Expected: FAIL — `onAddPane` and `onClosePane` not accepted as props; EmptySlot not rendered.

- [ ] **Step 3: Update `SplitView.tsx`**

Add `EmptySlot` import + extend props + render empty slots + pass `onClose` to TerminalPane.

```tsx
// At the top:
import { EmptySlot } from './EmptySlot'

export interface SplitViewProps {
  session: Session
  service: ITerminalService
  isActive: boolean
  onSessionCwdChange?: (sessionId: string, paneId: string, cwd: string) => void
  onPaneReady?: NotifyPaneReady
  onSessionRestart?: (sessionId: string) => void
  onSetActivePane?: (sessionId: string, paneId: string) => void
  /** NEW in 5c-2: `+ click to add pane` dispatcher. */
  onAddPane?: (sessionId: string) => void
  /** NEW in 5c-2: X-close per-pane dispatcher. */
  onClosePane?: (sessionId: string, paneId: string) => void
  deferTerminalFit?: boolean
}

// Inside the render body, BEFORE the existing return statement:
const emptySlotCount = Math.max(0, layout.capacity - visiblePanes.length)
const emptySlotIndices = Array.from(
  { length: emptySlotCount },
  (_, k) => visiblePanes.length + k
)

// Inside <AnimatePresence initial={false}>, AFTER the visiblePanes.map(...)
// closes, append:
{
  emptySlotIndices.map((slotIdx) =>
    onAddPane ? (
      <motion.div
        key={`empty-${slotIdx}`}
        layout
        layoutId={`empty-${session.id}-${slotIdx}`}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 360, damping: 34 }}
        data-testid="split-view-empty-slot"
        className="relative min-h-0 min-w-0"
        style={{ gridArea: `p${slotIdx}` }}
      >
        <EmptySlot sessionId={session.id} onAddPane={onAddPane} />
      </motion.div>
    ) : null
  )
}

// For each real pane's TerminalPane render, change:
//   <TerminalPane ... />
// to include the onClose prop:
;<TerminalPane
  key={pane.ptyId}
  session={session}
  pane={pane}
  service={service}
  mode={mode}
  onCwdChange={(cwd) => onSessionCwdChange?.(session.id, pane.id, cwd)}
  onClose={session.panes.length > 1 && onClosePane ? onClosePane : undefined}
  onPaneReady={onPaneReady}
  onRestart={onSessionRestart}
  isActive={isActive}
  deferFit={deferTerminalFit}
/>
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/features/terminal/components/SplitView/SplitView.test.tsx`
Expected: PASS (existing 5b + 5c-1 tests + new 7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/components/SplitView/SplitView.tsx src/features/terminal/components/SplitView/SplitView.test.tsx
git commit -m "feat(terminal): SplitView — EmptySlot mounting + onClose pass-through"
```

---

## Task 10: `TerminalZone` — prop threading

**Files:**

- Modify: `src/features/workspace/components/TerminalZone.tsx`
- Modify: `src/features/workspace/components/TerminalZone.test.tsx`

- [ ] **Step 1: Add failing tests for prop threading (behavior-driven, no SplitView mock)**

Append to `src/features/workspace/components/TerminalZone.test.tsx`. **Do NOT introduce a `vi.mock('../../terminal/components/SplitView')` at file scope** — the existing tests rely on the real SplitView render (asserting `split-view`, `split-view-slot`, etc.). The new tests assert prop threading indirectly via observable behavior: SplitView renders `EmptySlot` (with `aria-label="add pane"`) when `onAddPane` is passed, and `TerminalPane` renders the X-close button (with `aria-label="close pane"`) when `onClosePane` is passed for a multi-pane session.

```tsx
import { userEvent } from '@testing-library/user-event'

test('threads addPane: clicking the EmptySlot fires the manager mutation', async () => {
  const addPane = vi.fn()
  const removePane = vi.fn()
  render(
    <TerminalZone
      sessions={[
        makeSession({
          id: 's0',
          layout: 'vsplit',
          panes: [makePane({ id: 'p0', active: true })],
        }),
      ]}
      activeSessionId="s0"
      service={createMockTerminalService()}
      loading={false}
      setActiveSessionId={vi.fn()}
      setSessionLayout={vi.fn()}
      setSessionActivePane={vi.fn()}
      restartSession={vi.fn()}
      addPane={addPane}
      removePane={removePane}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: /add pane/i }))
  expect(addPane).toHaveBeenCalledWith('s0')
  expect(removePane).not.toHaveBeenCalled()
})

test('threads removePane: clicking a pane X fires the manager mutation', async () => {
  const addPane = vi.fn()
  const removePane = vi.fn()
  render(
    <TerminalZone
      sessions={[
        makeSession({
          id: 's0',
          layout: 'vsplit',
          panes: [
            makePane({ id: 'p0', active: true }),
            makePane({ id: 'p1', active: false }),
          ],
        }),
      ]}
      activeSessionId="s0"
      service={createMockTerminalService()}
      loading={false}
      setActiveSessionId={vi.fn()}
      setSessionLayout={vi.fn()}
      setSessionActivePane={vi.fn()}
      restartSession={vi.fn()}
      addPane={addPane}
      removePane={removePane}
    />
  )
  const closeButtons = screen.getAllByRole('button', { name: /close pane/i })
  expect(closeButtons.length).toBeGreaterThanOrEqual(1)
  await userEvent.click(closeButtons[0])
  expect(removePane).toHaveBeenCalledWith('s0', 'p0')
})
```

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest run src/features/workspace/components/TerminalZone.test.tsx -t "threads"`
Expected: FAIL — `TerminalZone` doesn't accept `addPane` / `removePane` props yet (TypeScript error).

- [ ] **Step 3: Update `TerminalZone.tsx`**

```tsx
// Extend the props interface:
export interface TerminalZoneProps {
  // ... existing fields ...
  addPane: (sessionId: string) => void
  removePane: (sessionId: string, paneId: string) => void
}

// In the function signature, destructure both new props.
// In the SplitView render, add the two props:
;<SplitView
  // ... existing props ...
  onAddPane={addPane}
  onClosePane={removePane}
/>
```

- [ ] **Step 3.5: Sweep existing `<TerminalZone />` renders in the test file**

`addPane` and `removePane` are now REQUIRED in `TerminalZoneProps`. Find every other `<TerminalZone ... />` render in `TerminalZone.test.tsx` and add `addPane={vi.fn()} removePane={vi.fn()}` to each, otherwise the existing tests will fail TypeScript.

Run: `npm run type-check`
Expected: No errors. Address each "missing property 'addPane'/'removePane'" complaint by adding the stub props.

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/features/workspace/components/TerminalZone.test.tsx`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/features/workspace/components/TerminalZone.tsx src/features/workspace/components/TerminalZone.test.tsx
git commit -m "feat(workspace): TerminalZone threads addPane / removePane to SplitView"
```

---

## Task 11: `WorkspaceView` — wire manager mutations to `TerminalZone`

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/WorkspaceView.test.tsx`

- [ ] **Step 1: Add failing test for the new prop wiring**

Append to `src/features/workspace/WorkspaceView.test.tsx`:

```tsx
test('passes addPane and removePane from useSessionManager to TerminalZone', () => {
  const addPane = vi.fn()
  const removePane = vi.fn()
  vi.mocked(useSessionManager).mockReturnValue(
    makeMockSessionManager({ addPane, removePane })
  )

  render(<WorkspaceView />)

  const props = vi.mocked(TerminalZone).mock.calls[0]?.[0]
  expect(props?.addPane).toBe(addPane)
  expect(props?.removePane).toBe(removePane)
})
```

Update the local `makeMockSessionManager` test helper to default-stub the two new fields if not already present:

```tsx
const makeMockSessionManager = (
  overrides: Partial<SessionManager> = {}
): SessionManager => ({
  // ... existing fields (sessions, activeSessionId, createSession, removeSession,
  //     setSessionLayout, setSessionActivePane, restartSession, ...) ...
  addPane: vi.fn(),
  removePane: vi.fn(),
  ...overrides,
})
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run src/features/workspace/WorkspaceView.test.tsx -t "addPane and removePane"`
Expected: FAIL — `WorkspaceView` doesn't pass `addPane`/`removePane` yet.

- [ ] **Step 3: Update `WorkspaceView.tsx`**

```tsx
// In the body, extend the destructure from useSessionManager:
const {
  sessions,
  activeSessionId,
  // ... existing ...
  setSessionLayout,
  setSessionActivePane,
  addPane,
  removePane,
  restartSession,
} = useSessionManager(service)

// In the TerminalZone render, add the new props:
<TerminalZone
  // ... existing props ...
  addPane={addPane}
  removePane={removePane}
/>
```

- [ ] **Step 3.5: Sweep other SessionManager-typed mocks**

Other test files type a `SessionManager` fixture and will fail TypeScript when `addPane` / `removePane` become required fields on the manager interface. Sweep these files and add `addPane: vi.fn(), removePane: vi.fn()` (or destructure-spread an existing helper that does) to each `SessionManager` mock:

- `src/features/workspace/WorkspaceView.command-palette.test.tsx`
- `src/features/workspace/WorkspaceView.integration.test.tsx`

Confirm there are no more by running:

```bash
grep -rln "SessionManager\|useSessionManager" src --include='*.test.tsx' --include='*.test.ts'
```

For each result, open the file and search for object literals typed as `SessionManager` (or returned from `vi.mocked(useSessionManager).mockReturnValue(...)`). Add the two stubs.

Then run type-check across the whole repo:

Run: `npm run type-check`
Expected: No errors.

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run src/features/workspace/WorkspaceView.test.tsx`
Expected: PASS.

Also run the broader workspace test bucket and the full Vitest suite to catch any other consumer mocks that need the new fields:

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/workspace/WorkspaceView.tsx src/features/workspace/WorkspaceView.test.tsx src/features/workspace/WorkspaceView.command-palette.test.tsx src/features/workspace/WorkspaceView.integration.test.tsx
git commit -m "feat(workspace): WorkspaceView wires addPane / removePane to TerminalZone"
```

---

## Task 12: `progress.yaml` status flip (at PR open)

**Files:**

- Modify: `docs/roadmap/progress.yaml`

- [ ] **Step 1: Update `ui-s5c-2` status to `in_progress`**

Find the existing `ui-s5c-2` entry in the `ui-handoff-migration` phase. Update:

```yaml
- id: ui-s5c-2
  name: 'addPane / removePane / placeholder spawn / X-close / auto-shrink'
  status: in_progress
  notes: 'Pane lifecycle mutations + "+ click to add pane" placeholder in empty slots + X-close on per-pane chrome + auto-shrink layout on close. Spec: docs/superpowers/specs/2026-05-12-step-5c-2-pane-lifecycle-design.md. Plan: docs/superpowers/plans/2026-05-12-step-5c-2-pane-lifecycle.md.'
```

Also update the phase-level `notes` block to call out 5d as the next active step once 5c-2 lands.

- [ ] **Step 2: Sanity-check the YAML parses**

Run: `npx js-yaml docs/roadmap/progress.yaml > /dev/null && echo OK`
Expected: `OK` (no parse errors).

If `js-yaml` isn't available, `python3 -c "import yaml; yaml.safe_load(open('docs/roadmap/progress.yaml'))" && echo OK` works too.

- [ ] **Step 3: Commit**

```bash
git add docs/roadmap/progress.yaml
git commit -m "chore(roadmap): mark ui-s5c-2 in_progress"
```

After merge, follow up with a `status: done` flip in a separate commit on the merge SHA.

---

## Final Verification

- [ ] **Run the full test suite**

Run: `npm run test`
Expected: PASS — all 1100+ tests green, including ~40 new cases added by 5c-2.

- [ ] **Run lint + type-check**

Run: `npm run lint && npm run type-check`
Expected: No errors.

- [ ] **Manual smoke (Tauri dev)**

Run: `npm run tauri:dev`
Verify:

1. Open a session → click LayoutSwitcher `vsplit` → one real pane + one EmptySlot with `+`.
2. Click `+` → a second pane mounts with a fresh shell prompt in the same `cwd`.
3. Hover the new pane's header → X button visible. Click → pane closes, layout auto-shrinks to `single`.
4. Pick `quad` → 1 real pane + 3 EmptySlots. Click each `+` in sequence; new panes mount.
5. Close one of 4 → layout shrinks to `threeRight`; remaining 3 panes flow into the asymmetric grid.
6. ⌘1/⌘2/⌘3 cycle focus between panes; ring + xterm cursor follow.
7. Tab-strip X on a multi-pane session → entire session removed (all PTYs killed, no orphans).
8. Click `+` twice quickly in an empty slot → only one new pane mounts; `console.warn('another pane op in flight')` in DevTools.

- [ ] **Open the PR**

```bash
git push -u origin <branch>
gh pr create --title "feat(terminal): step 5c-2 — pane lifecycle (addPane / removePane / placeholder / X-close / auto-shrink)" --body "$(cat <<'EOF'
## Summary

- New `paneLifecycle.ts` reducers (`applyAddPane` / `applyRemovePane`) + helpers.
- `useSessionManager` gains `addPane` / `removePane`; `setSessionActivePane` now syncs Rust's active PTY.
- `EmptySlot` placeholder in empty grid tracks; X-close on multi-pane chrome; auto-shrink on close.
- First multi-pane production state. Closes 5c-1 Decision #10's deferred Rust active-pane sync.

## Spec + plan

- Spec: docs/superpowers/specs/2026-05-12-step-5c-2-pane-lifecycle-design.md
- Plan: docs/superpowers/plans/2026-05-12-step-5c-2-pane-lifecycle.md

## Test plan

- [ ] `npm run test` passes (~1140 tests; +40 new)
- [ ] `npm run lint && npm run type-check` clean
- [ ] Manual smoke: vsplit + `+` → 2 panes; quad + 4× `+` → 4 panes; close 1 of 4 → threeRight; ⌘1-4 focus rotation fires Rust setActiveSession (verify via Rust trace logs).
- [ ] Concurrent double-click `+` → only one pane added; console.warn fires for the second click.
- [ ] Concurrent close-two-panes in a 2-pane session → only one X actually closes; second click warns.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

After merge, follow up with:

- `progress.yaml` ui-s5c-2 status → `done` with commit + PR id.
- Smoke-test the framer-motion exit animation overlap (Risk in §4 of the spec). If perceptibly bad, tighten `exit.transition.duration` to ~150ms.
- Watch for the LAYOUT_CYCLE capacity-filter follow-up (5c-1 risk carry-over, now more impactful with multi-pane).

<!-- codex-reviewed: 2026-05-13T03:43:19Z -->
