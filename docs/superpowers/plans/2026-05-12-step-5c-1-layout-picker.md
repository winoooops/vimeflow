# Step 5c-1 — Layout Picker + Focus Controls (Passive, Animated) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a passive `LayoutSwitcher` UI + click-to-focus + Ctrl/Cmd+1-4 / Ctrl/Cmd+\ keyboard shortcuts + Framer Motion shared-layout animations for the per-session SplitView grid. Pane count per session stays hardcoded at 1; the picker, focus controls, and motion infrastructure land now, the addPane/removePane lifecycle ships in 5c-2.

**Architecture:** Two new manager mutations (`setSessionLayout`, `setSessionActivePane`) on `useSessionManager` drive the focus + layout state. A new `LayoutSwitcher` component + `usePaneShortcuts` hook surface them in the UI. SplitView wraps its grid in `<LayoutGroup id={session.id}>` + `<motion.div layout>` (grid container) + `<motion.div layout layoutId={pane.id}>` (per slot) + `<AnimatePresence initial={false}>` so layout changes animate smoothly. TerminalPane gains a rising-edge effect that calls `bodyRef.current?.focusTerminal()` whenever `pane.active` flips `false → true`, coupling visual ring and keyboard cursor in one user action.

**Tech Stack:** TypeScript, React 19, Tailwind CSS, Vitest + @testing-library/react, framer-motion v12.38, xterm.js. **No new dependencies** — `clsx` is NOT in the repo; conditional classes use template-literal interpolation throughout.

**Spec:** `docs/superpowers/specs/2026-05-12-step-5c-1-layout-picker-design.md`

---

## File Structure

**New (7 files):**

- `src/features/terminal/components/LayoutSwitcher/LayoutGlyph.tsx` — pure SVG glyph component
- `src/features/terminal/components/LayoutSwitcher/LayoutGlyph.test.tsx`
- `src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.tsx` — 5-button picker
- `src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.test.tsx`
- `src/features/terminal/components/LayoutSwitcher/index.ts` — barrel
- `src/features/terminal/hooks/usePaneShortcuts.ts` — capture-phase keydown listener
- `src/features/terminal/hooks/usePaneShortcuts.test.ts`

**Modified (10 files):**

