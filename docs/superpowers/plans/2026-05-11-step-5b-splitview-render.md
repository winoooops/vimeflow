# Step 5b — SplitView Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `TerminalZone` to delegate per-session rendering to a new `SplitView` component that maps each `session.panes` to a CSS Grid slot using the 5 canonical layouts (`single` / `vsplit` / `hsplit` / `threeRight` / `quad`). Pure render layer on top of 5a's pane model — no new manager mutations, no IPC calls, no `LayoutSwitcher` UI. Focus ring follows 5a's `pane.active` flag. Multi-pane behaviour exercised via test fixtures only.

**Architecture:** New `src/features/terminal/components/SplitView/` directory (`SplitView.tsx`, `layouts.ts`, `index.ts`, two test files). `TerminalZone` keeps session-iteration + `display:none` hide; per session it renders one `<SplitView>` instead of the old inline single `<TerminalPane>` + mode-derivation block. `TerminalPane`'s visual focus signal retargets from `useFocusedPane().isFocused` to `pane.active` (the hook is kept for `onTerminalFocusChange` which Body still consumes). Add a new `agentForPane(pane)` helper alongside the existing `agentForSession(session)`. Production single-pane sessions render visually near-identically (gain a ~10px margin per uniform-shell baseline).

**Tech Stack:** TypeScript, React 19, Tailwind CSS, Vitest + Testing Library (jsdom). React-side only — no Rust changes.

**Spec:** `docs/superpowers/specs/2026-05-11-step-5b-splitview-render-design.md` (commits `64317f4` initial + `0d43f14` codex iter + `cdf0f93` codex-reviewed footer).

---

## Working Directory

All work happens on branch `feat/step-5b-splitview-render`, branched from `main` at the spec's final footer commit (`cdf0f93`).

```bash
cd /home/will/projects/vimeflow
git checkout -b feat/step-5b-splitview-render main
git rev-parse HEAD   # should be cdf0f93 (or whatever main currently points to)
```

After Task 0 confirms the baseline, every subsequent task commits on this branch. The eventual PR squashes into a single `refactor(terminal):` or `feat(terminal):` commit on main.

---

## Regression Safety Net

These test files exist and must stay green at every task boundary:

- `src/features/terminal/components/TerminalPane/index.test.tsx` — focus, mode, restart paths.
- `src/features/terminal/components/TerminalPane/Header.test.tsx` — header chrome.
- `src/features/terminal/components/TerminalPane/Footer.test.tsx` — footer + agent chip.
- `src/features/terminal/components/TerminalPane/Body.test.tsx` — xterm host + replay.
- `src/features/workspace/components/TerminalZone.test.tsx` — session iteration + show/hide.
- `src/features/sessions/utils/agentForSession.test.ts` — agent resolver.
- `src/features/sessions/hooks/useSessionManager.test.ts` — manager lifecycle.

`pre-push` Husky hook runs `vitest run`; `lint-staged` enforces `no-console: error`, conventional commits, and Prettier on commit. `tsc -b` (via `npm run type-check`) is the type-safety gate.

---

## Task 0: Baseline and feature branch

**Files:** none modified.

- [ ] **Step 1: Confirm clean working tree**

```bash
git status
```

Expected: working tree clean (or limited to pre-existing modifications you want carried across; the prototype `.jsx` files under `docs/design/handoff/prototype/src/` are unrelated to 5b and should be set aside via `git stash` if present).

- [ ] **Step 2: Branch off main**

```bash
git checkout -b feat/step-5b-splitview-render main
git rev-parse HEAD
```

Expected: HEAD points at the spec's footer commit (`cdf0f93` or current main tip).

- [ ] **Step 3: Record baseline test count**

```bash
set -o pipefail
npm run test -- --reporter=basic 2>&1 | tail -20
```

`pipefail` is required so a failing test run doesn't get swallowed by `tail`'s exit code. Expected: all tests pass; the command exits 0. Write down the total test count — every task in this plan keeps it equal or higher (never lower). If the baseline fails, stop here and unblock before continuing.

- [ ] **Step 4: Sanity-check the spec is reachable**

```bash
test -f docs/superpowers/specs/2026-05-11-step-5b-splitview-render-design.md && echo "spec present"
```

Expected: `spec present`.

---

## Task 1: `layouts.ts` data module + tests

**Files:**

- Create: `src/features/terminal/components/SplitView/layouts.ts`
- Create: `src/features/terminal/components/SplitView/layouts.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/terminal/components/SplitView/layouts.test.ts
// cspell:ignore vsplit hsplit
import { describe, test, expect } from 'vitest'
import { LAYOUTS, type LayoutShape } from './layouts'
import type { LayoutId } from '../../../sessions/types'

describe('LAYOUTS', () => {
  test('exposes all 5 canonical layout ids', () => {
    expect(Object.keys(LAYOUTS).sort()).toEqual(
      (
        ['single', 'vsplit', 'hsplit', 'threeRight', 'quad'] as LayoutId[]
      ).sort()
    )
  })

  test.each<LayoutId>(['single', 'vsplit', 'hsplit', 'threeRight', 'quad'])(
    '%s: capacity matches unique slot count in areas',
    (id) => {
      const layout = LAYOUTS[id]
      const slots = new Set(layout.areas.flat())
      expect(layout.capacity).toBe(slots.size)
    }
  )

  test.each<LayoutId>(['single', 'vsplit', 'hsplit', 'threeRight', 'quad'])(
    '%s: slot names are p0..p(capacity-1) with no gaps',
    (id) => {
      const layout = LAYOUTS[id]
      const slots = new Set(layout.areas.flat())
      const expected = new Set(
        Array.from({ length: layout.capacity }, (_, i) => `p${i}`)
      )
      expect(slots).toEqual(expected)
    }
  )

  test.each<LayoutId>(['single', 'vsplit', 'hsplit', 'threeRight', 'quad'])(
    '%s: cols track-count matches areas[0].length',
    (id) => {
      const layout = LAYOUTS[id]
      const colTracks = layout.cols.split(/\s+/).filter(Boolean).length
      expect(colTracks).toBe(layout.areas[0].length)
    }
  )

  test.each<LayoutId>(['single', 'vsplit', 'hsplit', 'threeRight', 'quad'])(
    '%s: rows track-count matches areas.length',
    (id) => {
      const layout = LAYOUTS[id]
      const rowTracks = layout.rows.split(/\s+/).filter(Boolean).length
      expect(rowTracks).toBe(layout.areas.length)
    }
  )

  test('LayoutShape readonly arrays', () => {
    const layout: LayoutShape = LAYOUTS.single
    // @ts-expect-error — readonly array mutation should fail to compile
    layout.areas[0][0] = 'pX'
  })
})
```