- `src/features/sessions/hooks/useSessionManager.ts` — add `setSessionActivePane` + `setSessionLayout`
- `src/features/sessions/hooks/useSessionManager.test.ts` — tests for the two new mutations
- `src/features/terminal/components/SplitView/SplitView.tsx` — `LayoutGroup` + `motion.div` + `onSetActivePane` prop
- `src/features/terminal/components/SplitView/SplitView.test.tsx` — click-to-focus + omitted-handler tests
- `src/features/terminal/components/TerminalPane/index.tsx` — rising-edge focus effect (Decision #11); refresh stale `handleContainerClick` comment
- `src/features/terminal/components/TerminalPane/index.test.tsx` — effect rising-edge tests
- `src/features/workspace/WorkspaceView.tsx` — destructure new mutations + call `usePaneShortcuts` + plumb to `TerminalZone`
- `src/features/workspace/WorkspaceView.test.tsx` — assert `usePaneShortcuts` receives expected handlers
- `src/features/workspace/components/TerminalZone.tsx` — toolbar with LayoutSwitcher + hint label
- `src/features/workspace/components/TerminalZone.test.tsx` — toolbar mount + click + glyph-platform tests
- `docs/roadmap/progress.yaml` — split `ui-s5c` → `ui-s5c-1` + `ui-s5c-2`

---

## Task 1: `LayoutGlyph` — pure SVG component (5 layouts)

**Files:**

- Create: `src/features/terminal/components/LayoutSwitcher/LayoutGlyph.tsx`
- Test: `src/features/terminal/components/LayoutSwitcher/LayoutGlyph.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/features/terminal/components/LayoutSwitcher/LayoutGlyph.test.tsx
import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { LayoutGlyph } from './LayoutGlyph'
import type { LayoutId } from '../../../sessions/types'

const lineCount = (svg: SVGElement): number =>
  svg.querySelectorAll('line').length

const cases: ReadonlyArray<readonly [LayoutId, number]> = [
  ['single', 0],
  ['vsplit', 1],
  ['hsplit', 1],
  ['threeRight', 2],
  ['quad', 2],
]

describe('LayoutGlyph', () => {
  test.each(cases)(
    'renders %s with %i line separators',
    (layoutId, expectedLines) => {
      const { container } = render(<LayoutGlyph layoutId={layoutId} />)
      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(lineCount(svg as SVGElement)).toBe(expectedLines)
      // Frame rect is always present.
      expect(svg!.querySelectorAll('rect')).toHaveLength(1)
    }
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/terminal/components/LayoutSwitcher/LayoutGlyph.test.tsx`
Expected: FAIL with "Cannot find module './LayoutGlyph'" (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```tsx
// src/features/terminal/components/LayoutSwitcher/LayoutGlyph.tsx
import type { ReactElement } from 'react'
import type { LayoutId } from '../../../sessions/types'

export interface LayoutGlyphProps {
  layoutId: LayoutId
}

export const LayoutGlyph = ({ layoutId }: LayoutGlyphProps): ReactElement => {
  const sw = 1.4
  const r = 1.4
  const frame = (
    <rect
      x="1"
      y="1"
      width="12"
      height="9"
      rx={r}
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )
  const v = (
    <line
      x1="7"
      y1="1.5"
      x2="7"
      y2="9.5"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )
  const h = (
    <line
      x1="1.5"
      y1="5.5"
      x2="12.5"
      y2="5.5"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )
  const threeR1 = (
    <line
      x1="8"
      y1="1.5"
      x2="8"
      y2="9.5"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )
  const threeR2 = (
    <line
      x1="8"
      y1="5.5"
      x2="12.5"
      y2="5.5"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )

  return (
    <svg width="14" height="11" viewBox="0 0 14 11">
      {frame}
      {layoutId === 'vsplit' && v}
      {layoutId === 'hsplit' && h}
      {layoutId === 'threeRight' && (
        <>
          {threeR1}
          {threeR2}
        </>
      )}
      {layoutId === 'quad' && (
        <>
          {v}
          {h}
        </>
      )}
    </svg>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/terminal/components/LayoutSwitcher/LayoutGlyph.test.tsx`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/components/LayoutSwitcher/LayoutGlyph.tsx src/features/terminal/components/LayoutSwitcher/LayoutGlyph.test.tsx
git commit -m "feat(terminal): add LayoutGlyph SVG component (5c-1 task 1)"
```

---

## Task 2: `LayoutSwitcher` — 5-button picker

**Files:**

- Create: `src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.tsx`
- Create: `src/features/terminal/components/LayoutSwitcher/index.ts`
- Test: `src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { LayoutSwitcher } from './LayoutSwitcher'

describe('LayoutSwitcher', () => {
  test('renders 5 buttons (one per LayoutId)', () => {
    render(<LayoutSwitcher activeLayoutId="single" onPick={vi.fn()} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(5)
  })

  test('marks the active button with data-active', () => {
    render(<LayoutSwitcher activeLayoutId="vsplit" onPick={vi.fn()} />)
    const active = screen.getByTitle('Vertical split')
    expect(active).toHaveAttribute('data-active', 'true')
    const inactive = screen.getByTitle('Single')
    expect(inactive).not.toHaveAttribute('data-active')
  })

  test('clicking a non-active button fires onPick with its id', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<LayoutSwitcher activeLayoutId="single" onPick={onPick} />)
    await user.click(screen.getByTitle('Quad'))
    expect(onPick).toHaveBeenCalledOnce()
    expect(onPick).toHaveBeenCalledWith('quad')
  })

  test('exposes role="toolbar" with an aria-label', () => {
    render(<LayoutSwitcher activeLayoutId="single" onPick={vi.fn()} />)
    expect(screen.getByRole('toolbar')).toHaveAccessibleName('Pane layout')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.test.tsx`
Expected: FAIL with "Cannot find module './LayoutSwitcher'".

- [ ] **Step 3: Write the implementation**

```tsx
// src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.tsx
// NOTE: vimeflow does NOT depend on `clsx` (confirmed: not in
// package.json, not in node_modules). Use template-literal class
// merging instead — keeps 5c-1 dependency-free.
import type { ReactElement } from 'react'
import type { LayoutId } from '../../../sessions/types'
import { LAYOUTS } from '../SplitView'
import { LayoutGlyph } from './LayoutGlyph'

export interface LayoutSwitcherProps {
  activeLayoutId: LayoutId
  onPick: (next: LayoutId) => void
}

const BASE_BTN = 'inline-flex h-5 w-6 items-center justify-center rounded'
const ACTIVE_BTN = 'bg-primary/15 text-primary ring-1 ring-primary/45'
const INACTIVE_BTN = 'text-on-surface-muted hover:text-on-surface'

export const LayoutSwitcher = ({
  activeLayoutId,
  onPick,
}: LayoutSwitcherProps): ReactElement => (
  <div
    data-testid="layout-switcher"
    role="toolbar"
    aria-label="Pane layout"
    className="inline-flex items-center gap-0.5 rounded-md bg-surface-container/60 p-0.5"
  >
    {Object.values(LAYOUTS).map((L) => {
      const isActive = activeLayoutId === L.id
      return (
        <button
          key={L.id}
          type="button"
          title={L.name}
          data-active={isActive ? 'true' : undefined}
          onClick={() => onPick(L.id)}
          className={`${BASE_BTN} ${isActive ? ACTIVE_BTN : INACTIVE_BTN}`}
        >
          <LayoutGlyph layoutId={L.id} />
        </button>
      )
    })}
  </div>
)
```

```ts
// src/features/terminal/components/LayoutSwitcher/index.ts
export { LayoutSwitcher, type LayoutSwitcherProps } from './LayoutSwitcher'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.test.tsx`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.tsx src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.test.tsx src/features/terminal/components/LayoutSwitcher/index.ts
git commit -m "feat(terminal): add LayoutSwitcher picker (5c-1 task 2)"
```

---

## Task 3: `setSessionLayout` manager mutation

**Files:**

- Modify: `src/features/sessions/hooks/useSessionManager.ts` — add interface method + implementation
- Test: `src/features/sessions/hooks/useSessionManager.test.ts` — new `describe('setSessionLayout', ...)`

- [ ] **Step 1: Write the failing tests**

Append to `src/features/sessions/hooks/useSessionManager.test.ts`:

```tsx
import { renderHook, act } from '@testing-library/react'
// (assume existing imports for buildMockService, fixture helpers — already in the file)

describe('setSessionLayout', () => {
  test('updates session.layout when target session exists and layout differs', () => {
    const service = buildMockService()
    const { result } = renderHook(() => useSessionManager(service))
    // Seed a session via createSession; await spawn.
    // (Reuse existing test helper that awaits manager seed — pattern from existing tests.)
    act(() => result.current.createSession())
    return waitForSeed(result).then(() => {
      const sessionId = result.current.sessions[0].id
      act(() => result.current.setSessionLayout(sessionId, 'vsplit'))
      expect(result.current.sessions[0].layout).toBe('vsplit')
    })
  })

  test('returns same sessions array reference when layout is unchanged', async () => {
    const service = buildMockService()
    const { result } = renderHook(() => useSessionManager(service))
    act(() => result.current.createSession())
    await waitForSeed(result)
    const sessionId = result.current.sessions[0].id
    const before = result.current.sessions
    // Same layout = no-op; setSessions returns prev unchanged.
    act(() => result.current.setSessionLayout(sessionId, before[0].layout))
    expect(result.current.sessions).toBe(before)
  })

  test('warns and no-ops when sessionId is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = buildMockService()
    const { result } = renderHook(() => useSessionManager(service))
    const before = result.current.sessions
    act(() => result.current.setSessionLayout('does-not-exist', 'vsplit'))
    expect(result.current.sessions).toBe(before)
    expect(warn).toHaveBeenCalledWith(
      'setSessionLayout: no session does-not-exist'
    )
    warn.mockRestore()
  })
})
```

(If `waitForSeed` / `buildMockService` helpers don't exist in the test file, write them inline at the top of the test using the same pattern as the existing tests for `createSession` — they pre-exist post-5a.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/sessions/hooks/useSessionManager.test.ts -t setSessionLayout`
Expected: FAIL — `result.current.setSessionLayout` is undefined.

- [ ] **Step 3: Write the implementation**

In `src/features/sessions/hooks/useSessionManager.ts`:

1. Add to the `SessionManager` interface (around line 50-60, alongside the other mutations):

```ts
  setSessionLayout: (sessionId: string, layoutId: LayoutId) => void
```

2. Add the import for `LayoutId` if not already present:

```ts
import type { LayoutId, Pane, Session } from '../types'
```

3. Inside the `useSessionManager` body (after `removeSession`, before the `return` block):

```ts
const setSessionLayout = useCallback(
  (sessionId: string, layoutId: LayoutId): void => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === sessionId)
      if (idx === -1) {
        // eslint-disable-next-line no-console
        console.warn(`setSessionLayout: no session ${sessionId}`)
        return prev
      }
      const session = prev[idx]
      if (session.layout === layoutId) return prev
      const newSession: Session = { ...session, layout: layoutId }
      return [...prev.slice(0, idx), newSession, ...prev.slice(idx + 1)]
    })
  },
  []
)
```

4. Add `setSessionLayout` to the returned `SessionManager` object:

```ts
return {
  // ...existing fields...
  setSessionLayout,
  // ...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/sessions/hooks/useSessionManager.test.ts -t setSessionLayout`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/sessions/hooks/useSessionManager.ts src/features/sessions/hooks/useSessionManager.test.ts
git commit -m "feat(sessions): add setSessionLayout manager mutation (5c-1 task 3)"
```

---

## Task 4: `setSessionActivePane` — pure helper + manager mutation

**Why a pure helper:** `useSessionManager` exposes no test seam for seeding a multi-pane Session (the `addPane` lifecycle ships in 5c-2). To make the flip + materialized-field re-derivation testable with multi-pane fixtures TODAY, we factor the mutation logic into a pure helper `applyActivePane(sessions, sessionId, paneId): Session[]` that the manager calls inside its `setSessions` updater. The helper takes plain `Session[]` fixtures so multi-pane assertions don't need a manager seam.

**Files:**

- Modify: `src/features/sessions/utils/activeSessionPane.ts` — add `applyActivePane`
- Modify: `src/features/sessions/utils/activeSessionPane.test.ts` — multi-pane tests
- Modify: `src/features/sessions/hooks/useSessionManager.ts` — `setSessionActivePane` wraps `applyActivePane`
- Modify: `src/features/sessions/hooks/useSessionManager.test.ts` — integration coverage of the no-op paths only

- [ ] **Step 1: Write the failing helper tests**

Append to `src/features/sessions/utils/activeSessionPane.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'
import { applyActivePane } from './activeSessionPane'
import { emptyActivity } from '../constants'
import type { Pane, Session } from '../types'

const makePane = (id: string, overrides: Partial<Pane> = {}): Pane => ({
  id,
  ptyId: `pty-${id}`,
  cwd: `/tmp/${id}`,
  agentType: 'generic',
  status: 'running',
  active: false,
  ...overrides,
})

const makeSession = (
  id: string,
  panes: Pane[],
  layout: Session['layout'] = 'vsplit'
): Session => ({
  id,
  projectId: 'proj-1',
  name: id,
  status: 'running',
  workingDirectory: panes.find((p) => p.active)?.cwd ?? panes[0].cwd,
  agentType: panes.find((p) => p.active)?.agentType ?? panes[0].agentType,
  layout,
  panes,
  createdAt: '2026-05-12T00:00:00Z',
  lastActivityAt: '2026-05-12T00:00:00Z',
  activity: { ...emptyActivity },
})

describe('applyActivePane', () => {
  test('flips active flag and re-derives workingDirectory + agentType', () => {
    const sessions: Session[] = [
      makeSession('s1', [
        makePane('p0', {
          active: true,
          cwd: '/tmp/p0',
          agentType: 'claude-code',
        }),
        makePane('p1', { active: false, cwd: '/tmp/p1', agentType: 'codex' }),
      ]),
    ]
    const next = applyActivePane(sessions, 's1', 'p1')
    const updated = next[0]
    expect(updated.panes.filter((p) => p.active)).toHaveLength(1)
    expect(updated.panes.find((p) => p.id === 'p1')?.active).toBe(true)
    expect(updated.panes.find((p) => p.id === 'p0')?.active).toBe(false)
    expect(updated.workingDirectory).toBe('/tmp/p1')
    expect(updated.agentType).toBe('codex')
  })

  test('returns the same array reference when target is already active', () => {
    const sessions: Session[] = [
      makeSession('s1', [makePane('p0', { active: true })]),
    ]
    const next = applyActivePane(sessions, 's1', 'p0')
    expect(next).toBe(sessions)
  })

  test('warns and returns same reference when sessionId is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sessions: Session[] = [
      makeSession('s1', [makePane('p0', { active: true })]),
    ]
    const next = applyActivePane(sessions, 'nope', 'p0')
    expect(next).toBe(sessions)
    expect(warn).toHaveBeenCalledWith('applyActivePane: no session nope')
    warn.mockRestore()
  })

  test('warns and returns same reference when paneId is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sessions: Session[] = [
      makeSession('s1', [makePane('p0', { active: true })]),
    ]
    const next = applyActivePane(sessions, 's1', 'p-fake')
    expect(next).toBe(sessions)
    expect(warn).toHaveBeenCalledWith(
      'applyActivePane: no pane p-fake in session s1'
    )
    warn.mockRestore()
  })

  test('preserves identity of unaffected sessions', () => {
    const sessions: Session[] = [
      makeSession('s1', [
        makePane('p0', { active: true }),
        makePane('p1', { active: false }),
      ]),
      makeSession('s2', [makePane('p0', { active: true })]),
    ]
    const next = applyActivePane(sessions, 's1', 'p1')
    expect(next[1]).toBe(sessions[1]) // s2 unchanged → same reference
    expect(next[0]).not.toBe(sessions[0]) // s1 mutated → new reference
  })
})
```

- [ ] **Step 2: Run helper test to verify it fails**

Run: `npx vitest run src/features/sessions/utils/activeSessionPane.test.ts -t "applyActivePane"`
Expected: FAIL — `applyActivePane` not exported.

- [ ] **Step 3: Write the helper**

Append to `src/features/sessions/utils/activeSessionPane.ts`:

```ts
/** Pure helper that flips `pane.active` to true for the named pane in the
 *  named session, sets every other pane in that session to active=false,
 *  and re-materializes `Session.workingDirectory` + `Session.agentType`
 *  from the new active pane (5a Decision #9 contract).
 *
 *  Returns the SAME `sessions` reference on no-op branches (missing
 *  sessionId, missing paneId, already-active target). On the mutating
 *  branch, only the affected session gets a new reference; siblings
 *  preserve identity so React's `setSessions((prev) => helper(prev, …))`
 *  call doesn't trigger spurious re-renders on unrelated panels.
 */
export const applyActivePane = (
  sessions: Session[],
  sessionId: string,
  paneId: string
): Session[] => {
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1) {
    // eslint-disable-next-line no-console
    console.warn(`applyActivePane: no session ${sessionId}`)
    return sessions
  }
  const session = sessions[idx]
  const target = session.panes.find((p) => p.id === paneId)
  if (!target) {
    // eslint-disable-next-line no-console
    console.warn(`applyActivePane: no pane ${paneId} in session ${sessionId}`)
    return sessions
  }
  if (target.active) return sessions

  const newPanes = session.panes.map((p) => ({
    ...p,
    active: p.id === paneId,
  }))
  const newSession: Session = {
    ...session,
    panes: newPanes,
    workingDirectory: target.cwd,
    agentType: target.agentType,
  }
  return [...sessions.slice(0, idx), newSession, ...sessions.slice(idx + 1)]
}
```

- [ ] **Step 4: Run helper test to verify it passes**

Run: `npx vitest run src/features/sessions/utils/activeSessionPane.test.ts -t "applyActivePane"`
Expected: 5 tests PASS.

- [ ] **Step 5: Add manager mutation that wraps the helper**

In `src/features/sessions/hooks/useSessionManager.ts`:

1. Import the helper:

```ts
import {
  applyActivePane,
  findActivePane,
  getActivePane,
} from '../utils/activeSessionPane'
```

2. Extend `SessionManager` interface:

```ts
  setSessionActivePane: (sessionId: string, paneId: string) => void
```

3. Inside the hook body (after `setSessionLayout`):

```ts
const setSessionActivePane = useCallback(
  (sessionId: string, paneId: string): void => {
    setSessions((prev) => applyActivePane(prev, sessionId, paneId))
  },
  []
)
```

4. Expose in the returned object:

```ts
return {
  // ...existing fields...
  setSessionActivePane,
  setSessionLayout,
  // ...
}
```

- [ ] **Step 6: Write integration tests for the manager wrapper (no-op paths only)**

Append to `useSessionManager.test.ts`:

```tsx
describe('setSessionActivePane (manager integration)', () => {
  // Multi-pane fixtures are tested in activeSessionPane.test.ts.
  // Manager-level tests only verify the wrapper plumbing: missing-id
  // is a no-op, already-active is a no-op, single-pane stays stable.

  test('returns same sessions reference when target pane is already active', async () => {
    const service = buildMockService()
    const { result } = renderHook(() => useSessionManager(service))
    act(() => result.current.createSession())
    await waitForSeed(result)
    const sessionId = result.current.sessions[0].id
    const before = result.current.sessions
    act(() => result.current.setSessionActivePane(sessionId, 'p0'))
    expect(result.current.sessions).toBe(before)
  })

  test('warns when sessionId is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = buildMockService()
    const { result } = renderHook(() => useSessionManager(service))
    act(() => result.current.setSessionActivePane('no-such-session', 'p0'))
    expect(warn).toHaveBeenCalledWith(
      'applyActivePane: no session no-such-session'
    )
    warn.mockRestore()
  })
})
```

(`buildMockService` / `waitForSeed` are the existing helpers used by the existing `createSession` tests in `useSessionManager.test.ts`. If the file's top-level imports / helpers don't include them, copy the pattern from one of the existing tests in the same file — they're defined inline at the top, post-5a.)

- [ ] **Step 7: Run manager integration tests to verify they pass**

Run: `npx vitest run src/features/sessions/hooks/useSessionManager.test.ts -t "setSessionActivePane (manager integration)"`
Expected: 2 tests PASS.

- [ ] **Step 8: Commit (helper + manager wrapper together)**

```bash
git add \
  src/features/sessions/utils/activeSessionPane.ts \
  src/features/sessions/utils/activeSessionPane.test.ts \
  src/features/sessions/hooks/useSessionManager.ts \
  src/features/sessions/hooks/useSessionManager.test.ts
git commit -m "feat(sessions): applyActivePane helper + setSessionActivePane mutation (5c-1 task 4)"
```

---

## Task 5: `usePaneShortcuts` hook

**Files:**

- Create: `src/features/terminal/hooks/usePaneShortcuts.ts`
- Test: `src/features/terminal/hooks/usePaneShortcuts.test.ts`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/features/terminal/hooks/usePaneShortcuts.test.ts
import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { usePaneShortcuts } from './usePaneShortcuts'
import { emptyActivity } from '../../sessions/constants'
import type { LayoutId, Session } from '../../sessions/types'

const makeSession = (
  id: string,
  layout: LayoutId,
  paneIds: string[],
  activeIdx = 0
): Session => ({
  id,
  projectId: 'p-1',
  name: id,
  status: 'running',
  workingDirectory: '/tmp',
  agentType: 'generic',
  layout,
  panes: paneIds.map((pid, i) => ({
    id: pid,
    ptyId: `pty-${pid}`,
    cwd: '/tmp',
    agentType: 'generic',
    status: 'running',
    active: i === activeIdx,
  })),
  createdAt: '2026-05-12T00:00:00Z',
  lastActivityAt: '2026-05-12T00:00:00Z',
  // Re-uses the canonical `emptyActivity` constant exported from
  // `src/features/sessions/constants.ts` — the AgentActivity shape
  // (fileChanges / toolCalls / testResults / contextWindow / usage)
  // is the source of truth and must NOT be inlined incorrectly here.
  activity: { ...emptyActivity },
})

const fire = (
  key: string,
  modifiers: Partial<KeyboardEventInit> = {}
): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  })
  const preventDefault = vi.spyOn(event, 'preventDefault')
  document.dispatchEvent(event)
  return Object.assign(event, { __pd: preventDefault })
}

describe('usePaneShortcuts', () => {
  test('Cmd+\\ from single cycles to vsplit (and preventDefault fires)', () => {
    const setSessionActivePane = vi.fn()
    const setSessionLayout = vi.fn()
    const sessions = [makeSession('s1', 'single', ['p0'])]
    renderHook(() =>
      usePaneShortcuts({
        sessions,
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout,
      })
    )
    const event = fire('\\', { metaKey: true })
    expect(setSessionLayout).toHaveBeenCalledOnce()
    expect(setSessionLayout).toHaveBeenCalledWith('s1', 'vsplit')
    expect(
      (event as KeyboardEvent & { __pd: ReturnType<typeof vi.spyOn> }).__pd
    ).toHaveBeenCalled()
  })

  test('Cmd+\\ from quad wraps to single', () => {
    const setSessionLayout = vi.fn()
    const sessions = [makeSession('s1', 'quad', ['p0'])]
    renderHook(() =>
      usePaneShortcuts({
        sessions,
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout,
      })
    )
    fire('\\', { ctrlKey: true })
    expect(setSessionLayout).toHaveBeenCalledOnce()
    expect(setSessionLayout).toHaveBeenCalledWith('s1', 'single')
  })

  test('Cmd+2 with only one pane is a no-op BUT preventDefault still fires', () => {
    const setSessionActivePane = vi.fn()
    const sessions = [makeSession('s1', 'single', ['p0'])]
    renderHook(() =>
      usePaneShortcuts({
        sessions,
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )
    const event = fire('2', { metaKey: true })
    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(
      (event as KeyboardEvent & { __pd: ReturnType<typeof vi.spyOn> }).__pd
    ).toHaveBeenCalled()
  })

  test('Ctrl+Alt+1 is rejected (Alt is excluded); preventDefault NOT called', () => {
    const setSessionActivePane = vi.fn()
    const sessions = [makeSession('s1', 'vsplit', ['p0', 'p1'])]
    renderHook(() =>
      usePaneShortcuts({
        sessions,
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )
    const event = fire('1', { ctrlKey: true, altKey: true })
    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(
      (event as KeyboardEvent & { __pd: ReturnType<typeof vi.spyOn> }).__pd
    ).not.toHaveBeenCalled()
  })

  test('no modifier → no-op, no preventDefault', () => {
    const setSessionActivePane = vi.fn()
    const sessions = [makeSession('s1', 'vsplit', ['p0', 'p1'])]
    renderHook(() =>
      usePaneShortcuts({
        sessions,
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )
    const event = fire('2')
    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(
      (event as KeyboardEvent & { __pd: ReturnType<typeof vi.spyOn> }).__pd
    ).not.toHaveBeenCalled()
  })

  test('activeSessionId=null → no-op', () => {
    const setSessionLayout = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: null,
        setSessionActivePane: vi.fn(),
        setSessionLayout,
      })
    )
    fire('\\', { metaKey: true })
    expect(setSessionLayout).not.toHaveBeenCalled()
  })

  test('unmount removes the listener', () => {
    const setSessionLayout = vi.fn()
    const sessions = [makeSession('s1', 'single', ['p0'])]
    const { unmount } = renderHook(() =>
      usePaneShortcuts({
        sessions,
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout,
      })
    )
    unmount()
    fire('\\', { metaKey: true })
    expect(setSessionLayout).not.toHaveBeenCalled()
  })

  test('Cmd+2 with active=p0 and 2 panes focuses p1', () => {
    const setSessionActivePane = vi.fn()
    const sessions = [makeSession('s1', 'vsplit', ['p0', 'p1'])]
    renderHook(() =>
      usePaneShortcuts({
        sessions,
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )
    fire('2', { metaKey: true })
    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p1')
  })

  test('Cmd+1 with already-active p0 is a no-op BUT preventDefault still fires', () => {
    const setSessionActivePane = vi.fn()
    const sessions = [makeSession('s1', 'vsplit', ['p0', 'p1'])]
    renderHook(() =>
      usePaneShortcuts({
        sessions,
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )
    const event = fire('1', { metaKey: true })
    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(
      (event as KeyboardEvent & { __pd: ReturnType<typeof vi.spyOn> }).__pd
    ).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/terminal/hooks/usePaneShortcuts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/terminal/hooks/usePaneShortcuts.ts
import { useEffect, useRef } from 'react'
import type { LayoutId, Session } from '../../sessions/types'

const LAYOUT_CYCLE: readonly LayoutId[] = [
  'single',
  'vsplit',
  'hsplit',
  'threeRight',
  'quad',
] as const

export interface UsePaneShortcutsOptions {
  sessions: Session[]
  activeSessionId: string | null
  setSessionActivePane: (sessionId: string, paneId: string) => void
  setSessionLayout: (sessionId: string, layoutId: LayoutId) => void
}

export const usePaneShortcuts = ({
  sessions,
  activeSessionId,
  setSessionActivePane,
  setSessionLayout,
}: UsePaneShortcutsOptions): void => {
  const sessionsRef = useRef(sessions)
  const activeSessionIdRef = useRef(activeSessionId)
  sessionsRef.current = sessions
  activeSessionIdRef.current = activeSessionId

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.altKey || event.shiftKey) return

      const activeId = activeSessionIdRef.current
      if (activeId === null) return
      const activeSession = sessionsRef.current.find((s) => s.id === activeId)
      if (!activeSession) return

      if (event.key >= '1' && event.key <= '4') {
        event.preventDefault()
        event.stopPropagation()
        const idx = parseInt(event.key, 10) - 1
        const target = activeSession.panes[idx]
        if (target && !target.active) {
          setSessionActivePane(activeSession.id, target.id)
        }
        return
      }

      if (event.key === '\\') {
        event.preventDefault()
        event.stopPropagation()
        const currentIdx = LAYOUT_CYCLE.indexOf(activeSession.layout)
        const nextIdx = (currentIdx + 1) % LAYOUT_CYCLE.length
        setSessionLayout(activeSession.id, LAYOUT_CYCLE[nextIdx])
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [setSessionActivePane, setSessionLayout])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/terminal/hooks/usePaneShortcuts.test.ts`
Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/hooks/usePaneShortcuts.ts src/features/terminal/hooks/usePaneShortcuts.test.ts
git commit -m "feat(terminal): add usePaneShortcuts capture-phase listener (5c-1 task 5)"
```

---

## Task 6: `SplitView` — motion wrap + click-to-focus prop

**Files:**

- Modify: `src/features/terminal/components/SplitView/SplitView.tsx`
- Test: `src/features/terminal/components/SplitView/SplitView.test.tsx`

- [ ] **Step 1: Write the failing tests (additions to the existing file)**

```tsx
// Additions to SplitView.test.tsx