- [ ] **Step 2: Run the test — should fail because `layouts.ts` does not exist yet**

```bash
npx vitest run src/features/terminal/components/SplitView/layouts.test.ts
```

Expected: FAIL with module resolution error.

- [ ] **Step 3: Implement `layouts.ts`**

```typescript
// src/features/terminal/components/SplitView/layouts.ts
// cspell:ignore vsplit hsplit
import type { LayoutId } from '../../../sessions/types'

export interface LayoutShape {
  readonly id: LayoutId
  readonly name: string
  /** Maximum pane count for this layout. SplitView clamps `panes.slice(0, capacity)`. */
  readonly capacity: 1 | 2 | 3 | 4
  /** CSS `grid-template-columns` value. Uses `minmax(0, 1fr)` for shrinkable tracks. */
  readonly cols: string
  /** CSS `grid-template-rows` value. */
  readonly rows: string
  /** 2D layout of pane-slot names (`'p0'`..`'pN-1'`). SplitView joins these into
   * `grid-template-areas`. Cell uniqueness must match `capacity`. */
  readonly areas: readonly (readonly string[])[]
}

export const LAYOUTS: Record<LayoutId, LayoutShape> = {
  single: {
    id: 'single',
    name: 'Single',
    capacity: 1,
    cols: 'minmax(0,1fr)',
    rows: 'minmax(0,1fr)',
    areas: [['p0']],
  },
  vsplit: {
    id: 'vsplit',
    name: 'Vertical split',
    capacity: 2,
    cols: 'minmax(0,1fr) minmax(0,1fr)',
    rows: 'minmax(0,1fr)',
    areas: [['p0', 'p1']],
  },
  hsplit: {
    id: 'hsplit',
    name: 'Horizontal split',
    capacity: 2,
    cols: 'minmax(0,1fr)',
    rows: 'minmax(0,1fr) minmax(0,1fr)',
    areas: [['p0'], ['p1']],
  },
  threeRight: {
    id: 'threeRight',
    name: 'Main + 2 stack',
    capacity: 3,
    cols: 'minmax(0,1.4fr) minmax(0,1fr)',
    rows: 'minmax(0,1fr) minmax(0,1fr)',
    areas: [
      ['p0', 'p1'],
      ['p0', 'p2'],
    ],
  },
  quad: {
    id: 'quad',
    name: 'Quad',
    capacity: 4,
    cols: 'minmax(0,1fr) minmax(0,1fr)',
    rows: 'minmax(0,1fr) minmax(0,1fr)',
    areas: [
      ['p0', 'p1'],
      ['p2', 'p3'],
    ],
  },
} as const
```

- [ ] **Step 4: Run the test — should pass now**

```bash
npx vitest run src/features/terminal/components/SplitView/layouts.test.ts
```

Expected: PASS (5 test cases × `test.each` rows × the singletons = ~21 assertions).

- [ ] **Step 5: Type-check**

```bash
npm run type-check
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/terminal/components/SplitView/layouts.ts \
        src/features/terminal/components/SplitView/layouts.test.ts
git commit -m "feat(terminal): add LAYOUTS constants for SplitView"
```

---

## Task 2: `agentForPane` helper + tests

**Files:**

- Modify: `src/features/sessions/utils/agentForSession.ts`
- Modify: `src/features/sessions/utils/agentForSession.test.ts`

- [ ] **Step 1a: Merge `agentForPane` + `Pane` into the existing top imports of the test file**

The file already imports `agentForSession` and `Session` at the top. Lint rules (`import/first`, `import/no-duplicates`) forbid re-importing from the same module further down the file. Edit the existing import block at the top of `src/features/sessions/utils/agentForSession.test.ts` so it reads:

```typescript
import { describe, test, expect } from 'vitest'
import { agentForSession, agentForPane } from './agentForSession'
import { AGENTS } from '../../../agents/registry'
import type { Pane, Session } from '../types'
```

- [ ] **Step 1b: Append the new `describe('agentForPane', …)` block (no new imports)**

After the existing `describe('agentForSession', …)` block in `agentForSession.test.ts`, append:

```typescript
const basePane: Omit<Pane, 'agentType'> = {
  id: 'p0',
  ptyId: 'pty-0',
  cwd: '~',
  status: 'running',
  active: true,
}

describe('agentForPane', () => {
  test('claude-code maps to AGENTS.claude', () => {
    expect(agentForPane({ ...basePane, agentType: 'claude-code' })).toBe(
      AGENTS.claude
    )
  })

  test('codex maps to AGENTS.codex', () => {
    expect(agentForPane({ ...basePane, agentType: 'codex' })).toBe(AGENTS.codex)
  })

  test('aider falls back to AGENTS.shell', () => {
    expect(agentForPane({ ...basePane, agentType: 'aider' })).toBe(AGENTS.shell)
  })

  test('generic falls back to AGENTS.shell', () => {
    expect(agentForPane({ ...basePane, agentType: 'generic' })).toBe(
      AGENTS.shell
    )
  })
})
```

- [ ] **Step 2: Run the test — should fail because `agentForPane` is not exported yet**

```bash
npx vitest run src/features/sessions/utils/agentForSession.test.ts
```

Expected: FAIL with "agentForPane is not a function" (or named-export error during transform).

- [ ] **Step 3a: Update the type import in `agentForSession.ts` to include `Pane`**

The file already imports `Session`. Edit the existing import statement so it reads:

```typescript
import type { Pane, Session } from '../types'
```

(Do NOT re-import `AGENTS`/`Agent`/`AgentId` — the existing top imports cover them. `import/no-duplicates` will fire if you do.)

- [ ] **Step 3b: Add the new export at the END of `agentForSession.ts`** (after the existing `agentForSession` export — keep imports at the top):

```typescript
// New: per-pane agent resolver. Reuses the existing translation map because
// Pane.agentType and Session.agentType share the same string union.
export const agentForPane = (pane: Pane): Agent =>
  AGENTS[AGENT_BY_SESSION_TYPE[pane.agentType]]
```

- [ ] **Step 4: Run tests — both `agentForSession` and `agentForPane` should pass**

```bash
npx vitest run src/features/sessions/utils/agentForSession.test.ts
```

Expected: PASS (8 tests total: 4 pre-existing for `agentForSession`, 4 new for `agentForPane`).

- [ ] **Step 5: Commit**

```bash
git add src/features/sessions/utils/agentForSession.ts \
        src/features/sessions/utils/agentForSession.test.ts
git commit -m "feat(sessions): add agentForPane helper"
```

---

## Task 3: SplitView scaffold + first-render test (single layout only)

**Files:**

- Create: `src/features/terminal/components/SplitView/SplitView.tsx`
- Create: `src/features/terminal/components/SplitView/SplitView.test.tsx`
- Create: `src/features/terminal/components/SplitView/index.ts`

- [ ] **Step 1: Write the failing test for the single-layout case**

```tsx
// src/features/terminal/components/SplitView/SplitView.test.tsx
// cspell:ignore vsplit hsplit
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SplitView } from './SplitView'
import type { LayoutId, Pane, Session } from '../../../sessions/types'
import type { ITerminalService } from '../../services/terminalService'

const makeSession = (
  layout: LayoutId,
  paneCount: number,
  activeIndex = 0
): Session => ({
  id: 'sess-fix',
  projectId: 'proj-fix',
  name: 'fixture session',
  status: 'running',
  workingDirectory: '/tmp/fixture',
  agentType: 'generic',
  layout,
  panes: Array.from(
    { length: paneCount },
    (_, i): Pane => ({
      id: `p${i}`,
      ptyId: `pty-${i}`,
      cwd: '/tmp/fixture',
      agentType: 'generic',
      status: 'running',
      active: i === activeIndex,
      pid: 1000 + i,
      restoreData: {
        sessionId: `pty-${i}`,
        cwd: '/tmp/fixture',
        pid: 1000 + i,
        replayData: '',
        replayEndOffset: 0,
        bufferedEvents: [],
      },
    })
  ),
  createdAt: '2026-05-11T00:00:00Z',
  lastActivityAt: '2026-05-11T00:00:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 200_000, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 200 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
})

const makeMockService = (): ITerminalService => ({
  spawn: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  onData: vi.fn(async () => () => {}),
  onExit: vi.fn(() => () => {}),
  onError: vi.fn(() => () => {}),
  listSessions: vi.fn(async () => ({ sessions: [], activeSessionId: null })),
  setActiveSession: vi.fn(async () => {}),
  reorderSessions: vi.fn(async () => {}),
  updateSessionCwd: vi.fn(async () => {}),
})

describe('SplitView — single layout', () => {
  test('renders one slot with data attrs from the lone pane', () => {
    const service = makeMockService()
    render(
      <SplitView
        session={makeSession('single', 1)}
        service={service}
        isActive
      />
    )

    const slots = screen.getAllByTestId('split-view-slot')
    expect(slots).toHaveLength(1)
    expect(slots[0]).toHaveAttribute('data-pane-id', 'p0')
    expect(slots[0]).toHaveAttribute('data-pty-id', 'pty-0')
    expect(slots[0]).toHaveAttribute('data-cwd', '/tmp/fixture')
    expect(slots[0]).toHaveAttribute('data-mode', 'attach')
  })

  test('outer container carries layout + session data attrs', () => {
    render(
      <SplitView
        session={makeSession('single', 1)}
        service={makeMockService()}
        isActive
      />
    )

    const container = screen.getByTestId('split-view')
    expect(container).toHaveAttribute('data-layout', 'single')
    expect(container).toHaveAttribute('data-session-id', 'sess-fix')
  })
})
```

- [ ] **Step 2: Create the barrel + scaffold so the test can resolve the import (still failing on assertions)**

```typescript
// src/features/terminal/components/SplitView/index.ts
export { SplitView, type SplitViewProps } from './SplitView'
export { LAYOUTS, type LayoutShape } from './layouts'
```

```tsx
// src/features/terminal/components/SplitView/SplitView.tsx
// cspell:ignore vsplit hsplit
import type { ReactElement } from 'react'
import type { Pane, Session } from '../../../sessions/types'
import type { NotifyPaneReady } from '../../hooks/useTerminal'
import type { ITerminalService } from '../../services/terminalService'
import { TerminalPane, type TerminalPaneMode } from '../TerminalPane'
import { LAYOUTS } from './layouts'

export interface SplitViewProps {
  session: Session
  service: ITerminalService
  isActive: boolean
  onSessionCwdChange?: (sessionId: string, paneId: string, cwd: string) => void
  onPaneReady?: NotifyPaneReady
  onSessionRestart?: (sessionId: string) => void
  deferTerminalFit?: boolean
}

const paneMode = (pane: Pane): TerminalPaneMode => {
  if (pane.status === 'completed' || pane.status === 'errored') {
    return 'awaiting-restart'
  }
  if (pane.restoreData) return 'attach'
  return 'spawn'
}

export const SplitView = ({
  session,
  service,
  isActive,
  onSessionCwdChange = undefined,
  onPaneReady = undefined,
  onSessionRestart = undefined,
  deferTerminalFit = false,
}: SplitViewProps): ReactElement => {
  const layout = LAYOUTS[session.layout]
  const visiblePanes = session.panes.slice(0, layout.capacity)
  const areasStr = layout.areas.map((row) => `"${row.join(' ')}"`).join(' ')

  return (
    <div
      data-testid="split-view"
      data-session-id={session.id}
      data-layout={session.layout}
      className="grid h-full w-full gap-2 bg-surface p-2.5"
      style={{
        gridTemplateColumns: layout.cols,
        gridTemplateRows: layout.rows,
        gridTemplateAreas: areasStr,
      }}
    >
      {visiblePanes.map((pane, i) => {
        const mode = paneMode(pane)
        return (
          <div
            key={pane.id}
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
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Run the test — should pass now**

```bash
npx vitest run src/features/terminal/components/SplitView/SplitView.test.tsx
```

Expected: PASS (2 tests). If failing on a deeper `TerminalPane` mount issue (e.g., xterm requires a real `getBoundingClientRect`), check that `src/test/setup.ts` already mocks the DOM APIs `TerminalPane` needs — every existing TerminalPane test passes in jsdom, so this should be fine.

- [ ] **Step 4: Type-check**

```bash
npm run type-check
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/components/SplitView/SplitView.tsx \
        src/features/terminal/components/SplitView/SplitView.test.tsx \
        src/features/terminal/components/SplitView/index.ts