import userEvent from '@testing-library/user-event'

describe('SplitView — click-to-focus (5c-1)', () => {
  test('clicking a slot calls onSetActivePane with (sessionId, paneId)', async () => {
    const user = userEvent.setup()
    const onSetActivePane = vi.fn()
    const service = buildMockService()
    const session = makeSession('vsplit', 2, 0)
    render(
      <SplitView
        session={session}
        service={service}
        isActive
        onSetActivePane={onSetActivePane}
      />
    )
    const slotP1 = screen.getAllByTestId('split-view-slot')[1]
    await user.click(slotP1)
    expect(onSetActivePane).toHaveBeenCalledOnce()
    expect(onSetActivePane).toHaveBeenCalledWith(session.id, 'p1')
  })

  test('omitting onSetActivePane → click is a no-op (no error)', async () => {
    const user = userEvent.setup()
    const service = buildMockService()
    const session = makeSession('vsplit', 2, 0)
    render(<SplitView session={session} service={service} isActive />)
    const slotP1 = screen.getAllByTestId('split-view-slot')[1]
    await user.click(slotP1) // does not throw
    // No assertion needed — absence of a throw is the contract.
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/terminal/components/SplitView/SplitView.test.tsx -t "click-to-focus"`
Expected: FAIL — `onSetActivePane` prop unknown OR click doesn't reach the slot handler.

- [ ] **Step 3: Write the implementation**

Update `src/features/terminal/components/SplitView/SplitView.tsx`:

1. Update imports:

```ts
import type { ReactElement } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import type { Pane, Session } from '../../../sessions/types'
import type { NotifyPaneReady } from '../../hooks/useTerminal'
import type { ITerminalService } from '../../services/terminalService'
import { TerminalPane, type TerminalPaneMode } from '../TerminalPane'
import { LAYOUTS } from './layouts'
```

2. Update `SplitViewProps` interface — add `onSetActivePane`:

```ts
export interface SplitViewProps {
  session: Session
  service: ITerminalService
  isActive: boolean
  onSessionCwdChange?: (sessionId: string, paneId: string, cwd: string) => void
  onPaneReady?: NotifyPaneReady
  onSessionRestart?: (sessionId: string) => void
  /** NEW in 5c-1: click-to-focus dispatcher. */
  onSetActivePane?: (sessionId: string, paneId: string) => void
  deferTerminalFit?: boolean
}
```

3. Destructure the new prop:

```ts
export const SplitView = ({
  session,
  service,
  isActive,
  onSessionCwdChange = undefined,
  onPaneReady = undefined,
  onSessionRestart = undefined,
  onSetActivePane = undefined,
  deferTerminalFit = false,
}: SplitViewProps): ReactElement => {
```

4. Replace the return JSX (everything inside the `return (...)`):

```tsx
return (
  <LayoutGroup id={session.id}>
    <motion.div
      layout
      data-testid="split-view"
      data-session-id={session.id}
      data-layout={session.layout}
      className="grid h-full w-full gap-2 bg-surface p-2.5"
      style={{
        gridTemplateColumns: layout.cols,
        gridTemplateRows: layout.rows,
        gridTemplateAreas,
      }}
    >
      <AnimatePresence initial={false}>
        {visiblePanes.map((pane, i) => {
          const mode = paneMode(pane)
          return (
            <motion.div
              key={pane.id}
              layout
              layoutId={pane.id}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 360, damping: 34 }}
              onClick={() => onSetActivePane?.(session.id, pane.id)}
              data-testid="split-view-slot"
              data-pane-id={pane.id}
              data-pty-id={pane.ptyId}
              data-mode={mode}
              data-cwd={pane.cwd}
              className="relative min-h-0 min-w-0"
              style={{ gridArea: `p${i}` }}
            >
              <TerminalPane
                key={pane.ptyId}
                session={session}
                pane={pane}
                service={service}
                mode={mode}
                onCwdChange={(cwd) =>
                  onSessionCwdChange?.(session.id, pane.id, cwd)
                }
                onPaneReady={onPaneReady}
                onRestart={onSessionRestart}
                isActive={isActive}
                deferFit={deferTerminalFit}
              />
            </motion.div>
          )
        })}
      </AnimatePresence>
    </motion.div>
  </LayoutGroup>
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/terminal/components/SplitView/SplitView.test.tsx`
Expected: All existing 5b tests PASS + 2 new click tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/components/SplitView/SplitView.tsx src/features/terminal/components/SplitView/SplitView.test.tsx
git commit -m "feat(terminal): wrap SplitView in motion + add onSetActivePane (5c-1 task 6)"
```

---

## Task 7: `TerminalPane` rising-edge focus effect

**Files:**

- Modify: `src/features/terminal/components/TerminalPane/index.tsx`
- Test: `src/features/terminal/components/TerminalPane/index.test.tsx`

- [ ] **Step 1: Write the failing tests (additions)**

```tsx
// Additions to src/features/terminal/components/TerminalPane/index.test.tsx

describe('TerminalPane — rising-edge focus effect (5c-1 Decision #11)', () => {
  test('does NOT focus on initial mount with pane.active=true', () => {
    const focusSpy = vi.fn()
    // Use the existing Body mock seam — replace the body ref or stub
    // Body to expose focusTerminal=focusSpy. Pattern from existing
    // TerminalPane tests.
    renderTerminalPane({
      pane: makePane({ active: true }),
      bodyMockHandle: { focusTerminal: focusSpy },
    })
    expect(focusSpy).not.toHaveBeenCalled()
  })

  test('focuses when pane.active flips false → true', () => {
    const focusSpy = vi.fn()
    const { rerender } = renderTerminalPane({
      pane: makePane({ active: false }),
      bodyMockHandle: { focusTerminal: focusSpy },
    })
    expect(focusSpy).not.toHaveBeenCalled()
    rerender({ pane: makePane({ active: true }) })
    expect(focusSpy).toHaveBeenCalledOnce()
  })

  test('does NOT re-focus when pane.active stays true across renders', () => {
    const focusSpy = vi.fn()
    const { rerender } = renderTerminalPane({
      pane: makePane({ active: false }),
      bodyMockHandle: { focusTerminal: focusSpy },
    })
    rerender({ pane: makePane({ active: true }) })
    rerender({ pane: makePane({ active: true }) })
    expect(focusSpy).toHaveBeenCalledOnce()
  })

  test('focuses on second rising edge after going false again', () => {
    const focusSpy = vi.fn()
    const { rerender } = renderTerminalPane({
      pane: makePane({ active: false }),
      bodyMockHandle: { focusTerminal: focusSpy },
    })
    rerender({ pane: makePane({ active: true }) })
    expect(focusSpy).toHaveBeenCalledOnce()
    rerender({ pane: makePane({ active: false }) })
    rerender({ pane: makePane({ active: true }) })
    expect(focusSpy).toHaveBeenCalledTimes(2)
  })
})
```

(`renderTerminalPane` / `makePane` / `bodyMockHandle` are the existing helpers in this test file from 5a/5b. If they don't expose `bodyMockHandle`, add an injectable Body mock via `vi.mock('./Body', ...)` at the top of the file following the existing pattern.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/terminal/components/TerminalPane/index.test.tsx -t "rising-edge"`
Expected: FAIL — `focusSpy` never called even when `active` flips, because the effect doesn't exist yet.

- [ ] **Step 3: Write the implementation**

In `src/features/terminal/components/TerminalPane/index.tsx`, near the top of the function body (right after `const bodyRef = useRef<BodyHandle>(null)`):

```ts
// Decision #11 (5c-1): rising-edge effect couples pane.active state
// with xterm DOM focus. When pane.active flips false → true (via
// click-to-focus, Ctrl/Cmd+1-4, or any future programmatic source),
// we move the keyboard cursor into xterm so the visual ring and the
// input cursor land together.
const wasActiveRef = useRef(pane.active)
useEffect(() => {
  if (pane.active && !wasActiveRef.current) {
    bodyRef.current?.focusTerminal()
  }
  wasActiveRef.current = pane.active
}, [pane.active])
```

Also update the stale comment on `handleContainerClick` (around line 92 — "Until 5c lands the mutation, gate `focusTerminal()` on `pane.active`"). Replace with:

```ts
// Direct DOM click into the pane wrapper: focus xterm only when this
// pane is already active. If the clicked pane is currently inactive,
// the SplitView slot's onClick → setSessionActivePane fires first and
// flips pane.active=true; React re-renders; the rising-edge effect
// above (Decision #11, 5c-1) then runs focusTerminal(). The
// pane.active guard here prevents a duplicate focus for the
// already-active case where no state mutation occurs.
```

Confirm `useEffect` is in the existing import list — add if missing:

```ts
import { useCallback, useEffect, useRef } from 'react'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/terminal/components/TerminalPane/index.test.tsx`
Expected: existing tests PASS + 4 new rising-edge tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/components/TerminalPane/index.tsx src/features/terminal/components/TerminalPane/index.test.tsx
git commit -m "feat(terminal): rising-edge focus effect on pane.active (5c-1 task 7)"
```

---

## Task 8: `TerminalZone` toolbar + `WorkspaceView` plumbing

**Files:**

- Modify: `src/features/workspace/components/TerminalZone.tsx`
- Test: `src/features/workspace/components/TerminalZone.test.tsx`

- [ ] **Step 1: Write the failing tests (additions)**

```tsx
// Additions to TerminalZone.test.tsx

describe('TerminalZone — layout toolbar (5c-1)', () => {
  test('mounts toolbar when sessions.length > 0 and not loading', () => {
    const sessions = [makeSession('s1', 'vsplit', ['p0'])]
    render(
      <TerminalZone
        sessions={sessions}
        activeSessionId="s1"
        service={buildMockService()}
        setSessionActivePane={vi.fn()}
        setSessionLayout={vi.fn()}
      />
    )
    expect(screen.getByTestId('layout-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('layout-switcher')).toBeInTheDocument()
  })

  test('hides toolbar when loading=true', () => {
    render(
      <TerminalZone
        sessions={[]}
        activeSessionId={null}
        service={buildMockService()}
        loading
        setSessionActivePane={vi.fn()}
        setSessionLayout={vi.fn()}
      />
    )
    expect(screen.queryByTestId('layout-toolbar')).not.toBeInTheDocument()
  })

  test('hides toolbar when sessions.length === 0', () => {
    render(
      <TerminalZone
        sessions={[]}
        activeSessionId={null}
        service={buildMockService()}
        setSessionActivePane={vi.fn()}
        setSessionLayout={vi.fn()}
      />
    )
    expect(screen.queryByTestId('layout-toolbar')).not.toBeInTheDocument()
  })

  test('clicking a layout button calls setSessionLayout with active session id', async () => {
    const user = userEvent.setup()
    const setSessionLayout = vi.fn()
    const sessions = [makeSession('s1', 'single', ['p0'])]
    render(
      <TerminalZone
        sessions={sessions}
        activeSessionId="s1"
        service={buildMockService()}
        setSessionActivePane={vi.fn()}
        setSessionLayout={setSessionLayout}
      />
    )
    await user.click(screen.getByTitle('Vertical split'))
    expect(setSessionLayout).toHaveBeenCalledOnce()
    expect(setSessionLayout).toHaveBeenCalledWith('s1', 'vsplit')
  })

  test('toolbar shows ⌘ on Mac', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    })
    const sessions = [makeSession('s1', 'single', ['p0'])]
    render(
      <TerminalZone
        sessions={sessions}
        activeSessionId="s1"
        service={buildMockService()}
        setSessionActivePane={vi.fn()}
        setSessionLayout={vi.fn()}
      />
    )
    expect(screen.getByTestId('layout-toolbar').textContent).toContain('⌘')
  })

  test('toolbar shows Ctrl by default (jsdom Linux)', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true,
    })
    const sessions = [makeSession('s1', 'single', ['p0'])]
    render(
      <TerminalZone
        sessions={sessions}
        activeSessionId="s1"
        service={buildMockService()}
        setSessionActivePane={vi.fn()}
        setSessionLayout={vi.fn()}
      />
    )
    expect(screen.getByTestId('layout-toolbar').textContent).toContain('Ctrl')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/workspace/components/TerminalZone.test.tsx -t "layout toolbar"`
Expected: FAIL — toolbar test-id absent; `setSessionLayout` is not a known prop on the component.

- [ ] **Step 3: Write the implementation**

Update `src/features/workspace/components/TerminalZone.tsx`:

1. Update the imports:

```ts
import type { ReactElement } from 'react'
import type { LayoutId, Session } from '../../sessions/types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type {
  PaneEventHandler,
  NotifyPaneReadyResult,
} from '../../sessions/hooks/useSessionManager'
import { isOpenSessionStatus } from '../../sessions/utils/pickNextVisibleSessionId'
import { SplitView } from '../../terminal/components/SplitView'
import { LayoutSwitcher } from '../../terminal/components/LayoutSwitcher'
```

2. Extend props:

```ts
export interface TerminalZoneProps {
  sessions: Session[]
  activeSessionId: string | null
  onSessionCwdChange?: (sessionId: string, paneId: string, cwd: string) => void
  loading?: boolean
  onPaneReady?: (
    ptyId: string,
    handler: PaneEventHandler
  ) => NotifyPaneReadyResult
  onSessionRestart?: (sessionId: string) => void
  deferTerminalFit?: boolean
  service: ITerminalService
  /** NEW in 5c-1: passed straight through to SplitView's slot click. */
  setSessionActivePane: (sessionId: string, paneId: string) => void
  /** NEW in 5c-1: invoked when the user picks a LayoutSwitcher button. */
  setSessionLayout: (sessionId: string, layoutId: LayoutId) => void
}
```

3. Replace the function body:

```tsx
export const TerminalZone = ({
  sessions,
  activeSessionId,
  onSessionCwdChange = undefined,
  loading = false,
  onPaneReady = undefined,
  onSessionRestart = undefined,
  deferTerminalFit = false,
  service,
  setSessionActivePane,
  setSessionLayout,
}: TerminalZoneProps): ReactElement => {
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const showToolbar =
    !loading && sessions.length > 0 && activeSession !== undefined
  const modKey =
    typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')
      ? '⌘'
      : 'Ctrl'

  return (
    <div data-testid="terminal-zone" className="flex min-h-0 flex-1 flex-col">
      {showToolbar ? (
        <div
          data-testid="layout-toolbar"
          className="flex shrink-0 items-center gap-2 bg-surface-container px-3 py-2"
        >
          <span className="font-mono text-xs uppercase tracking-wider text-on-surface-muted">
            Layout
          </span>
          <LayoutSwitcher
            activeLayoutId={activeSession.layout}
            onPick={(id) => setSessionLayout(activeSession.id, id)}
          />
          <span className="ml-auto font-mono text-xs text-on-surface-muted">
            <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>+
            <kbd className="rounded bg-on-surface/10 px-1">1-4</kbd> focus pane
            · <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>+
            <kbd className="rounded bg-on-surface/10 px-1">\</kbd> cycle
          </span>
        </div>
      ) : null}
      <div
        data-testid="terminal-content"
        className="relative min-h-0 flex-1 bg-surface"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center font-mono text-on-surface/60">
            <p>Restoring sessions...</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex h-full items-center justify-center font-mono text-on-surface/60">
            <p>
              No active session. Click + in the session tab bar above to create
              one.
            </p>
          </div>
        ) : (
          sessions.map((session) => {
            const isActive = session.id === activeSessionId
            const hasVisibleTab =
              isActive || isOpenSessionStatus(session.status)
            return (
              <div
                key={session.id}
                id={`session-panel-${session.id}`}
                role="tabpanel"
                aria-labelledby={
                  hasVisibleTab ? `session-tab-${session.id}` : undefined
                }
                data-testid="terminal-pane"
                data-session-id={session.id}
                className={`absolute inset-0 ${isActive ? '' : 'hidden'}`}
              >
                <SplitView
                  session={session}
                  service={service}
                  isActive={isActive}
                  onSessionCwdChange={onSessionCwdChange}
                  onPaneReady={onPaneReady}
                  onSessionRestart={onSessionRestart}
                  onSetActivePane={setSessionActivePane}
                  deferTerminalFit={deferTerminalFit}
                />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/workspace/components/TerminalZone.test.tsx`
Expected: existing tests PASS + 6 new toolbar tests PASS.

- [ ] **Step 5: Commit**

- [ ] **Step 6: Write WorkspaceView plumbing test (additions)**

```tsx
// Additions to src/features/workspace/WorkspaceView.test.tsx
import * as PaneShortcuts from '../terminal/hooks/usePaneShortcuts'

describe('WorkspaceView — usePaneShortcuts wiring (5c-1)', () => {
  test('calls usePaneShortcuts with manager-derived handlers', () => {
    const spy = vi.spyOn(PaneShortcuts, 'usePaneShortcuts')
    render(<WorkspaceView />)
    expect(spy).toHaveBeenCalled()
    const args = spy.mock.calls[0][0]
    expect(typeof args.setSessionActivePane).toBe('function')
    expect(typeof args.setSessionLayout).toBe('function')
    expect(Array.isArray(args.sessions)).toBe(true)
    spy.mockRestore()
  })
})
```

- [ ] **Step 7: Run WorkspaceView wiring test to verify it fails**

Run: `npx vitest run src/features/workspace/WorkspaceView.test.tsx -t "usePaneShortcuts wiring"`
Expected: FAIL — `usePaneShortcuts` is never called.

- [ ] **Step 8: Wire WorkspaceView in the SAME commit as the TerminalZone toolbar**

Combining Tasks 8 + 9 into one commit avoids a transient state where `TerminalZone`'s required `setSessionActivePane` / `setSessionLayout` props are unwired in `WorkspaceView` — the codex plan-complete pass flagged that intermediate as failing `tsc`. Update `src/features/workspace/WorkspaceView.tsx`:

1. Add the import:

```ts
import { usePaneShortcuts } from '../terminal/hooks/usePaneShortcuts'
```

2. Destructure the two new mutations from the manager:

```ts
const {
  sessions,
  activeSessionId,
  // ...existing destructured fields...
  setSessionActivePane,
  setSessionLayout,
} = useSessionManager(service)
```

3. Mount the keyboard hook (alongside `useCommandPalette`):

```ts
usePaneShortcuts({
  sessions,
  activeSessionId,
  setSessionActivePane,
  setSessionLayout,
})
```

4. Pass both mutations to `TerminalZone`:

```tsx
<TerminalZone
  sessions={sessions}
  activeSessionId={activeSessionId}
  service={service}
  // ...existing props...
  setSessionActivePane={setSessionActivePane}
  setSessionLayout={setSessionLayout}
/>
```

- [ ] **Step 9: Run all tests in the touched scope**

Run: `npx vitest run src/features/workspace/`
Expected: existing tests PASS + new toolbar tests + WorkspaceView wiring test all PASS.

- [ ] **Step 10: Commit toolbar + plumbing together**

```bash
git add \
  src/features/workspace/components/TerminalZone.tsx \
  src/features/workspace/components/TerminalZone.test.tsx \
  src/features/workspace/WorkspaceView.tsx \
  src/features/workspace/WorkspaceView.test.tsx
git commit -m "feat(workspace): LayoutSwitcher toolbar + usePaneShortcuts wiring (5c-1 task 8)"
```

---

## Task 9: `progress.yaml` split

**Files:**

- Modify: `docs/roadmap/progress.yaml`

- [ ] **Step 1: Open `docs/roadmap/progress.yaml` and locate the `ui-handoff-migration` phase's `steps` array.**

Find the existing entry:

```yaml
- id: ui-s5c
  name: 'LayoutSwitcher + ⌘1-4 / ⌘\ + click-to-focus + placeholder spawn + X-close + auto-shrink'
  status: pending
```

- [ ] **Step 2: Replace it with the split entries.**

```yaml
- id: ui-s5c-1
  name: 'Layout picker + focus controls (passive, animated)'
  status: in_progress
  notes: 'LayoutSwitcher passive UI + click-to-focus + ⌘1-4 / ⌘\ cycle + Framer Motion shared-layout animations. Spec: docs/superpowers/specs/2026-05-12-step-5c-1-layout-picker-design.md.'
- id: ui-s5c-2
  name: 'addPane / removePane / placeholder spawn / X-close / auto-shrink'
  status: pending
  notes: 'Pane lifecycle mutations + "+ click to add pane" placeholder in empty slots + X-close on per-pane chrome + auto-shrink layout on close. Follows ui-s5c-1.'
```

Keep `ui-s5d` (auto-grow) unchanged.

- [ ] **Step 3: Update the phase-level `notes` for `ui-handoff-migration`** to reference the new slicing (optional but per spec §1 row):

```yaml
notes: >-
  UI handoff migration is the active visual track. Steps 1-3 landed
  in #171, #173, #174. Step 4 (single TerminalPane) shipped in #190.
  Step 5 was sliced for PR-scope: 5a (data model — #198), 5b (CSS
  Grid SplitView — #199), 5c-1 (passive layout picker + focus controls
  + motion — this PR), 5c-2 (pane lifecycle mutations — pending),
  5d (auto-grow — pending).
```

- [ ] **Step 4: Verify the file still parses as valid YAML.**

Run: `node -e "const yaml = require('js-yaml'); yaml.load(require('fs').readFileSync('docs/roadmap/progress.yaml','utf8'))"`
Expected: no output, no error.

(If `js-yaml` isn't available, use `python3 -c "import yaml; yaml.safe_load(open('docs/roadmap/progress.yaml'))"`.)

- [ ] **Step 5: Commit**

```bash
git add docs/roadmap/progress.yaml
git commit -m "chore(roadmap): split ui-s5c into ui-s5c-1 + ui-s5c-2 (5c-1 task 9)"
```

---

## Task 10: Manual smoke test in `tauri:dev`

**Goal:** Verify motion doesn't regress xterm rendering and the LayoutSwitcher + shortcuts work end-to-end before opening the PR.

- [ ] **Step 1: Run dev server**

Run: `npm run tauri:dev`
Expected: native window opens with the workspace rendered. One session, single layout, terminal usable.

- [ ] **Step 2: Layout picker click**

Click each LayoutSwitcher button in order: single → vsplit → hsplit → threeRight → quad → back to single.
Expected: The visible pane smoothly resizes between layouts. xterm content stays legible during the ~250ms transition (minor blur during the FLIP transform is acceptable; full unreadable garbage is NOT — if you see severe garbling, plan §4 fallback says drop to `layout="position"`).

- [ ] **Step 3: Keyboard shortcuts**

- Cmd+\ (or Ctrl+\\ on Linux): each press cycles to the next layout in the order single → vsplit → hsplit → threeRight → quad → single.
- Cmd+1 (or Ctrl+1): no visible change since p0 is already active.
- Cmd+2-4: no error, no visible change (panes don't exist yet in 5c-1).
- Focus an `<input>` somewhere (e.g., session-rename inline edit), press Cmd+\: layout should still cycle (capture-phase listener intercepts).

- [ ] **Step 4: Visual focus follows pane.active**

(Only meaningful when a multi-pane test fixture exists — skip for 5c-1 single-pane production.)

- [ ] **Step 5: Build the production bundle**

Run: `npm run tauri:build` (or at minimum `npm run build`)
Expected: build succeeds with no new TypeScript errors.

- [ ] **Step 6: Final commit (if anything was tweaked during smoke test)**

If smoke test revealed nothing, this step is a no-op. Otherwise commit the fixes with an appropriate `fix(...)` scope.

---

## Task 11: Open the pull request

- [ ] **Step 1: Push the branch**

```bash
git push -u origin <branch-name>
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(terminal): step 5c-1 — layout picker + focus controls (passive, animated)" --body "$(cat <<'EOF'
## Summary

- Adds a passive `LayoutSwitcher` toolbar above the SplitView grid + Ctrl/Cmd+1-4 / Ctrl/Cmd+\ keyboard shortcuts for focus and layout cycling
- Introduces two new `useSessionManager` mutations — `setSessionActivePane` and `setSessionLayout` — both with strict same-reference no-op semantics
- Wraps SplitView in `<LayoutGroup id={session.id}>` + per-pane `<motion.div layout layoutId={pane.id}>` so layout changes animate smoothly (Framer Motion shared-layout pattern)
- Adds a rising-edge effect inside `TerminalPane` that couples `pane.active` state with xterm DOM focus — clicking an inactive pane or hitting Cmd+2 now moves both the visual ring and the keyboard cursor in one action

## Test plan

- [ ] `vitest run` passes (1100+ tests, including ~30 new ones for the surfaces above)
- [ ] Manual smoke in `npm run tauri:dev`: pick each layout, cycle with Cmd+\, verify xterm stays legible during the ~250ms spring transition
- [ ] No regression in 5b SplitView tests
- [ ] `progress.yaml` validates as YAML

Spec: docs/superpowers/specs/2026-05-12-step-5c-1-layout-picker-design.md
Plan: docs/superpowers/plans/2026-05-12-step-5c-1-layout-picker.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Mark `ui-s5c-1` `done` after merge**

Once the PR merges, update `progress.yaml` in a follow-up commit:

```yaml
- id: ui-s5c-1
  name: 'Layout picker + focus controls (passive, animated)'
  status: done
  commit: <merge-commit>
  pr: <pr-number>
```

---

## Self-Review Checklist

- [x] §0 Goals 1-6 each map to a task above (LayoutSwitcher → tasks 1-2; usePaneShortcuts → task 5; click-to-focus → task 6; manager mutations → tasks 3-4; toolbar placement → task 8; motion → tasks 6 + 7).
- [x] §0 Non-goals are respected (no addPane/removePane, no placeholders, no X-close, no auto-shrink, no auto-grow, no Rust IPC changes).
- [x] All 11 Decisions land somewhere in the plan (Decision #1 split is implicit; #2 passive layout in task 8; #3 LAYOUT_CYCLE in task 5; #4 modifier guard in task 5; #5/#6 manager mutations in tasks 3-4; #7 toolbar placement in task 8; #8 WorkspaceView mount also in task 8 — combined commit with TerminalZone toolbar so the required props are introduced and wired in one atomic change; #9 motion + layoutId in task 6; #10 Rust contract not touched — respected by task content; #11 rising-edge effect in task 7).
- [x] No placeholders or "TBD" in code blocks.
- [x] All file paths absolute from repo root.
- [x] Type names consistent across tasks (`LayoutId`, `Pane`, `Session`, `SessionManager`, `LayoutShape` — single source of truth).
- [x] Commit messages follow conventional-commits (`feat(terminal)`, `feat(sessions)`, `feat(workspace)`, `chore(roadmap)`).

---

## Stop Marker

Plan complete. Per /lifeline:planner's contract, this plan is NOT to be auto-executed — codex must review it first via the `plan-complete` hook. Control returns to /lifeline:planner.

<!-- codex-reviewed: 2026-05-12T14:34:18Z -->