git commit -m "feat(terminal): scaffold SplitView component (single layout)"
```

---

## Task 4: SplitView renders the four multi-pane layouts

**Files:**

- Modify: `src/features/terminal/components/SplitView/SplitView.test.tsx`

(No changes to `SplitView.tsx` — Task 3's implementation already handles all 5 layouts because it reads from `LAYOUTS`. This task adds assertion coverage and verifies the grid styles match.)

- [ ] **Step 1: Add the multi-pane tests**

Append inside `SplitView.test.tsx` (a new `describe` block):

```typescript
describe('SplitView — multi-pane layouts', () => {
  test('vsplit renders 2 slots with the vsplit grid template', () => {
    render(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isActive
      />
    )

    const slots = screen.getAllByTestId('split-view-slot')
    expect(slots).toHaveLength(2)
    expect(slots.map((s) => s.getAttribute('data-pane-id'))).toEqual([
      'p0',
      'p1',
    ])

    const container = screen.getByTestId('split-view')
    expect(container).toHaveStyle({
      gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
      gridTemplateRows: 'minmax(0,1fr)',
      gridTemplateAreas: '"p0 p1"',
    })
  })

  test('hsplit renders 2 slots stacked vertically', () => {
    render(
      <SplitView
        session={makeSession('hsplit', 2)}
        service={makeMockService()}
        isActive
      />
    )

    const container = screen.getByTestId('split-view')
    expect(container).toHaveStyle({
      gridTemplateAreas: '"p0" "p1"',
    })
    expect(screen.getAllByTestId('split-view-slot')).toHaveLength(2)
  })

  test('threeRight renders 3 slots with the main + 2-stack template', () => {
    render(
      <SplitView
        session={makeSession('threeRight', 3)}
        service={makeMockService()}
        isActive
      />
    )

    const container = screen.getByTestId('split-view')
    expect(container).toHaveStyle({
      gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)',
      gridTemplateRows: 'minmax(0,1fr) minmax(0,1fr)',
      gridTemplateAreas: '"p0 p1" "p0 p2"',
    })
    expect(screen.getAllByTestId('split-view-slot')).toHaveLength(3)
  })

  test('quad renders 4 slots', () => {
    render(
      <SplitView
        session={makeSession('quad', 4)}
        service={makeMockService()}
        isActive
      />
    )

    const container = screen.getByTestId('split-view')
    expect(container).toHaveStyle({
      gridTemplateAreas: '"p0 p1" "p2 p3"',
    })
    expect(screen.getAllByTestId('split-view-slot')).toHaveLength(4)
  })

  test('each slot gets gridArea = `p${index}` regardless of pane.id naming', () => {
    // Build a session where the panes are intentionally given non-conforming
    // ids — SplitView must still place them at p0..p3 based on iteration.
    const session = makeSession('quad', 4)
    session.panes.forEach((p, i) => {
      p.id = `oddName-${i}`
    })

    render(
      <SplitView session={session} service={makeMockService()} isActive />
    )

    const slots = screen.getAllByTestId('split-view-slot')
    expect(slots[0]).toHaveStyle({ gridArea: 'p0' })
    expect(slots[3]).toHaveStyle({ gridArea: 'p3' })
  })
})
```

- [ ] **Step 2: Run the tests — all four layouts should pass**

```bash
npx vitest run src/features/terminal/components/SplitView/SplitView.test.tsx
```

Expected: PASS (7 tests total — 2 from Task 3 + 5 here).

- [ ] **Step 3: Commit**

```bash
git add src/features/terminal/components/SplitView/SplitView.test.tsx
git commit -m "test(terminal): cover SplitView vsplit/hsplit/threeRight/quad layouts"
```

---

## Task 5: SplitView under-capacity rendering

**Files:**

- Modify: `src/features/terminal/components/SplitView/SplitView.test.tsx`

- [ ] **Step 1: Add the under-capacity tests**

Append a new `describe` block to `SplitView.test.tsx`:

```typescript
describe('SplitView — under-capacity', () => {
  test('quad layout with 2 panes renders 2 slots (capacity-2 unfilled tracks)', () => {
    render(
      <SplitView
        session={makeSession('quad', 2)}
        service={makeMockService()}
        isActive
      />
    )

    const slots = screen.getAllByTestId('split-view-slot')
    expect(slots).toHaveLength(2)
    expect(slots.map((s) => s.getAttribute('data-pane-id'))).toEqual([
      'p0',
      'p1',
    ])

    // Grid template is still quad; the unfilled tracks just don't contain a slot.
    const container = screen.getByTestId('split-view')
    expect(container).toHaveAttribute('data-layout', 'quad')
    expect(container).toHaveStyle({
      gridTemplateAreas: '"p0 p1" "p2 p3"',
    })
  })

  test('threeRight layout with 1 pane renders 1 slot', () => {
    render(
      <SplitView
        session={makeSession('threeRight', 1)}
        service={makeMockService()}
        isActive
      />
    )

    expect(screen.getAllByTestId('split-view-slot')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests — both should pass (impl already handles this via `panes.slice`)**

```bash
npx vitest run src/features/terminal/components/SplitView/SplitView.test.tsx
```

Expected: PASS (9 tests total).

- [ ] **Step 3: Commit**

```bash
git add src/features/terminal/components/SplitView/SplitView.test.tsx
git commit -m "test(terminal): SplitView under-capacity grid rendering"
```

---

## Task 6: SplitView over-capacity invariant (DEV throw)

**Files:**

- Modify: `src/features/terminal/components/SplitView/SplitView.tsx`
- Modify: `src/features/terminal/components/SplitView/SplitView.test.tsx`

- [ ] **Step 1: Add the failing test (expect a throw on over-capacity)**

Append to `SplitView.test.tsx`:

```typescript
describe('SplitView — over-capacity invariant', () => {
  test('throws in DEV when panes.length > layout.capacity', () => {
    // single capacity = 1; seed 2 panes to violate the invariant.
    const session = makeSession('single', 2)

    // Suppress the React error-boundary console noise so the failing-render
    // does not pollute test output. Vitest runs with import.meta.env.DEV=true,
    // so the throw path is reached.
    // `() => undefined` (not `() => {}`) sidesteps `no-empty-function`.
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    expect(() =>
      render(
        <SplitView
          session={session}
          service={makeMockService()}
          isActive
        />
      )
    ).toThrow(/SplitView invariant violation/)

    consoleSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run the test — should fail because the invariant check is not yet in place**

```bash
npx vitest run src/features/terminal/components/SplitView/SplitView.test.tsx
```

Expected: FAIL (no throw — `panes.slice(0, 1)` silently drops the extra pane).

- [ ] **Step 3: Add the invariant check to `SplitView.tsx`**

Modify `SplitView.tsx` — inside the function body, insert immediately after `const layout = LAYOUTS[session.layout]` and BEFORE `const visiblePanes = ...`:

```tsx
if (import.meta.env.DEV && session.panes.length > layout.capacity) {
  throw new Error(
    `SplitView invariant violation: session ${session.id} has ` +
      `${session.panes.length} panes but layout '${session.layout}' ` +
      `has capacity ${layout.capacity}`
  )
}
```

- [ ] **Step 4: Run the test — should pass now**

```bash
npx vitest run src/features/terminal/components/SplitView/SplitView.test.tsx
```

Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/components/SplitView/SplitView.tsx \
        src/features/terminal/components/SplitView/SplitView.test.tsx
git commit -m "feat(terminal): SplitView over-capacity invariant (DEV throw)"
```

---

## Task 7: SplitView guarantees no `service.spawn` call (Decision #3 lock-in)

**Files:**

- Modify: `src/features/terminal/components/SplitView/SplitView.test.tsx`

(No SplitView.tsx change — the invariant is mechanical: every fixture seeds `restoreData`, so `paneMode` returns `'attach'` for every pane, and `TerminalPane` in attach mode never calls `service.spawn`. This task adds the explicit guard test.)

- [ ] **Step 1: Add the no-spawn assertion**

Append to `SplitView.test.tsx`:

```typescript
describe('SplitView — Decision #3 (no PTY-lifecycle IPC)', () => {
  test('quad render does not invoke service.spawn or service.kill', () => {
    const service = makeMockService()
    render(
      <SplitView
        session={makeSession('quad', 4)}
        service={service}
        isActive
      />
    )

    expect(service.spawn).not.toHaveBeenCalled()
    expect(service.kill).not.toHaveBeenCalled()
  })

  test('single-pane render does not invoke spawn either', () => {
    const service = makeMockService()
    render(
      <SplitView
        session={makeSession('single', 1)}
        service={service}
        isActive
      />
    )

    expect(service.spawn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests — should pass (impl already attaches because `restoreData` is seeded)**

```bash
npx vitest run src/features/terminal/components/SplitView/SplitView.test.tsx
```

Expected: PASS (12 tests total).

- [ ] **Step 3: Commit**

```bash
git add src/features/terminal/components/SplitView/SplitView.test.tsx
git commit -m "test(terminal): SplitView guarantees no service.spawn/kill"
```

---

## Task 8: TerminalPane focus retarget — `useFocusedPane().isFocused` → `pane.active`

**Files:**

- Modify: `src/features/terminal/components/TerminalPane/index.tsx`
- Modify: `src/features/terminal/components/TerminalPane/index.test.tsx`

- [ ] **Step 1: Update the existing "click flips focused state" test to its 5b form**

Replace the current test at `src/features/terminal/components/TerminalPane/index.test.tsx:201-208`:

```tsx
test('clicking the container flips focused state', () => {
  render(<TerminalPane {...baseProps} />)

  const wrapper = screen.getByTestId('terminal-pane-wrapper')
  fireEvent.click(wrapper)

  expect(wrapper).toHaveAttribute('data-focused', 'true')
})
```

…with the 5b version (renders both cases of `pane.active`):

```tsx
test('data-focused mirrors pane.active=true', () => {
  render(
    <TerminalPane {...baseProps} pane={{ ...baseProps.pane, active: true }} />
  )

  expect(screen.getByTestId('terminal-pane-wrapper')).toHaveAttribute(
    'data-focused',
    'true'
  )
})

test('data-focused absent when pane.active=false', () => {
  render(
    <TerminalPane {...baseProps} pane={{ ...baseProps.pane, active: false }} />
  )

  expect(screen.getByTestId('terminal-pane-wrapper')).not.toHaveAttribute(
    'data-focused'
  )
})
```

- [ ] **Step 2: Run the test — should fail because TerminalPane still reads from `useFocusedPane`, not `pane.active`**

```bash
npx vitest run src/features/terminal/components/TerminalPane/index.test.tsx
```

Expected: FAIL on the new `pane.active=false` test (current code initializes `useFocusedPane` per its `initial` default and that may or may not be false; check the actual output).

- [ ] **Step 3: Retarget the visual focus signal in `TerminalPane/index.tsx`**

Modify lines around 64. Replace:

```tsx
const { isFocused, setFocused, onTerminalFocusChange } = useFocusedPane({
  containerRef,
})
```

with:

```tsx
// Narrow useFocusedPane to only its still-needed side effect (Body's
// xterm-focus callback). The visual focus signal is now driven by
// pane.active per spec Decision #11.
const { onTerminalFocusChange } = useFocusedPane({ containerRef })
const isFocused = pane.active
```

And update `handleContainerClick` (lines 90-93) — replace:

```tsx
const handleContainerClick = useCallback((): void => {
  bodyRef.current?.focusTerminal()
  setFocused(true)
}, [setFocused])
```

with:

```tsx
const handleContainerClick = useCallback((): void => {
  // Keyboard focus follows the click (xterm still receives keystrokes).
  // Visual focus ring is read-only from pane.active in 5b.
  bodyRef.current?.focusTerminal()
}, [])
```

- [ ] **Step 4: Run the test — should pass now**

```bash
npx vitest run src/features/terminal/components/TerminalPane/index.test.tsx
```

Expected: PASS (existing test count + 1; the focus-ring overlay test at line 210 still works because the overlay only depends on `isFocused`, which now reflects `pane.active`).

- [ ] **Step 5: Run full TerminalPane suite to catch downstream regressions**

```bash
npx vitest run src/features/terminal/components/TerminalPane/
```

Expected: PASS across all files in the directory. If Header or Footer tests fail because they relied on the click-driven focus path, update them to construct fixtures with `pane.active=true`.

- [ ] **Step 6: Commit**

```bash
git add src/features/terminal/components/TerminalPane/index.tsx \
        src/features/terminal/components/TerminalPane/index.test.tsx
git commit -m "refactor(terminal): TerminalPane focus ring follows pane.active"
```

---

## Task 9: TerminalPane agent retarget — `agentForSession(session)` → `agentForPane(pane)`

**Files:**

- Modify: `src/features/terminal/components/TerminalPane/index.tsx`
- Modify: `src/features/terminal/components/TerminalPane/index.test.tsx` (and any sibling test file whose fixture sets `session.agentType` without also setting `pane.agentType`)

- [ ] **Step 1: Update the import and call site in `index.tsx`**

Replace:

```tsx
import { agentForSession } from '../../../sessions/utils/agentForSession'
```

with:

```tsx
import { agentForPane } from '../../../sessions/utils/agentForSession'
```

And at line 58, replace:

```tsx
const agent = agentForSession(session)
```

with:

```tsx
const agent = agentForPane(pane)
```

- [ ] **Step 2: Audit `TerminalPane/index.test.tsx` for fixtures that diverge `session.agentType` from `pane.agentType`**

`agentForSession(session)` and `agentForPane(pane)` are no longer equivalent when a fixture sets only one. Search the test file:

```bash
grep -n "agentType:" src/features/terminal/components/TerminalPane/index.test.tsx
```

For every fixture that previously set ONLY `session.agentType`, update the matching `pane` entry (or `panes[0]`) so its `agentType` is identical. If a fixture overrides `agentType` via the `baseSession` spread, also override `baseProps.pane.agentType` (or rebuild `baseProps.pane` to match).

Apply the same audit to `Header.test.tsx`, `Footer.test.tsx`, and `Body.test.tsx` — any of those that import a session fixture from `index.test.tsx` inherits the same constraint.

- [ ] **Step 3: Run the TerminalPane suite — should pass after fixture audit**

```bash
npx vitest run src/features/terminal/components/TerminalPane/
```

Expected: PASS. If a test still fails, the fixture mismatch is the most likely culprit — fix the fixture, not the assertion.

- [ ] **Step 4: Run full type-check**

```bash
npm run type-check
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/components/TerminalPane/index.tsx \
        src/features/terminal/components/TerminalPane/index.test.tsx \
        src/features/terminal/components/TerminalPane/Header.test.tsx \
        src/features/terminal/components/TerminalPane/Footer.test.tsx \
        src/features/terminal/components/TerminalPane/Body.test.tsx
# (Add only the files that the audit actually modified.)
git commit -m "refactor(terminal): TerminalPane reads agent from pane (agentForPane)"
```

---

## Task 10: TerminalPane inactive-pane opacity dim

**Files:**

- Modify: `src/features/terminal/components/TerminalPane/index.tsx`
- Modify: `src/features/terminal/components/TerminalPane/index.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/features/terminal/components/TerminalPane/index.test.tsx`:

```tsx
test('inactive pane renders dimmed (opacity 0.78)', () => {
  render(
    <TerminalPane {...baseProps} pane={{ ...baseProps.pane, active: false }} />
  )

  expect(screen.getByTestId('terminal-pane-wrapper')).toHaveStyle({
    opacity: '0.78',
  })
})

test('active pane renders at full opacity', () => {
  render(
    <TerminalPane {...baseProps} pane={{ ...baseProps.pane, active: true }} />
  )

  expect(screen.getByTestId('terminal-pane-wrapper')).toHaveStyle({
    opacity: '1',
  })
})
```

- [ ] **Step 2: Run the tests — should fail (no opacity applied yet)**

```bash
npx vitest run src/features/terminal/components/TerminalPane/index.test.tsx
```

Expected: FAIL on both new tests.

- [ ] **Step 3: Add opacity to the container style**

Modify `src/features/terminal/components/TerminalPane/index.tsx` — find the JSX block around line 142 that spreads `containerStyle` into `style`. Update the `style` prop to include the opacity:

```tsx
      style={{
        ...containerStyle,
        background: '#121221',
        borderRadius: 10,
        transition: 'box-shadow 220ms ease, opacity 220ms ease',
        opacity: isFocused ? 1 : 0.78,
      }}
```

- [ ] **Step 4: Run the tests — both should pass**

```bash
npx vitest run src/features/terminal/components/TerminalPane/index.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/components/TerminalPane/index.tsx \
        src/features/terminal/components/TerminalPane/index.test.tsx
git commit -m "feat(terminal): inactive TerminalPane renders at opacity 0.78"
```

---

## Task 11: TerminalZone delegates per-session rendering to SplitView

**Files:**

- Modify: `src/features/workspace/components/TerminalZone.tsx`
- Modify: `src/features/workspace/components/TerminalZone.test.tsx`

- [ ] **Step 1: Refactor `TerminalZone.tsx`**

Replace the entire `sessions.map((session) => { ... })` block (the body that derives `mode`, looks up `findActivePane`, etc.) with the SplitView delegation:

```tsx
import type { ReactElement } from 'react'
import type { Session } from '../../sessions/types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type {
  PaneEventHandler,
  NotifyPaneReadyResult,
} from '../../sessions/hooks/useSessionManager'
import { isOpenSessionStatus } from '../../sessions/utils/pickNextVisibleSessionId'
import { SplitView } from '../../terminal/components/SplitView'

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
}

export const TerminalZone = ({
  sessions,
  activeSessionId,
  onSessionCwdChange = undefined,
  loading = false,
  onPaneReady = undefined,
  onSessionRestart = undefined,
  deferTerminalFit = false,
  service,
}: TerminalZoneProps): ReactElement => (
  <div data-testid="terminal-zone" className="flex min-h-0 flex-1 flex-col">
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
          const hasVisibleTab = isActive || isOpenSessionStatus(session.status)

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
                deferTerminalFit={deferTerminalFit}
              />
            </div>
          )
        })
      )}
    </div>
  </div>
)
```

- [ ] **Step 2: Update `TerminalZone.test.tsx` assertions that targeted the old per-session pane wrapper**

Existing tests (lines 187-190 area) reach `data-pane-id` / `data-cwd` / `data-pty-id` / `data-mode` on `terminal-pane` (the outer wrapper). Post-5b those data-attrs hang on `split-view-slot`. Update the assertions to use the new testid:

For every assertion of the shape:

```ts
expect(mockPanes[0]).toHaveAttribute('data-pane-id', 'p0')
expect(mockPanes[0]).toHaveAttribute('data-pty-id', 'sess-1')
expect(mockPanes[0]).toHaveAttribute('data-cwd', '~')
expect(mockPanes[0]).toHaveAttribute('data-mode', 'attach')
```

replace `mockPanes[0]` with a `screen.getAllByTestId('split-view-slot')` lookup. Example refactor of the test that previously read:

```ts
const terminalPanes = screen.getAllByTestId('terminal-pane')
expect(terminalPanes[0]).toHaveAttribute('data-pane-id', 'p0')
```

becomes:

```ts
const slots = screen.getAllByTestId('split-view-slot')
expect(slots[0]).toHaveAttribute('data-pane-id', 'p0')
// The session-level wrapper still exists for show/hide; assert separately:
expect(screen.getAllByTestId('terminal-pane')[0]).toHaveAttribute(
  'data-session-id'
  /* session id from fixture */
)
```

Walk through every `terminal-pane` assertion in the file (~10-15 spots) and split them into "session-level" assertions (on the `terminal-pane` outer wrapper) vs "pane-level" assertions (on `split-view-slot`).

- [ ] **Step 2b: Add a multi-pane (vsplit) delegation test**

Per spec §1 / §3 testing — TerminalZone must be proven to delegate multi-pane sessions through SplitView. Add this test to `TerminalZone.test.tsx`:

```tsx
test('vsplit session renders both panes via SplitView', () => {
  const session: Session = {
    // …reuse the standard test fixture shape from elsewhere in this file…
    id: 'sess-vsplit',
    projectId: 'proj-1',
    name: 'multi-pane',
    status: 'running',
    workingDirectory: '/tmp/a',
    agentType: 'generic',
    layout: 'vsplit',
    panes: [
      {
        id: 'p0',
        ptyId: 'pty-a',
        cwd: '/tmp/a',
        agentType: 'generic',
        status: 'running',
        active: true,
        pid: 1001,
        restoreData: {
          sessionId: 'pty-a',
          cwd: '/tmp/a',
          pid: 1001,
          replayData: '',
          replayEndOffset: 0,
          bufferedEvents: [],
        },
      },
      {
        id: 'p1',
        ptyId: 'pty-b',
        cwd: '/tmp/b',
        agentType: 'generic',
        status: 'running',
        active: false,
        pid: 1002,
        restoreData: {
          sessionId: 'pty-b',
          cwd: '/tmp/b',
          pid: 1002,
          replayData: '',
          replayEndOffset: 0,
          bufferedEvents: [],
        },
      },
    ],
    createdAt: '2026-05-11T00:00:00Z',
    lastActivityAt: '2026-05-11T00:00:00Z',
    activity: {
      fileChanges: [],
      toolCalls: [],
      testResults: [],
      contextWindow: { used: 0, total: 200_000, percentage: 0, emoji: '😊' },
      usage: {
        sessionDuration: 0,
        turnCount: 0,
        messages: { sent: 0, limit: 200 },
        tokens: { input: 0, output: 0, total: 0 },
      },
    },
  }

  render(
    <TerminalZone
      sessions={[session]}
      activeSessionId="sess-vsplit"
      service={mockService}
    />
  )

  const slots = screen.getAllByTestId('split-view-slot')
  expect(slots).toHaveLength(2)
  expect(slots[0]).toHaveAttribute('data-pane-id', 'p0')
  expect(slots[0]).toHaveAttribute('data-pty-id', 'pty-a')
  expect(slots[1]).toHaveAttribute('data-pane-id', 'p1')
  expect(slots[1]).toHaveAttribute('data-pty-id', 'pty-b')
})
```

Reuse the existing `mockService` declared at the top of the test file (or import the same shape used by SplitView.test.tsx — if neither exists yet, copy the helper from Task 3 Step 1).

- [ ] **Step 3: Run the TerminalZone test suite**

```bash
npx vitest run src/features/workspace/components/TerminalZone.test.tsx
```

Expected: PASS. If any test still fails because its fixture's `session.workingDirectory` and `pane.cwd` diverge (e.g., session.workingDirectory='~' but pane.cwd='/tmp'), the assertion needs to follow the slot's `data-cwd` (which mirrors `pane.cwd`).

- [ ] **Step 4: Run the full test suite to catch ripple effects**

```bash
npm run test
```

Expected: PASS overall. If anything elsewhere in `WorkspaceView.test.tsx` or `useSessionManager.test.ts` regresses, fix in place — most likely fix is the same data-attribute-source change.

- [ ] **Step 5: Commit**

```bash
git add src/features/workspace/components/TerminalZone.tsx \
        src/features/workspace/components/TerminalZone.test.tsx
git commit -m "refactor(workspace): TerminalZone delegates rendering to SplitView"
```

---

## Task 12: Update `docs/roadmap/progress.yaml` + final integration check

**Files:**

- Modify: `docs/roadmap/progress.yaml`

- [ ] **Step 1: Split the existing `ui-s5` entry under the `ui-handoff-migration` phase**

Locate the existing entry near the bottom of `docs/roadmap/progress.yaml`:

```yaml
- id: ui-s5
  name: 'SplitView grid (5 layouts) + LayoutSwitcher + ⌘1-4 / ⌘\ shortcuts'
  status: pending
```

Replace with four sub-entries (preserve indentation):

```yaml
- id: ui-s5a
  name: 'Per-session pane model refactor'
  status: done
  commit: a76d962
  pr: 198
  notes: 'Data model — Session.layout + Session.panes[], per-pane PTY ownership, exactly-one-active invariant.'
- id: ui-s5b
  name: 'SplitView render (CSS Grid mapping session.panes → 5 layouts)'
  status: pending
  notes: 'Pure render refactor — no LayoutSwitcher / shortcuts / spawn / close. Spec: docs/superpowers/specs/2026-05-11-step-5b-splitview-render-design.md.'
- id: ui-s5c
  name: 'LayoutSwitcher + ⌘1-4 / ⌘\ + click-to-focus + placeholder spawn + X-close + auto-shrink'
  status: pending
- id: ui-s5d
  name: 'Auto-grow on layout pick (parallel PTY fan-out)'
  status: pending
```

- [ ] **Step 2: Verify YAML parses**

```bash
node -e "console.log(require('js-yaml').load(require('fs').readFileSync('docs/roadmap/progress.yaml','utf8')).phases.find(p => p.id === 'ui-handoff-migration').steps.length)"
```

Expected: prints a number; should be 13 (original 10 minus 1 collapsed `ui-s5` plus 4 new entries). If the project doesn't have `js-yaml` installed globally, a quick alternative is `yq '.phases[] | select(.id == "ui-handoff-migration") | .steps | length' docs/roadmap/progress.yaml` — or simply visually verify by opening the file.

- [ ] **Step 3: Full test suite + lint + type-check**

```bash
npm run lint && npm run type-check && npm run test
```

Expected: all three commands pass cleanly. Test count equals or exceeds the Task 0 baseline.

- [ ] **Step 4: Commit**

```bash
git add docs/roadmap/progress.yaml
git commit -m "docs(roadmap): split ui-s5 into 5a/5b/5c/5d sub-steps"
```

---

## Task 13: Manual smoke test in `tauri:dev`

**Files:** none modified.

- [ ] **Step 1: Run the desktop app**

```bash
npm run tauri:dev
```

Wait for the window to open. The dev server may take ~30-60 seconds the first time.

- [ ] **Step 2: Verify single-pane production rendering**

Create a new session (icon-rail `+` or auto-created on launch). Confirm:

- [ ] The terminal pane renders inside a ~10px margin (uniform shell baseline — visible delta vs pre-5b).
- [ ] The focus ring is visible on the only pane (pane.active=true always for single-pane).
- [ ] You can type into the shell and characters appear.
- [ ] `Ctrl+C` / `Ctrl+L` etc. still work (xterm input pathway unchanged).

- [ ] **Step 3: Verify nothing regressed in agent detection / activity panel**

If a Claude Code or Codex session was already running, it should still detect correctly; the activity panel populates as expected. No console errors in DevTools.

- [ ] **Step 4: Push the branch + open the PR**

```bash
git push -u origin feat/step-5b-splitview-render
gh pr create --title "refactor(terminal): step 5b — SplitView render" --body "$(cat <<'EOF'
## Summary

- Refactor `TerminalZone` to delegate per-session rendering to a new `SplitView` component that maps `session.panes` to a CSS Grid using the 5 canonical layouts (`single` / `vsplit` / `hsplit` / `threeRight` / `quad`).
- `TerminalPane` focus ring now reads `pane.active` (was: `useFocusedPane` DOM-focus state). Inactive panes render at `opacity: 0.78`. Per-pane agent resolved via new `agentForPane(pane)`.
- Production single-pane sessions still spawn `panes=[1]` (5a's `createSession`); the visible delta is the uniform `~10px` margin around the terminal. Multi-pane behaviour exercised via test fixtures only — 5c ships the LayoutSwitcher / spawn-close / ⌘1-4-⌘\.
- Spec: `docs/superpowers/specs/2026-05-11-step-5b-splitview-render-design.md`.

## Test plan

- [ ] `npm run test` — full suite green; new `SplitView.test.tsx`, `layouts.test.ts`, expanded `agentForSession.test.ts` and `TerminalPane/index.test.tsx` all pass.
- [ ] `npm run type-check` and `npm run lint` clean.
- [ ] Manual smoke in `npm run tauri:dev` — single-pane session renders with `~10px` margin, focus ring on, typing works, no console errors.
- [ ] No regressions in agent detection / activity panel for an existing Claude Code session.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens cleanly.

---

## Self-review checklist (run after Task 13)

- [ ] **Spec coverage** — every Goal in §1, every Decision in §3, every modified-files entry in §1 maps to a task above. Goals 1-5 ↦ Tasks 3-7; Decision #3 ↦ Task 7's no-spawn assertion; Decision #7 ↦ Task 6; Decision #10 ↦ Task 3 (`paneMode` inline); Decision #11 ↦ Task 8.
- [ ] **No placeholders** — every task block contains the actual code, the exact path, and the run command.
- [ ] **Type consistency** — `SplitViewProps` field names match the `<SplitView ...>` call site in TerminalZone (Task 11). `agentForPane` signature matches its call site in TerminalPane (Task 9). `LAYOUTS[layout]` shape matches the test assertions in `layouts.test.ts` (Task 1).

If any of the above fails, fix inline and re-run the affected task.

---

## Roll-back guidance

The branch is isolated. If anything goes sideways:

```bash
git checkout main
git branch -D feat/step-5b-splitview-render
```

No state is published until the PR is opened in Task 13 Step 4.
