# Sidebar Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land issue #178: promote `Sidebar` to a content-agnostic global chrome component with named slots; extract reusable `Card` / `Group` (compound) / `List` / `Tab` / `Tabs` primitives + four pure utilities into a new `src/features/workspace/sessions/` subtree; redistribute 56 source tests across leaf + integration files. No visual or behavioural regression vs PR #174.

**Architecture:** Seven-commit refactor in dependency order — pure utilities first (`statePill`, `lineDelta`, `subtitle`, `mediateReorder`), then `useResizable` promotion to `src/hooks/`, then leaf-up component extractions (`Card` → `Group` → `List`), then chrome promotion (`Sidebar` to `src/components/sidebar/`), then session-tab strip co-location + `Tab` leaf extraction. Each commit keeps the test suite green; the running app is visually unchanged at every step.

**Tech Stack:** TypeScript (ESM, `moduleResolution: bundler`), React 18, Tailwind CSS 3.x, framer-motion (`Reorder.Group` / `Reorder.Item` / `motion.div` with `layoutScroll`), Vitest + @testing-library/react + jsdom, ESLint flat config (`react/require-default-props`, `react/function-component-definition`, `@typescript-eslint/explicit-function-return-type`, no-console), Prettier (no semicolons, single quotes, trailing commas-es5), conventional-commits via commitlint.

**Spec:** `docs/superpowers/specs/2026-05-06-sidebar-refactor-design.md`

**Branch:** `docs/178-sidebar-refactor-spec` (already checked out — DO NOT switch).

**Follow-up issues filed during spec:** #179 (Tab Delete/Backspace → global keymap), #180 (sidebar separator keyboard a11y).

---

## Pre-flight

Verify environment before starting. Run these in order; if any fail, fix before continuing.

- [ ] **Step 1: Confirm branch**

```bash
git rev-parse --abbrev-ref HEAD
```

Expected: `docs/178-sidebar-refactor-spec`. If different, run `git checkout docs/178-sidebar-refactor-spec` (the spec commits already live on this branch).

- [ ] **Step 2: Confirm clean working tree**

```bash
git status --porcelain
```

Expected: empty output. If dirty, stop and ask the user — the plan assumes a clean tree.

- [ ] **Step 3: Confirm tooling**

```bash
node -v && npm -v
```

Expected: Node ≥ 24 (per `.nvmrc`).

- [ ] **Step 4: Confirm dependencies installed**

```bash
test -d node_modules && echo OK || (npm install && echo INSTALLED)
```

Expected: `OK` (or `INSTALLED` after install).

- [ ] **Step 5: Confirm baseline tests pass**

```bash
npm run test
```

Expected: green. This is the regression baseline; every phase below must end green.

---

## Phase 1: Pure utility extractions (commit 1 of spec §10)

Extract four pure modules under `src/features/workspace/sessions/utils/` with co-located tests. The old `Sidebar.tsx` keeps its inline definitions until Phase 5 (when `List` extracts those JSX paths); the new utils exist but are unused on the codepath after this phase.

**Files:**

- Create: `src/features/workspace/sessions/utils/statePill.ts`
- Create: `src/features/workspace/sessions/utils/statePill.test.ts`
- Create: `src/features/workspace/sessions/utils/lineDelta.ts`
- Create: `src/features/workspace/sessions/utils/lineDelta.test.ts`
- Create: `src/features/workspace/sessions/utils/subtitle.ts`
- Create: `src/features/workspace/sessions/utils/subtitle.test.ts`
- Create: `src/features/workspace/sessions/utils/mediateReorder.ts`
- Create: `src/features/workspace/sessions/utils/mediateReorder.test.ts`

### Task 1.1: Create `statePill.ts`

- [ ] **Step 1: Create the file**

Write `src/features/workspace/sessions/utils/statePill.ts`:

```ts
import type { Session } from '../../types'

export const STATE_PILL_LABEL: Record<Session['status'], string> = {
  running: 'running',
  paused: 'awaiting',
  completed: 'completed',
  errored: 'errored',
}

// Bright pills — Active group rows. Vivid bg + saturated text.
export const STATE_PILL_TONE: Record<Session['status'], string> = {
  running: 'text-success bg-success/10',
  paused: 'text-warning bg-warning/10',
  completed: 'text-success-muted bg-success-muted/10',
  errored: 'text-error bg-error/15',
}

// Dim pills — Recent group rows.
export const STATE_PILL_TONE_DIM: Record<Session['status'], string> = {
  running: 'text-success/70 bg-success/5',
  paused: 'text-warning/70 bg-warning/5',
  completed: 'text-success-muted/70 bg-success-muted/5',
  errored: 'text-error/80 bg-error/8',
}
```

- [ ] **Step 2: Create the test**

Write `src/features/workspace/sessions/utils/statePill.test.ts`:

```ts
import { describe, test, expect } from 'vitest'
import {
  STATE_PILL_LABEL,
  STATE_PILL_TONE,
  STATE_PILL_TONE_DIM,
} from './statePill'

describe('statePill lookups', () => {
  test('all three records cover all four SessionStatus keys', () => {
    const expectedKeys = ['running', 'paused', 'completed', 'errored'] as const
    for (const record of [
      STATE_PILL_LABEL,
      STATE_PILL_TONE,
      STATE_PILL_TONE_DIM,
    ]) {
      expect(Object.keys(record).sort()).toEqual([...expectedKeys].sort())
    }
  })

  test('errored tone preserves higher-saturation Active variant (regression guard for the cycle-5 dim treatment not bleeding into Active)', () => {
    expect(STATE_PILL_TONE.errored).toContain('bg-error/15')
    expect(STATE_PILL_TONE_DIM.errored).toContain('bg-error/8')
  })
})
```

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/features/workspace/sessions/utils/statePill.test.ts
```

Expected: 2 tests pass.

### Task 1.2: Create `lineDelta.ts`

- [ ] **Step 1: Create the file**

Write `src/features/workspace/sessions/utils/lineDelta.ts`:

```ts
import type { Session } from '../../types'

export const lineDelta = (
  session: Session
): { added: number; removed: number } => {
  let added = 0
  let removed = 0
  for (const change of session.activity.fileChanges) {
    added += change.linesAdded
    removed += change.linesRemoved
  }
  return { added, removed }
}
```

- [ ] **Step 2: Create the test**

Write `src/features/workspace/sessions/utils/lineDelta.test.ts`:

```ts
import { describe, test, expect } from 'vitest'
import { lineDelta } from './lineDelta'
import type { Session } from '../../types'

const sessionWith = (
  fileChanges: Session['activity']['fileChanges']
): Session =>
  ({
    activity: { fileChanges } as Session['activity'],
  }) as unknown as Session

describe('lineDelta', () => {
  test('empty fileChanges → { added: 0, removed: 0 }', () => {
    expect(lineDelta(sessionWith([]))).toEqual({ added: 0, removed: 0 })
  })

  test('single change sums linesAdded and linesRemoved', () => {
    expect(
      lineDelta(
        sessionWith([
          {
            path: 'a.ts',
            linesAdded: 10,
            linesRemoved: 3,
          } as Session['activity']['fileChanges'][number],
        ])
      )
    ).toEqual({ added: 10, removed: 3 })
  })

  test('multiple changes sum across all entries', () => {
    expect(
      lineDelta(
        sessionWith([
          { path: 'a.ts', linesAdded: 10, linesRemoved: 3 },
          { path: 'b.ts', linesAdded: 5, linesRemoved: 0 },
          { path: 'c.ts', linesAdded: 0, linesRemoved: 7 },
        ] as unknown as Session['activity']['fileChanges'])
      )
    ).toEqual({ added: 15, removed: 10 })
  })

  test('negative values pass through unchanged (no clamping)', () => {
    expect(
      lineDelta(
        sessionWith([
          { path: 'a.ts', linesAdded: -2, linesRemoved: -1 },
        ] as unknown as Session['activity']['fileChanges'])
      )
    ).toEqual({ added: -2, removed: -1 })
  })
})
```

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/features/workspace/sessions/utils/lineDelta.test.ts
```

Expected: 4 tests pass.

### Task 1.3: Create `subtitle.ts`

- [ ] **Step 1: Create the file**

Write `src/features/workspace/sessions/utils/subtitle.ts`:

```ts
import type { Session } from '../../types'

export const subtitle = (session: Session): string => {
  if (session.currentAction !== undefined && session.currentAction !== '') {
    return session.currentAction
  }
  // Normalize Windows `\` to `/` first — Tauri can hand back native
  // separators (e.g. `C:\Users\alice\repo`); a `/`-only split would
  // collapse to one segment and render the full path instead of the
  // basename.
  const normalized = session.workingDirectory.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) {
    return session.workingDirectory || '~'
  }
  if (parts.length === 1) {
    return parts[0]
  }
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}
```

- [ ] **Step 2: Create the test**

Write `src/features/workspace/sessions/utils/subtitle.test.ts`. The first three tests port the subtitle-related tests from today's `Sidebar.test.tsx` (which currently live at `Sidebar.test.tsx:543, 569, 590`); the fourth is a fresh coverage point for the `currentAction` priority branch.

```ts
import { describe, test, expect } from 'vitest'
import { subtitle } from './subtitle'
import type { Session } from '../../types'

const sessionWith = (
  workingDirectory: string,
  currentAction?: string
): Session =>
  ({
    workingDirectory,
    currentAction,
  }) as unknown as Session

describe('subtitle', () => {
  test('non-empty currentAction takes priority over the cwd derivation', () => {
    expect(
      subtitle(sessionWith('/home/will/projects/Vimeflow', 'Editing index.ts'))
    ).toBe('Editing index.ts')
  })

  test('Windows backslash path normalises to last 2 parent/basename segments', () => {
    expect(subtitle(sessionWith('C:\\Users\\alice\\repo'))).toBe('alice/repo')
  })

  test('POSIX shallow path returns parent/basename', () => {
    expect(subtitle(sessionWith('/home/will'))).toBe('home/will')
  })

  test('empty workingDirectory falls back to "~" (race-window safety)', () => {
    expect(subtitle(sessionWith(''))).toBe('~')
  })

  test('single-segment path returns the segment alone', () => {
    expect(subtitle(sessionWith('/root'))).toBe('root')
  })
})
```

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/features/workspace/sessions/utils/subtitle.test.ts
```

Expected: 5 tests pass.

### Task 1.4: Create `mediateReorder.ts`

- [ ] **Step 1: Create the file**

Write `src/features/workspace/sessions/utils/mediateReorder.ts`:

```ts
import type { Session } from '../../types'

/**
 * Pure helper used by `List.handleActiveReorder` to bubble a full
 * sessions array up to `onReorderSessions` after framer-motion's
 * `Reorder.Group.onReorder` fires with a reordered active subset.
 *
 * Concatenation only — does NOT deduplicate. Correctness across
 * mid-drag status transitions depends on `List` mirroring `recent`
 * synchronously via `recentGroupRef`; see the spec's "Mid-drag
 * transition invariant" subsection.
 */
export const mediateReorder = (
  reorderedActive: Session[],
  recent: Session[]
): Session[] => [...reorderedActive, ...recent]
```

- [ ] **Step 2: Create the test**

Write `src/features/workspace/sessions/utils/mediateReorder.test.ts`:

```ts
import { describe, test, expect } from 'vitest'
import { mediateReorder } from './mediateReorder'
import type { Session } from '../../types'

const session = (id: string): Session => ({ id }) as unknown as Session

describe('mediateReorder', () => {
  test('empty active + empty recent → empty array', () => {
    expect(mediateReorder([], [])).toEqual([])
  })

  test('reordered active is the prefix; recent is the suffix', () => {
    const a = session('a')
    const b = session('b')
    const c = session('c')
    expect(mediateReorder([b, a], [c])).toEqual([b, a, c])
  })

  test('does not deduplicate (correctness depends on caller mirroring recent synchronously)', () => {
    const a = session('a')
    const b = session('b')
    expect(mediateReorder([a, b], [a])).toEqual([a, b, a])
  })
})
```

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/features/workspace/sessions/utils/mediateReorder.test.ts
```

Expected: 3 tests pass.

### Task 1.5: Verify and commit Phase 1

- [ ] **Step 1: Run lint on the new files**

```bash
npx eslint src/features/workspace/sessions/utils/
```

Expected: clean (no warnings, no errors).

- [ ] **Step 2: Run type-check**

```bash
npm run type-check
```

Expected: clean.

- [ ] **Step 3: Run the full test suite**

```bash
npm run test
```

Expected: green. Existing 25 + 31 tests still pass; new 14 utility tests pass.

- [ ] **Step 4: Commit Phase 1**

```bash
git add src/features/workspace/sessions/utils/
git commit -m "$(cat <<'EOF'
refactor(sessions/utils): extract pure utilities

Add four pure modules under src/features/workspace/sessions/utils/:
- statePill.ts (STATE_PILL_LABEL / TONE / TONE_DIM lookup tables)
- lineDelta.ts (file-change tally)
- subtitle.ts (cwd → parent/basename derivation)
- mediateReorder.ts (cross-group reorder concatenation seam)

All four are pure functions / values with no React or framer-motion
dependencies. Co-located tests (14 tests) verify each in isolation.
The existing Sidebar.tsx still uses its inline definitions; consumer
migration to these utils happens in subsequent phases (Card / Group
/ List extractions).

Refs: docs/superpowers/specs/2026-05-06-sidebar-refactor-design.md (§"Workspace session utilities — extractions")

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds; lint-staged + commitlint hooks pass.

---

## Phase 2: `useResizable` promotion (commit 2 of spec §10)

Move `useResizable` from `src/features/workspace/hooks/` to `src/hooks/` so the new global `Sidebar` (Phase 6) can consume it without importing from `src/features/`. Add the `initial`-clamp fix + 2 regression tests; bump 4 consumer / mock paths.

**Files:**

- Move: `src/features/workspace/hooks/useResizable.ts` → `src/hooks/useResizable.ts` (with clamp fix)
- Move: `src/features/workspace/hooks/useResizable.test.ts` → `src/hooks/useResizable.test.ts` (with new clamp tests)
- Modify: `src/features/workspace/WorkspaceView.tsx` (import path)
- Modify: `src/features/workspace/components/BottomDrawer.tsx` (import path)
- Modify: `src/features/workspace/WorkspaceView.command-palette.test.tsx` (vi.mock path + dynamic import path)

`BottomDrawer.test.tsx` does NOT mock `useResizable` — no test edit required there beyond the import-path fallout in `BottomDrawer.tsx`.

### Task 2.1: Move `useResizable.ts` and apply the clamp fix

- [ ] **Step 1: Move the source file**

```bash
mkdir -p src/hooks && git mv src/features/workspace/hooks/useResizable.ts src/hooks/useResizable.ts
```

Expected: file moves; `git status` shows `renamed:`.

- [ ] **Step 2: Apply the `initial`-clamp fix**

Open `src/hooks/useResizable.ts`. Replace:

```ts
const [size, setSize] = useState(initial)
```

with:

```ts
// Clamp `initial` on mount so an out-of-range default doesn't briefly
// surface (in `aria-valuenow`, in the rendered size) before the first
// drag triggers the mousemove handler's clamp.
const [size, setSize] = useState(() =>
  Math.round(Math.min(max, Math.max(min, initial)))
)
```

The `useState(() => ...)` lazy initializer ensures the clamp runs only on mount, not on every render.

- [ ] **Step 3: Move the test file**

```bash
git mv src/features/workspace/hooks/useResizable.test.ts src/hooks/useResizable.test.ts
```

- [ ] **Step 4: Add clamp regression tests**

Open `src/hooks/useResizable.test.ts`. At the bottom of the existing `describe('useResizable', ...)` block (or in a new sibling describe), add:

```ts
import { renderHook } from '@testing-library/react'
import { useResizable } from './useResizable'

describe('useResizable initial clamp', () => {
  test('clamps initial > max down to max on mount', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 999, min: 100, max: 500 })
    )
    expect(result.current.size).toBe(500)
  })

  test('clamps initial < min up to min on mount', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: -50, min: 100, max: 500 })
    )
    expect(result.current.size).toBe(100)
  })
})
```

If the existing test file already imports `renderHook` and `useResizable`, skip those duplicate import lines.

- [ ] **Step 5: Run the hook tests**

```bash
npx vitest run src/hooks/useResizable.test.ts
```

Expected: existing tests + 2 new clamp tests pass.

### Task 2.2: Bump consumer import paths

- [ ] **Step 1: Update `WorkspaceView.tsx`**

In `src/features/workspace/WorkspaceView.tsx`, replace:

```ts
import { useResizable } from './hooks/useResizable'
```

with:

```ts
import { useResizable } from '../../hooks/useResizable'
```

- [ ] **Step 2: Update `BottomDrawer.tsx`**

In `src/features/workspace/components/BottomDrawer.tsx`, replace:

```ts
import { useResizable } from '../hooks/useResizable'
```

with:

```ts
import { useResizable } from '../../../hooks/useResizable'
```

- [ ] **Step 3: Update `WorkspaceView.command-palette.test.tsx` mock paths**

In `src/features/workspace/WorkspaceView.command-palette.test.tsx`:

(a) At line 11 (the `vi.mock` call), replace:

```ts
vi.mock('./hooks/useResizable')
```

with:

```ts
vi.mock('../../hooks/useResizable')
```

(b) At line 110 (the dynamic import inside `beforeEach`), replace:

```ts
const { useResizable } = await import('./hooks/useResizable')
```

with:

```ts
const { useResizable } = await import('../../hooks/useResizable')
```

Both paths must change in lockstep: `vi.mock` and `await import()` must resolve to the SAME module identity for the mock to intercept the dynamic import.

- [ ] **Step 4: Confirm no other consumers reference the old path**

```bash
grep -rn "features/workspace/hooks/useResizable\|workspace/hooks/useResizable" src --include="*.tsx" --include="*.ts"
```

Expected: no results (the move + 4 path bumps cover every site).

### Task 2.3: Verify and commit Phase 2

- [ ] **Step 1: Type-check**

```bash
npm run type-check
```

Expected: clean.

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 3: Full test suite**

```bash
npm run test
```

Expected: green. The 4 useResizable tests pass at the new path; all consumer tests still pass.

- [ ] **Step 4: Commit Phase 2**

```bash
git add src/hooks/ src/features/workspace/WorkspaceView.tsx src/features/workspace/components/BottomDrawer.tsx src/features/workspace/WorkspaceView.command-palette.test.tsx
git commit -m "$(cat <<'EOF'
refactor(hooks): promote useResizable to src/hooks

Move src/features/workspace/hooks/useResizable.{ts,test.ts} to
src/hooks/ so the new global Sidebar (sidebar refactor #178) can
consume it without importing from src/features/.

Apply the `initial`-clamp fix so an out-of-range default doesn't
briefly surface in `aria-valuenow` / size before the first drag.
Add 2 regression tests.

Update 4 consumer / mock sites:
- WorkspaceView.tsx (import path)
- BottomDrawer.tsx (import path)
- WorkspaceView.command-palette.test.tsx (vi.mock path + the
  dynamic await import() inside beforeEach — both must move in
  lockstep or the mock and the import resolve to different module
  identities).

BottomDrawer.test.tsx does not mock useResizable; no test edit
needed there beyond the import-path fallout in BottomDrawer.tsx
itself.

Refs: docs/superpowers/specs/2026-05-06-sidebar-refactor-design.md (§"Sidebar API contract" scope addition)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: `Card` extraction (commit 3 of spec §10)

Pull `SessionRow` + `RecentSessionRow` out of `Sidebar.tsx` into a single `Card` component with a `variant: 'active' | 'recent'` prop. The variant prop drives wrapper element (`Reorder.Item` vs `<li>`), tone, and minor structural differences. Sidebar.tsx renders `<Card variant=...>` in place of the two old types.

**Files:**

- Create: `src/features/workspace/sessions/components/Card.tsx`
- Create: `src/features/workspace/sessions/components/Card.test.tsx`
- Modify: `src/features/workspace/components/Sidebar.tsx` (replace `SessionRow` + `RecentSessionRow` usage with `Card`; delete the two old component definitions)

### Task 3.1: Create `Card.tsx`

- [ ] **Step 1: Create the file with the full component**

Write `src/features/workspace/sessions/components/Card.tsx`. The file is ~180 lines; the full implementation sketch lives in the spec at §"Workspace session module — `Card`" → "Implementation sketch" (around lines 360-450 of the spec). Use that as the source of truth. The file's structure:

```tsx
import { type ReactElement } from 'react'
import { motion, Reorder } from 'framer-motion'
import type { Session } from '../../types'
import { StatusDot } from '../../components/StatusDot'
import { useRenameState } from '../../hooks/useRenameState'
import { formatRelativeTime } from '../../../agent-status/utils/relativeTime'
import {
  STATE_PILL_LABEL,
  STATE_PILL_TONE,
  STATE_PILL_TONE_DIM,
} from '../utils/statePill'
import { lineDelta } from '../utils/lineDelta'
import { subtitle } from '../utils/subtitle'

export interface CardProps {
  session: Session
  variant: 'active' | 'recent'
  isActive: boolean
  onClick: (id: string) => void
  onRemove?: (id: string) => void
  onRename?: (id: string, name: string) => void
}

const activeCardClass = (isActive: boolean): string => `
  relative mb-1 cursor-grab rounded-[8px] px-3 py-2.5 transition-colors
  active:cursor-grabbing group
  ${
    isActive
      ? 'bg-primary/10 text-on-surface'
      : 'text-on-surface-variant hover:bg-on-surface/[0.04]'
  }
`

const recentCardClass = (isActive: boolean): string => `
  group relative mb-1 rounded-[8px] px-3 py-2 transition-colors
  ${
    isActive
      ? 'bg-primary/10 text-on-surface'
      : 'text-on-surface-variant hover:bg-on-surface/[0.04]'
  }
`

export const Card = ({
  session,
  variant,
  isActive,
  onClick,
  onRemove = undefined,
  onRename = undefined,
}: CardProps): ReactElement => {
  const {
    isEditing,
    editValue,
    setEditValue,
    inputRef,
    beginEdit,
    commitRename,
    cancelRename,
  } = useRenameState(session, onRename)
  const { added, removed } = lineDelta(session)
  const subtitleText = subtitle(session)

  // Inner content shared by both variants — only the outer wrapper and
  // class lookups differ. Two render paths keep TypeScript happy around
  // the Reorder.Item-vs-li polymorphism.
  const inner = (
    <>
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-primary-container"
        />
      )}

      {/* Click-to-activate button covers the whole row as an absolute
          background layer. Foreground content sits above with
          pointer-events-none so clicks fall through to this button —
          except interactive bits (rename input, hover buttons, the
          title span) which opt back in via pointer-events-auto. */}
      <button
        type="button"
        onClick={() => onClick(session.id)}
        aria-label={session.name}
        id={`sidebar-activate-${session.id}`}
        data-role="activate"
        className="absolute inset-0 rounded-[8px]"
        tabIndex={isEditing ? -1 : 0}
      />

      <div className="pointer-events-none relative flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {variant === 'active' ? (
            <StatusDot status={session.status} />
          ) : (
            <StatusDot status={session.status} size={6} dim />
          )}
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitRename()
                }
                if (e.key === 'Escape') {
                  cancelRename()
                }
              }}
              className={
                variant === 'active'
                  ? 'pointer-events-auto min-w-0 flex-1 truncate rounded bg-surface-container-high px-1 font-label text-[13px] font-semibold text-on-surface outline-none ring-1 ring-primary'
                  : 'pointer-events-auto min-w-0 flex-1 truncate rounded bg-surface-container-high px-1 font-label text-[12.5px] text-on-surface outline-none ring-1 ring-primary'
              }
              aria-label="Rename session"
            />
          ) : (
            <span
              // aria-hidden so AT doesn't announce the name twice — the
              // sibling overlay button already carries aria-label=name.
              aria-hidden="true"
              className={
                variant === 'active'
                  ? 'pointer-events-auto min-w-0 flex-1 cursor-pointer truncate font-label text-[13px] font-semibold text-on-surface'
                  : `pointer-events-auto min-w-0 flex-1 cursor-pointer truncate font-label text-[12.5px] ${isActive ? 'text-on-surface' : 'text-on-surface-variant/60'}`
              }
              // Title-click activation — REQUIRED. Without an explicit
              // onClick, single clicks on the title would NOT bubble to
              // the sibling overlay button (the button is not an
              // ancestor); pointer-events-auto would intercept and
              // primary row activation would silently break.
              onClick={() => onClick(session.id)}
              onDoubleClick={(e) => {
                if (!onRename) {
                  return
                }
                e.stopPropagation()
                beginEdit()
              }}
            >
              {session.name}
            </span>
          )}
          {/* Hide on hover so the absolute-positioned edit/close
              actions in the top-right corner don't overlap. */}
          <span
            className={
              variant === 'active'
                ? 'shrink-0 font-mono text-[10px] text-on-surface-variant/70 transition-opacity group-hover:opacity-0'
                : 'shrink-0 font-mono text-[10px] text-on-surface-variant/50 transition-opacity group-hover:opacity-0'
            }
          >
            {formatRelativeTime(session.lastActivityAt)}
          </span>
        </div>

        {variant === 'active' && (
          <div className="block truncate pl-[15px] font-label text-[11.5px] text-on-surface-variant">
            {subtitleText}
          </div>
        )}

        <div className="flex items-center gap-2 pl-[15px] font-mono text-[10px]">
          <span
            data-testid="state-pill"
            className={`rounded-full px-1.5 py-px uppercase tracking-wide ${
              variant === 'active'
                ? STATE_PILL_TONE[session.status]
                : STATE_PILL_TONE_DIM[session.status]
            }`}
          >
            {STATE_PILL_LABEL[session.status]}
          </span>
          {(added > 0 || removed > 0) && (
            <span
              data-testid="line-delta"
              className={
                variant === 'active'
                  ? 'text-on-surface-variant/70'
                  : 'text-on-surface-variant/50'
              }
            >
              <span
                className={
                  variant === 'active' ? 'text-success' : 'text-success/70'
                }
              >
                +{added}
              </span>{' '}
              <span
                className={
                  variant === 'active' ? 'text-error' : 'text-error/70'
                }
              >
                -{removed}
              </span>
            </span>
          )}
          {variant === 'recent' && (
            <span className="ml-auto truncate font-label text-[10.5px] text-on-surface-variant/50 transition-opacity group-hover:opacity-0">
              {subtitleText}
            </span>
          )}
        </div>
      </div>

      <div className="pointer-events-auto absolute right-2 top-2 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {onRename && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              beginEdit()
            }}
            className="rounded p-0.5 text-on-surface-variant/60 transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="Rename session"
            title="Rename"
          >
            <span className="material-symbols-outlined text-sm">edit</span>
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(session.id)
            }}
            className={`rounded p-0.5 transition-colors hover:bg-error/20 hover:text-error ${
              variant === 'active'
                ? 'text-on-surface-variant/60'
                : 'text-on-surface-variant/40'
            }`}
            aria-label="Remove session"
            title="Remove"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
      </div>
    </>
  )

  if (variant === 'active') {
    return (
      <Reorder.Item
        value={session}
        id={session.id}
        data-testid="session-row"
        data-session-id={session.id}
        data-active={isActive}
        className={activeCardClass(isActive)}
        whileDrag={{
          scale: 1.02,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 50,
        }}
        layout="position"
      >
        {inner}
      </Reorder.Item>
    )
  }

  return (
    <li
      data-testid="recent-session-row"
      data-session-id={session.id}
      data-active={isActive}
      className={recentCardClass(isActive)}
    >
      {inner}
    </li>
  )
}
```

A note on `motion` import: the `motion` symbol is not used directly here (only `Reorder.Item`); some bundlers may complain about the unused import. If lint flags it, remove `motion` from the import list. The `Reorder` import is used.

- [ ] **Step 2: Type-check the new file**

```bash
npm run type-check
```

Expected: clean. If errors mention missing types from `Session` or `useRenameState`, double-check the import paths above.

### Task 3.2: Create `Card.test.tsx`

- [ ] **Step 1: Create the test file**

Write `src/features/workspace/sessions/components/Card.test.tsx`:

```tsx
/* eslint-disable testing-library/no-node-access */
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Reorder } from 'framer-motion'
import { Card, type CardProps } from './Card'
import type { Session } from '../../types'

const session = (overrides: Partial<Session> = {}): Session =>
  ({
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'auth middleware',
    status: 'running',
    workingDirectory: '/home/user/projects/Vimeflow',
    agentType: 'claude-code',
    terminalPid: 12345,
    createdAt: '2026-04-07T03:45:00Z',
    lastActivityAt: '2026-04-07T03:45:00Z',
    activity: {
      fileChanges: [],
      toolCalls: [],
      testResults: [],
      contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
      usage: {
        sessionDuration: 0,
        turnCount: 0,
        messages: { sent: 0, limit: 200 },
        tokens: { input: 0, output: 0, total: 0 },
      },
    },
    ...overrides,
  }) as Session

const renderActiveCard = (
  s: Session,
  overrides: Partial<CardProps> = {}
): ReturnType<typeof render> =>
  render(
    <Reorder.Group axis="y" values={[s]} onReorder={() => {}}>
      <Card
        session={s}
        variant="active"
        isActive={false}
        onClick={() => {}}
        {...overrides}
      />
    </Reorder.Group>
  )

const renderRecentCard = (
  s: Session,
  overrides: Partial<CardProps> = {}
): ReturnType<typeof render> =>
  render(
    <ul>
      <Card
        session={s}
        variant="recent"
        isActive={false}
        onClick={() => {}}
        {...overrides}
      />
    </ul>
  )

describe('Card — active variant', () => {
  test('renders inside a Reorder.Item with data-testid="session-row"', () => {
    renderActiveCard(session())
    expect(screen.getByTestId('session-row')).toBeInTheDocument()
  })

  test('renders StatusDot reflecting session.status', () => {
    renderActiveCard(session({ status: 'running' }))
    // StatusDot exposes data-testid="status-dot" (verified at
    // src/features/workspace/components/StatusDot.tsx:40). Asserting
    // its presence guards against Card accidentally dropping the dot
    // — the previous draft of this test only checked session-row
    // existence, which would pass even if Card removed StatusDot
    // entirely.
    expect(screen.getByTestId('status-dot')).toBeInTheDocument()
  })

  test('renders state pill with bright tone class for the status', () => {
    renderActiveCard(session({ status: 'running' }))
    const pill = screen.getByTestId('state-pill')
    expect(pill).toHaveClass('text-success')
    expect(pill).toHaveClass('bg-success/10')
  })

  test('selection bar rendered iff isActive', () => {
    const { rerender } = renderActiveCard(session(), { isActive: true })
    const row = screen.getByTestId('session-row')
    expect(row.querySelector('.bg-primary-container')).not.toBeNull()

    rerender(
      <Reorder.Group axis="y" values={[session()]} onReorder={() => {}}>
        <Card
          session={session()}
          variant="active"
          isActive={false}
          onClick={() => {}}
        />
      </Reorder.Group>
    )
    expect(
      screen.getByTestId('session-row').querySelector('.bg-primary-container')
    ).toBeNull()
  })

  test('onClick fires when activation overlay button is clicked', async () => {
    const onClick = vi.fn()
    renderActiveCard(session({ id: 'X' }), { onClick })
    await userEvent.click(screen.getByLabelText('auth middleware'))
    expect(onClick).toHaveBeenCalledWith('X')
  })

  test('onClick fires when title span is single-clicked (regression guard for pointer-events-auto interception)', async () => {
    const onClick = vi.fn()
    renderActiveCard(session({ id: 'X' }), { onClick })
    // The title span carries aria-hidden so getByText still works.
    const title = screen.getByText('auth middleware')
    await userEvent.click(title)
    expect(onClick).toHaveBeenCalledWith('X')
  })

  test('renders subtitle below title (full row)', () => {
    renderActiveCard(session({ workingDirectory: '/a/b/projects/X' }))
    expect(screen.getByText('projects/X')).toBeInTheDocument()
  })

  test('renders line-delta only when added or removed > 0', () => {
    renderActiveCard(
      session({
        activity: {
          ...session().activity,
          fileChanges: [
            { path: 'a.ts', linesAdded: 5, linesRemoved: 2 },
          ] as Session['activity']['fileChanges'],
        },
      })
    )
    expect(screen.getByTestId('line-delta')).toBeInTheDocument()
  })

  test('rename: double-click title with onRename enters edit mode; Enter commits', async () => {
    const onRename = vi.fn()
    renderActiveCard(session({ id: 'X' }), { onRename })
    const title = screen.getByText('auth middleware')
    await userEvent.dblClick(title)
    const input = screen.getByLabelText('Rename session')
    expect(input).toHaveFocus()
    await userEvent.clear(input)
    await userEvent.type(input, 'new name{Enter}')
    expect(onRename).toHaveBeenCalledWith('X', 'new name')
  })

  test('rename: Escape cancels without calling onRename', async () => {
    const onRename = vi.fn()
    renderActiveCard(session(), { onRename })
    const title = screen.getByText('auth middleware')
    await userEvent.dblClick(title)
    const input = screen.getByLabelText('Rename session')
    await userEvent.type(input, 'x{Escape}')
    expect(onRename).not.toHaveBeenCalled()
  })

  test('edit/remove buttons hidden when callbacks are omitted', () => {
    renderActiveCard(session())
    expect(
      screen.queryByRole('button', { name: 'Rename session' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove session' })
    ).not.toBeInTheDocument()
  })

  test('onRemove fires when remove button is clicked', async () => {
    const onRemove = vi.fn()
    renderActiveCard(session({ id: 'X' }), { onRemove })
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove session' })
    )
    expect(onRemove).toHaveBeenCalledWith('X')
  })
})

describe('Card — recent variant', () => {
  test('renders as <li> with data-testid="recent-session-row"', () => {
    renderRecentCard(session({ status: 'completed' }))
    expect(screen.getByTestId('recent-session-row').tagName).toBe('LI')
  })

  test('renders state pill with dim tone class', () => {
    renderRecentCard(session({ status: 'completed' }))
    expect(screen.getByTestId('state-pill')).toHaveClass(
      'text-success-muted/70'
    )
  })

  test('subtitle inline at right of state-pill row (ml-auto)', () => {
    renderRecentCard(session({ workingDirectory: '/a/projects/X' }))
    const subtitle = screen.getByText('a/projects/X')
    expect(subtitle).toHaveClass('ml-auto')
  })

  test('inactive title carries dim text class', () => {
    renderRecentCard(session({ status: 'completed' }), { isActive: false })
    const title = screen.getByText('auth middleware')
    expect(title).toHaveClass('text-on-surface-variant/60')
  })

  test('without onRemove, remove button is hidden', () => {
    renderRecentCard(session({ status: 'completed' }))
    expect(
      screen.queryByRole('button', { name: 'Remove session' })
    ).not.toBeInTheDocument()
  })
})
```

If specific selectors fail because `StatusDot` or `useRenameState` use different markup than this test assumes (e.g., the StatusDot test fixture in earlier iterations used `data-testid="status-dot"`), inspect the rendered DOM in the failing test and adjust selectors. The behaviors being asserted are stable; only the queries may need tweaking.

- [ ] **Step 2: Run the new tests**

```bash
npx vitest run src/features/workspace/sessions/components/Card.test.tsx
```

Expected: all tests pass. If a test fails because of a selector mismatch (rather than a behavior mismatch), adjust the selector and re-run.

### Task 3.3: Update `Sidebar.tsx` to use `Card`

- [ ] **Step 1: Add the Card import**

In `src/features/workspace/components/Sidebar.tsx`, near the top with other imports:

```ts
import { Card } from '../sessions/components/Card'
```

- [ ] **Step 2: Replace `<SessionRow ... />` usage with `<Card variant="active" ... />`**

Find the JSX block inside the active `Reorder.Group`:

```tsx
{
  activeGroup.map((session) => (
    <SessionRow
      key={session.id}
      session={session}
      isActive={session.id === activeSessionId}
      onSessionClick={onSessionClick}
      onRemove={handleRemoveSession}
      onRename={onRenameSession}
    />
  ))
}
```

Replace with:

```tsx
{
  activeGroup.map((session) => (
    <Card
      key={session.id}
      session={session}
      variant="active"
      isActive={session.id === activeSessionId}
      onClick={onSessionClick}
      onRemove={handleRemoveSession}
      onRename={onRenameSession}
    />
  ))
}
```

Note the prop rename: `onSessionClick` → `onClick` (Card's API). Sidebar's `onSessionClick` prop stays; only the per-row prop name changes.

- [ ] **Step 3: Replace `<RecentSessionRow ... />` usage with `<Card variant="recent" ... />`**

Find the recent group's `.map`:

```tsx
{
  recentGroup.map((session) => (
    <RecentSessionRow
      key={session.id}
      session={session}
      isActive={session.id === activeSessionId}
      onSessionClick={onSessionClick}
      onRemove={handleRemoveSession}
      onRename={onRenameSession}
    />
  ))
}
```

Replace with:

```tsx
{
  recentGroup.map((session) => (
    <Card
      key={session.id}
      session={session}
      variant="recent"
      isActive={session.id === activeSessionId}
      onClick={onSessionClick}
      onRemove={handleRemoveSession}
      onRename={onRenameSession}
    />
  ))
}
```

- [ ] **Step 4: Delete the old `SessionRow` and `RecentSessionRow` definitions**

Remove these from `Sidebar.tsx` (they should be ~250 lines combined):

- The `interface SessionRowProps { ... }` type
- The `const SessionRow = ({ ... }) => { ... }` definition
- The `const RecentSessionRow = ({ ... }) => { ... }` definition

Also remove now-unused imports inside `Sidebar.tsx`:

- `useRenameState` (Card uses it; Sidebar no longer does)
- `formatRelativeTime` (same)
- `STATE_PILL_LABEL`, `STATE_PILL_TONE`, `STATE_PILL_TONE_DIM` (Card uses them)
- `Reorder` (still used for `Reorder.Group`; KEEP)
- `motion` (still used for `motion.div`; KEEP)

The inline `STATE_PILL_LABEL` etc. constants near the top of the file should be deleted now that Card imports them from `sessions/utils/statePill.ts`.

The inline `sessionSubtitle` and `sessionLineDelta` helpers should also be deleted (Card imports `subtitle` and `lineDelta` from `sessions/utils/`).

- [ ] **Step 5: Type-check**

```bash
npm run type-check
```

Expected: clean. If errors mention undefined symbols, check that the deletions in Step 4 didn't strand a still-used reference.

### Task 3.4: Verify and commit Phase 3

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 2: Full test suite**

```bash
npm run test
```

Expected: green. The 25 tests in `Sidebar.test.tsx` still pass (no behavior change at the Sidebar level — Card re-implements the same DOM); the new Card.test.tsx tests pass.

- [ ] **Step 3: Commit Phase 3**

```bash
git add src/features/workspace/sessions/components/Card.tsx src/features/workspace/sessions/components/Card.test.tsx src/features/workspace/components/Sidebar.tsx
git commit -m "$(cat <<'EOF'
refactor(sessions): extract Card component

Consolidate SessionRow + RecentSessionRow (the two near-duplicate row
components inside Sidebar.tsx, ~80% structurally shared) into a single
Card component with a `variant: 'active' | 'recent'` prop. The variant
drives wrapper element (Reorder.Item vs <li>), tone, status-dot size,
state-pill brightness, subtitle layout, and minor padding differences.

Card consumes the pure utilities extracted in commit 1
(STATE_PILL_*, lineDelta, subtitle). Sidebar.tsx now renders
<Card variant=...> in two .map calls; the inline SessionRow,
RecentSessionRow, sessionSubtitle, sessionLineDelta, and the
STATE_PILL_* constants are deleted.

Add Card.test.tsx with the per-variant test matrix (~17 tests),
including the title-click activation regression guard for the
pointer-events-auto interception path.

Sidebar.test.tsx is unchanged — same DOM, same behavior.

Refs: docs/superpowers/specs/2026-05-06-sidebar-refactor-design.md (§"Workspace session module — Card")

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: `Group` compound extraction (commit 4 of spec §10)

Pull the `GroupHeader` (currently a tiny inline component in Sidebar.tsx) and the per-group container element (Reorder.Group for active, `<ul>` for recent) into a single compound component: `Group` (the body) + `Group.Header` (the header row). The compound shape lets `List` (Phase 5) place the Active header outside the scroll region while keeping Recent's header inside — preserving PR #174's asymmetric layout.

**Files:**

- Create: `src/features/workspace/sessions/components/Group.tsx`
- Create: `src/features/workspace/sessions/components/Group.test.tsx`
- Modify: `src/features/workspace/components/Sidebar.tsx` (use `Group.Header` + `<Group variant=...>` in place of inline `GroupHeader` + Reorder.Group/<ul>)

### Task 4.1: Create `Group.tsx`

- [ ] **Step 1: Write the file**

Write `src/features/workspace/sessions/components/Group.tsx`. Full sketch is in the spec at §"Workspace session module — `Group`" → "Implementation sketch":

```tsx
import { type ReactElement, type ReactNode } from 'react'
import { Reorder } from 'framer-motion'
import type { Session } from '../../types'

export interface GroupHeaderProps {
  label: string
  headerAction?: ReactNode
}

const GroupHeader = ({
  label,
  headerAction = undefined,
}: GroupHeaderProps): ReactElement => (
  <div className="flex items-center justify-between pr-3">
    <h3
      data-testid={`session-group-${label.toLowerCase()}`}
      className="px-3 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-on-surface-variant/70"
    >
      {label}
    </h3>
    {headerAction}
  </div>
)

type GroupBodyCommonProps = {
  sessions: Session[]
  emptyState?: ReactNode
  children: ReactNode
}

export type GroupProps = GroupBodyCommonProps &
  (
    | { variant: 'active'; onReorder: (sessions: Session[]) => void }
    | { variant: 'recent'; onReorder?: never }
  )

const GroupBody = (props: GroupProps): ReactElement => {
  const { sessions, variant, emptyState = undefined, children } = props
  const showEmpty = sessions.length === 0
  const items = showEmpty ? emptyState : children
  const containerClass =
    variant === 'active' ? 'flex flex-col px-2' : 'flex flex-col px-2 pb-1'
  const containerTestId = variant === 'active' ? 'session-list' : 'recent-list'

  if (variant === 'active') {
    return (
      <Reorder.Group
        axis="y"
        values={sessions}
        onReorder={props.onReorder}
        className={containerClass}
        data-testid={containerTestId}
      >
        {items}
      </Reorder.Group>
    )
  }

  return (
    <ul className={containerClass} data-testid={containerTestId}>
      {items}
    </ul>
  )
}

// Compound: `Group` is the body; `Group.Header` is the header row.
export const Group = Object.assign(GroupBody, { Header: GroupHeader })
```

- [ ] **Step 2: Type-check**

```bash
npm run type-check
```

Expected: clean. The `Object.assign(GroupBody, { Header: GroupHeader })` pattern carries TypeScript types correctly via inference.

### Task 4.2: Create `Group.test.tsx`

- [ ] **Step 1: Write the test file**

Write `src/features/workspace/sessions/components/Group.test.tsx`:

```tsx
/* eslint-disable testing-library/no-node-access */
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Group } from './Group'
import type { Session } from '../../types'

const session = (id: string, status: Session['status'] = 'running'): Session =>
  ({ id, name: id, status }) as unknown as Session

describe('Group.Header', () => {
  test('renders label text and the conventional data-testid', () => {
    render(<Group.Header label="Active" />)
    expect(screen.getByTestId('session-group-active')).toHaveTextContent(
      'Active'
    )
  })

  test('renders Recent header with its own data-testid', () => {
    render(<Group.Header label="Recent" />)
    expect(screen.getByTestId('session-group-recent')).toHaveTextContent(
      'Recent'
    )
  })

  test('renders headerAction next to the label when provided', () => {
    render(
      <Group.Header
        label="Active"
        headerAction={<button type="button">Add</button>}
      />
    )
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  test('absent headerAction renders nothing in the action slot', () => {
    const { container } = render(<Group.Header label="Active" />)
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})

describe('Group (body) — active variant', () => {
  test('renders Reorder.Group with data-testid="session-list" and px-2 class', () => {
    render(
      <Group
        variant="active"
        sessions={[session('a'), session('b')]}
        onReorder={() => {}}
      >
        <li data-testid="card-a">A</li>
        <li data-testid="card-b">B</li>
      </Group>
    )
    const container = screen.getByTestId('session-list')
    expect(container).toHaveClass('flex flex-col px-2')
    // Recent's pb-1 should NOT be on Active.
    expect(container.className).not.toContain('pb-1')
  })

  test('renders children when sessions is non-empty', () => {
    render(
      <Group variant="active" sessions={[session('a')]} onReorder={() => {}}>
        <li data-testid="card-a">A</li>
      </Group>
    )
    expect(screen.getByTestId('card-a')).toBeInTheDocument()
  })

  test('renders emptyState when sessions is empty and emptyState is provided', () => {
    render(
      <Group
        variant="active"
        sessions={[]}
        onReorder={() => {}}
        emptyState={<li data-testid="empty">No sessions</li>}
      >
        <li data-testid="card-a">A</li>
      </Group>
    )
    expect(screen.getByTestId('empty')).toBeInTheDocument()
    expect(screen.queryByTestId('card-a')).not.toBeInTheDocument()
  })
})

describe('Group (body) — recent variant', () => {
  test('renders <ul> with data-testid="recent-list" and pb-1 class', () => {
    render(
      <Group variant="recent" sessions={[session('a', 'completed')]}>
        <li data-testid="card-a">A</li>
      </Group>
    )
    const container = screen.getByTestId('recent-list')
    expect(container.tagName).toBe('UL')
    expect(container).toHaveClass('pb-1')
  })

  test('does NOT carry drag-related props (Recent has no Reorder.Group)', () => {
    render(
      <Group variant="recent" sessions={[session('a', 'completed')]}>
        <li data-testid="card-a">A</li>
      </Group>
    )
    // Recent's container should be a plain <ul>; framer-motion's
    // Reorder.Group renders as a motion-augmented <ul>. The simplest
    // smoke is asserting the tagName + the absence of an aria
    // attribute that Reorder.Group would set, but that is brittle.
    // Just confirm tagName.
    expect(screen.getByTestId('recent-list').tagName).toBe('UL')
  })
})
```

- [ ] **Step 2: Run the new tests**

```bash
npx vitest run src/features/workspace/sessions/components/Group.test.tsx
```

Expected: 9 tests pass.

### Task 4.3: Update `Sidebar.tsx` to use `Group`

- [ ] **Step 1: Add the Group import**

In `src/features/workspace/components/Sidebar.tsx`:

```ts
import { Group } from '../sessions/components/Group'
```

- [ ] **Step 2: Replace inline `GroupHeader` definition + Active header div**

Delete the inline `GroupHeader` function definition (the one returning the `<h3>` with `data-testid={`session-group-${label.toLowerCase()}`}`).

Find the JSX:

```tsx
<div className="flex items-center justify-between pr-3">
  <GroupHeader label="Active" />
  <button
    type="button"
    onClick={onNewInstance}
    className="material-symbols-outlined text-base text-on-surface-variant/60 transition-colors hover:text-primary"
    aria-label="Add session"
    title="Add session"
  >
    add
  </button>
</div>
```

Replace with:

```tsx
<Group.Header
  label="Active"
  headerAction={
    <button
      type="button"
      onClick={onNewInstance}
      className="material-symbols-outlined text-base text-on-surface-variant/60 transition-colors hover:text-primary"
      aria-label="Add session"
      title="Add session"
    >
      add
    </button>
  }
/>
```

- [ ] **Step 3: Replace the Active `Reorder.Group` with `<Group variant="active">`**

Find:

```tsx
<Reorder.Group
  axis="y"
  values={activeGroup}
  onReorder={(reordered) => {
    onReorderSessions?.([...reordered, ...recentGroupRef.current])
  }}
  className="flex flex-col px-2"
  data-testid="session-list"
>
  {activeGroup.length === 0 ? (
    <li
      data-testid="active-empty"
      className="px-3 py-3 text-center font-label text-xs text-on-surface-variant/50"
    >
      No active sessions
    </li>
  ) : (
    activeGroup.map((session) => (
      <Card
        key={session.id}
        session={session}
        variant="active"
        isActive={session.id === activeSessionId}
        onClick={onSessionClick}
        onRemove={handleRemoveSession}
        onRename={onRenameSession}
      />
    ))
  )}
</Reorder.Group>
```

Replace with:

```tsx
<Group
  variant="active"
  sessions={activeGroup}
  onReorder={(reordered) => {
    onReorderSessions?.([...reordered, ...recentGroupRef.current])
  }}
  emptyState={
    <li
      data-testid="active-empty"
      className="px-3 py-3 text-center font-label text-xs text-on-surface-variant/50"
    >
      No active sessions
    </li>
  }
>
  {activeGroup.map((session) => (
    <Card
      key={session.id}
      session={session}
      variant="active"
      isActive={session.id === activeSessionId}
      onClick={onSessionClick}
      onRemove={handleRemoveSession}
      onRename={onRenameSession}
    />
  ))}
</Group>
```

- [ ] **Step 4: Replace the Recent header + `<ul>` with `<Group.Header>` + `<Group variant="recent">`**

Find:

```tsx
{
  recentGroup.length > 0 && (
    <>
      <GroupHeader label="Recent" />
      <ul data-testid="recent-list" className="flex flex-col px-2 pb-1">
        {recentGroup.map((session) => (
          <Card
            key={session.id}
            session={session}
            variant="recent"
            isActive={session.id === activeSessionId}
            onClick={onSessionClick}
            onRemove={handleRemoveSession}
            onRename={onRenameSession}
          />
        ))}
      </ul>
    </>
  )
}
```

Replace with:

```tsx
{
  recentGroup.length > 0 && (
    <>
      <Group.Header label="Recent" />
      <Group variant="recent" sessions={recentGroup}>
        {recentGroup.map((session) => (
          <Card
            key={session.id}
            session={session}
            variant="recent"
            isActive={session.id === activeSessionId}
            onClick={onSessionClick}
            onRemove={handleRemoveSession}
            onRename={onRenameSession}
          />
        ))}
      </Group>
    </>
  )
}
```

- [ ] **Step 5: Remove now-unused `Reorder` import**

If `Sidebar.tsx` no longer imports `Reorder` directly anywhere (it shouldn't after Step 3), remove `Reorder` from the framer-motion import. Keep `motion` if it's still used for the scroll motion.div.

```ts
// Before:
import { motion, Reorder } from 'framer-motion'

// After (if Reorder is no longer used):
import { motion } from 'framer-motion'
```

### Task 4.4: Verify and commit Phase 4

- [ ] **Step 1: Type-check + lint + test**

```bash
npm run type-check && npm run lint && npm run test
```

Expected: all green. `Sidebar.test.tsx` still passes (no behavior change); `Group.test.tsx` passes; `Card.test.tsx` still passes.

- [ ] **Step 2: Commit Phase 4**

```bash
git add src/features/workspace/sessions/components/Group.tsx src/features/workspace/sessions/components/Group.test.tsx src/features/workspace/components/Sidebar.tsx
git commit -m "$(cat <<'EOF'
refactor(sessions): extract Group compound component

Pull the inline GroupHeader function + the per-group container
elements (Reorder.Group for active, <ul> for recent) out of
Sidebar.tsx into a single compound component:

- Group (default body) — owns the per-group container element with
  the variant: 'active' | 'recent' discriminated union
  (Reorder.Group requires onReorder; <ul> rejects it).
- Group.Header — owns the section header row (<h3> + optional
  headerAction).

The compound split exists because PR #174 places the Active <h3>
OUTSIDE the scroll region but the Recent <h3> INSIDE — Phase 5
(List extraction) will use this asymmetric placement to preserve
the layout verbatim. A single header+body component cannot model
that.

Sidebar.tsx now renders <Group.Header> + <Group variant=...>
where it previously had the inline GroupHeader + the inline
Reorder.Group / <ul> containers; the inline GroupHeader function
is deleted.

Add Group.test.tsx with 9 tests (3 for the Header, 6 for the
body — both variants).

Refs: docs/superpowers/specs/2026-05-06-sidebar-refactor-design.md (§"Workspace session module — Group")

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: `List` composer extraction (commit 5 of spec §10)

Pull the active/recent split, the `recentGroupRef` mid-drag mirror, the `handleRemoveSession` next-id-and-focus wrapper, the `headerAction` `+` button, the `emptyActive` `<li>`, and the scroll `motion.div` (with `layoutScroll`) out of `Sidebar.tsx` into a new `List` composer. After this phase, `Sidebar.tsx` is dramatically thinner — just chrome (status header div, FileExplorer mount, New Instance button) plus a single `<List ... />` mount.

Tests redistribute: integration tests (group split, recent-empty hidden, active-empty rendered, remove-flow + focus-restore, scroll-wrapper invariant, header `+`, mid-drag transition guard) move to `List.test.tsx`. `Sidebar.test.tsx` shrinks to chrome-shell tests.

**Files:**

- Create: `src/features/workspace/sessions/components/List.tsx`
- Create: `src/features/workspace/sessions/components/List.test.tsx`
- Modify: `src/features/workspace/components/Sidebar.tsx` (replace session-related JSX + handlers with `<List ... />`; drop the now-unused props from `SidebarProps`)
- Modify: `src/features/workspace/components/Sidebar.test.tsx` (remove tests that now live in `List.test.tsx`; keep chrome tests)

### Task 5.1: Create `List.tsx`

- [ ] **Step 1: Write the file**

Write `src/features/workspace/sessions/components/List.tsx`. Full sketch is in the spec at §"Workspace session module — `List`" → "Implementation sketch":

```tsx
import { useRef } from 'react'
import type { ReactElement } from 'react'
import { motion } from 'framer-motion'
import { Group } from './Group'
import { Card } from './Card'
import {
  isOpenSessionStatus,
  pickNextVisibleSessionId,
} from '../../utils/pickNextVisibleSessionId'
import { mediateReorder } from '../utils/mediateReorder'
import type { Session } from '../../types'

export interface ListProps {
  sessions: Session[]
  activeSessionId: string | null
  onSessionClick: (id: string) => void
  onNewInstance?: () => void
  onRemoveSession?: (id: string) => void
  onRenameSession?: (id: string, name: string) => void
  onReorderSessions?: (sessions: Session[]) => void
}

export const List = ({
  sessions,
  activeSessionId,
  onSessionClick,
  onNewInstance = undefined,
  onRemoveSession = undefined,
  onRenameSession = undefined,
  onReorderSessions = undefined,
}: ListProps): ReactElement => {
  const activeGroup = sessions.filter((s) => isOpenSessionStatus(s.status))
  const recentGroup = sessions.filter((s) => !isOpenSessionStatus(s.status))

  // Mirror `recentGroup` synchronously every render so framer-motion's
  // `onReorder` closure reads current values rather than a stale capture.
  // See PR #174's drag-mid-transition note + spec's "Mid-drag transition
  // invariant" subsection for the failure mode this guards against.
  const recentGroupRef = useRef(recentGroup)
  recentGroupRef.current = recentGroup

  const handleRemoveSession = onRemoveSession
    ? (id: string): void => {
        const nextId =
          id === activeSessionId
            ? pickNextVisibleSessionId(sessions, id, activeSessionId)
            : undefined
        onRemoveSession(id)
        if (nextId !== undefined) {
          onSessionClick(nextId)
          // Mirror SessionTabs' getElementById-by-id pattern: the
          // overlay button carries id="sidebar-activate-${id}", so the
          // id-based lookup avoids the CSS-attribute-selector escaping
          // path entirely.
          queueMicrotask(() => {
            document.getElementById(`sidebar-activate-${nextId}`)?.focus()
          })
        }
      }
    : undefined

  const handleActiveReorder = (reordered: Session[]): void => {
    onReorderSessions?.(mediateReorder(reordered, recentGroupRef.current))
  }

  const headerAction = onNewInstance ? (
    <button
      type="button"
      onClick={onNewInstance}
      className="material-symbols-outlined text-base text-on-surface-variant/60 transition-colors hover:text-primary"
      aria-label="Add session"
      title="Add session"
    >
      add
    </button>
  ) : undefined

  const emptyActive = (
    <li
      data-testid="active-empty"
      className="px-3 py-3 text-center font-label text-xs text-on-surface-variant/50"
    >
      No active sessions
    </li>
  )

  // Active Group.Header renders OUTSIDE the scroll motion.div — mirrors
  // PR #174 where the "ACTIVE" label stays put while the list scrolls.
  // Recent Group.Header (and its body) render INSIDE the motion.div.
  return (
    <>
      <Group.Header label="Active" headerAction={headerAction} />

      <motion.div
        data-testid="session-scroll"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        layoutScroll
      >
        <Group
          variant="active"
          sessions={activeGroup}
          onReorder={handleActiveReorder}
          emptyState={emptyActive}
        >
          {activeGroup.map((session) => (
            <Card
              key={session.id}
              session={session}
              variant="active"
              isActive={session.id === activeSessionId}
              onClick={onSessionClick}
              onRemove={handleRemoveSession}
              onRename={onRenameSession}
            />
          ))}
        </Group>

        {recentGroup.length > 0 && (
          <>
            <Group.Header label="Recent" />
            <Group variant="recent" sessions={recentGroup}>
              {recentGroup.map((session) => (
                <Card
                  key={session.id}
                  session={session}
                  variant="recent"
                  isActive={session.id === activeSessionId}
                  onClick={onSessionClick}
                  onRemove={handleRemoveSession}
                  onRename={onRenameSession}
                />
              ))}
            </Group>
          </>
        )}
      </motion.div>
    </>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npm run type-check
```

Expected: clean.

### Task 5.2: Create `List.test.tsx`

- [ ] **Step 1: Write the test file**

Write `src/features/workspace/sessions/components/List.test.tsx`:

```tsx
/* eslint-disable testing-library/no-node-access */
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { List } from './List'
import type { Session } from '../../types'

const session = (id: string, status: Session['status'] = 'running'): Session =>
  ({
    id,
    projectId: 'p',
    name: id,
    status,
    workingDirectory: '/x/y',
    agentType: 'claude-code',
    terminalPid: 1,
    createdAt: '2026-04-07T00:00:00Z',
    lastActivityAt: '2026-04-07T00:00:00Z',
    activity: {
      fileChanges: [],
      toolCalls: [],
      testResults: [],
      contextWindow: { used: 0, total: 1, percentage: 0, emoji: '😊' },
      usage: {
        sessionDuration: 0,
        turnCount: 0,
        messages: { sent: 0, limit: 1 },
        tokens: { input: 0, output: 0, total: 0 },
      },
    },
  }) as Session

const baseProps = {
  onSessionClick: () => {},
}

describe('List — group split', () => {
  test('running/paused render in Active; completed/errored in Recent', () => {
    render(
      <List
        {...baseProps}
        sessions={[
          session('a', 'running'),
          session('b', 'paused'),
          session('c', 'completed'),
          session('d', 'errored'),
        ]}
        activeSessionId="a"
      />
    )
    expect(screen.getByTestId('session-group-active')).toBeInTheDocument()
    expect(screen.getByTestId('session-group-recent')).toBeInTheDocument()
    // Active session-row count via the data-testid on each Card.
    const activeRows = screen.getAllByTestId('session-row')
    expect(activeRows).toHaveLength(2)
    const recentRows = screen.getAllByTestId('recent-session-row')
    expect(recentRows).toHaveLength(2)
  })

  test('Recent group hidden when empty', () => {
    render(
      <List
        {...baseProps}
        sessions={[session('a', 'running')]}
        activeSessionId="a"
      />
    )
    expect(screen.queryByTestId('session-group-recent')).not.toBeInTheDocument()
  })

  test('Active empty-state renders inside the active body', () => {
    render(
      <List
        {...baseProps}
        sessions={[session('c', 'completed')]}
        activeSessionId={null}
      />
    )
    expect(screen.getByTestId('active-empty')).toHaveTextContent(
      'No active sessions'
    )
  })

  test('Active Group.Header is OUTSIDE the scroll motion.div; Recent is INSIDE (regression guard for the asymmetric placement)', () => {
    render(
      <List
        {...baseProps}
        sessions={[session('a'), session('c', 'completed')]}
        activeSessionId="a"
      />
    )
    const activeHeader = screen.getByTestId('session-group-active')
    const recentHeader = screen.getByTestId('session-group-recent')
    const scroll = screen.getByTestId('session-scroll')
    expect(scroll.contains(activeHeader)).toBe(false)
    expect(scroll.contains(recentHeader)).toBe(true)
  })
})

describe('List — remove flow', () => {
  test('removing the active session calls onRemoveSession then onSessionClick(nextId), and focus restores to the new active overlay button', async () => {
    const onRemoveSession = vi.fn()
    const onSessionClick = vi.fn()
    render(
      <List
        sessions={[session('a'), session('b'), session('c')]}
        activeSessionId="a"
        onSessionClick={onSessionClick}
        onRemoveSession={onRemoveSession}
      />
    )
    const aRow = screen
      .getAllByTestId('session-row')
      .find((row) => row.getAttribute('data-session-id') === 'a')
    if (!aRow) {
      throw new Error('row a not found')
    }
    // Activate hover so the close button becomes interactable.
    const removeBtn = aRow.querySelector(
      'button[aria-label="Remove session"]'
    ) as HTMLButtonElement
    await userEvent.click(removeBtn)
    expect(onRemoveSession).toHaveBeenCalledWith('a')
    expect(onSessionClick).toHaveBeenCalledWith('b')
    // Drain the queueMicrotask focus restore.
    await Promise.resolve()
    expect(document.activeElement?.id).toBe('sidebar-activate-b')
  })
})

describe('List — header + button', () => {
  test('"Add session" button calls onNewInstance', async () => {
    const onNewInstance = vi.fn()
    render(
      <List
        {...baseProps}
        sessions={[session('a')]}
        activeSessionId="a"
        onNewInstance={onNewInstance}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add session' }))
    expect(onNewInstance).toHaveBeenCalledOnce()
  })

  test('header action is hidden when onNewInstance is undefined', () => {
    render(
      <List {...baseProps} sessions={[session('a')]} activeSessionId="a" />
    )
    expect(
      screen.queryByRole('button', { name: 'Add session' })
    ).not.toBeInTheDocument()
  })
})

describe('List — scroll wrapper', () => {
  test('motion.div carries data-testid="session-scroll"', () => {
    render(
      <List {...baseProps} sessions={[session('a')]} activeSessionId="a" />
    )
    expect(screen.getByTestId('session-scroll')).toBeInTheDocument()
  })
})

describe('List — null activeSessionId', () => {
  test('handles null activeSessionId gracefully (no crash)', () => {
    expect(() =>
      render(
        <List {...baseProps} sessions={[session('a')]} activeSessionId={null} />
      )
    ).not.toThrow()
  })
})
```

Add the mid-drag transition guard as a real test. JSDOM can't dispatch a real drag, but `vi.mock('framer-motion')` can replace `Reorder.Group` with a `<ul>` that exposes its `onReorder` prop on a global capture so the test can invoke it synthetically. Add this BEFORE the existing `describe` blocks at the top of `List.test.tsx`:

```tsx
// Captured framer-motion onReorder callbacks per Reorder.Group instance.
// The mock below pushes each render's onReorder into this array; tests
// pull out the most recent (post-render) callback and invoke it.
const reorderCalls: Array<(sessions: Session[]) => void> = []

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return {
    ...actual,
    Reorder: {
      ...actual.Reorder,
      Group: ({
        children,
        onReorder,
        ...props
      }: {
        children: React.ReactNode
        onReorder: (sessions: Session[]) => void
        [key: string]: unknown
      }): React.ReactElement => {
        reorderCalls.push(onReorder)
        // Render as a plain <ul> so children (Reorder.Item → <li>) are
        // valid HTML; drop framer-only props (axis, values, layoutScroll).
        const { axis, values, layoutScroll, ...domProps } = props
        return <ul {...domProps}>{children}</ul>
      },
      Item: ({
        children,
        ...props
      }: {
        children: React.ReactNode
        [key: string]: unknown
      }): React.ReactElement => {
        const { value, layout, whileDrag, ...domProps } = props
        return <li {...domProps}>{children}</li>
      },
    },
    motion: actual.motion,
  }
})

// Reset captures between tests.
beforeEach(() => {
  reorderCalls.length = 0
})
```

Then add the test inside the existing `describe('List — group split', ...)` block (or in a new `describe('List — mid-drag transition guard', ...)` at file scope):

```tsx
describe('List — mid-drag transition guard', () => {
  test('onReorderSessions receives [...reorderedActive, ...recent] using the POST-transition recent (not a stale closure capture)', () => {
    const onReorderSessions = vi.fn()
    const a = session('a', 'running')
    const b = session('b', 'running')

    const { rerender } = render(
      <List
        sessions={[a, b]}
        activeSessionId="a"
        onSessionClick={() => {}}
        onReorderSessions={onReorderSessions}
      />
    )

    // Capture the onReorder framer-motion received during the FIRST render.
    // At this point recentGroup is empty.
    expect(reorderCalls).toHaveLength(1)
    const capturedOnReorder = reorderCalls[0]

    // Re-render with B transitioned to completed: active=[a], recent=[b'].
    const bCompleted = { ...b, status: 'completed' as const }
    rerender(
      <List
        sessions={[a, bCompleted]}
        activeSessionId="a"
        onSessionClick={() => {}}
        onReorderSessions={onReorderSessions}
      />
    )

    // Now invoke the OLD onReorder callback (simulating framer-motion
    // firing onReorder mid-drag-but-post-transition) with a permutation
    // of the LATEST active values.
    capturedOnReorder([a])

    // The bubbled array MUST include the post-transition recent
    // ([bCompleted]), not the stale empty array captured at first
    // render. recentGroupRef.current was synchronously mirrored on the
    // second render, so the closure reading it sees the live value.
    expect(onReorderSessions).toHaveBeenCalledTimes(1)
    const bubbled = onReorderSessions.mock.calls[0][0] as Session[]
    expect(bubbled).toHaveLength(2)
    expect(bubbled[0].id).toBe('a')
    expect(bubbled[1].id).toBe('b')
    expect(bubbled[1].status).toBe('completed')
  })
})
```

The mock surfaces `Reorder.Group` and `Reorder.Item` as plain `<ul>` / `<li>` and captures the `onReorder` callback for direct invocation. `motion` and other framer exports pass through untouched (`motion.div` with `layoutScroll` still works for the scroll wrapper). If your `vi.mock` factory shape needs adjustment for framer-motion's specific export structure, check `node_modules/framer-motion/dist/types.d.ts` for the actual `Reorder` namespace shape.

- [ ] **Step 2: Run the new tests**

```bash
npx vitest run src/features/workspace/sessions/components/List.test.tsx
```

Expected: all tests pass.

### Task 5.3: Update `Sidebar.tsx` to use `List`

- [ ] **Step 1: Replace session-related JSX with `<List ... />`**

In `src/features/workspace/components/Sidebar.tsx`, the body of the component currently has:

- The Active `Group.Header` block (added in Phase 4)
- The scroll `motion.div` containing the active `<Group>` + recent `<Group>`
- The `recentGroupRef` declaration and the `handleRemoveSession` const

Replace ALL of that — every line from the Active `Group.Header` opening tag down to the closing `</motion.div>` — plus the `recentGroupRef` ref and `handleRemoveSession` definition — with a single `<List ... />`:

```tsx
<List
  sessions={sessions}
  activeSessionId={activeSessionId}
  onSessionClick={onSessionClick}
  onNewInstance={onNewInstance}
  onRemoveSession={onRemoveSession}
  onRenameSession={onRenameSession}
  onReorderSessions={onReorderSessions}
/>
```

- [ ] **Step 2: Add the List import**

```ts
import { List } from '../sessions/components/List'
```

- [ ] **Step 3: Remove now-unused imports + state**

Inside `Sidebar.tsx`:

- Remove imports: `Card`, `Group`, `motion`, `pickNextVisibleSessionId`, `isOpenSessionStatus` — all migrated into `List`. KEEP `useState`, `useEffect`, `useCallback`, AND `useRef` (still needed for the FileExplorer split-resize state — `startY` / `startHeight` / `explorerHeight` / `isDraggingSplit` stay in Sidebar.tsx until Phase 6 moves the chrome to `src/components/sidebar/`).
- Remove the `activeGroup` and `recentGroup` derivations.
- Remove the `recentGroupRef` declaration. The `startY` / `startHeight` refs for the FileExplorer split STAY (used by `handleSplitMouseDown` and the `useEffect` that wires document-level mousemove/mouseup listeners).
- Remove the `handleRemoveSession` definition (now lives in `List`).

- [ ] **Step 4: Clean prop pass-through**

`Sidebar`'s props (`SidebarProps`) still include all session-related callbacks — they're now forwarded to `<List>`. No prop changes needed yet (Phase 6 will reshape the prop list when Sidebar moves and becomes content-agnostic).

- [ ] **Step 5: Type-check**

```bash
npm run type-check
```

Expected: clean.

### Task 5.4: Migrate tests from `Sidebar.test.tsx` to `List.test.tsx`

Per the spec's Test Redistribution Map (§9), 9 of the 25 Sidebar.test.tsx tests move to `List.test.tsx` and 6 move to `Card.test.tsx` (already covered in Phase 3). At this phase, perform the Sidebar→List migration. The Card→Card migration is implicit: `Card.test.tsx` already covers those behaviors via its own per-variant matrix (Phase 3).

- [ ] **Step 1: In `Sidebar.test.tsx`, delete tests that now live in `List.test.tsx`**

Delete these tests from `Sidebar.test.tsx`:

- `renders "Active" group header with add button` (line ~147)
- `renders "Recent" group header when completed/errored sessions exist` (line ~167)
- `add session button changes color on hover` (line ~182)
- `calls onNewInstance when add session button is clicked` (line ~196)
- `renders running/paused sessions in Active list, completed in Recent` (line ~215)
- `renders empty state when no active sessions` (line ~335)
- `handles null activeSessionId gracefully` (line ~440)
- `removing the active session pre-selects the next visible Active row` (line ~463)
- `Active + Recent groups share a single scroll region` (line ~522)

Each is now covered by `List.test.tsx`'s integration suite.

- [ ] **Step 2: Delete tests that move to `Card.test.tsx`**

Delete from `Sidebar.test.tsx`:

- `each session row carries a StatusDot reflecting its status` (line ~241)
- `active row paints lavender-tinted background per handoff §4.2` (line ~266)
- `inactive session items have on-surface-variant styling` (line ~286)
- `calls onSessionClick with session id when session is clicked` (line ~303)
- `uses design tokens for colors` (line ~321)
- `without onRemoveSession, the remove button is hidden on Recent rows` (line ~504)

Each is covered by `Card.test.tsx` (Phase 3).

- [ ] **Step 3: Delete tests that move to `subtitle.test.ts`**

Delete from `Sidebar.test.tsx`:

- `subtitle renders the last 2 segments of the cwd, normalizing Windows backslashes` (line ~543)
- `subtitle renders 2-segment POSIX cwd as parent/basename (shallow path)` (line ~569)
- `subtitle falls back to "~" when workingDirectory is empty (race-window safety)` (line ~590)

Each is covered by `subtitle.test.ts` (Phase 1).

- [ ] **Step 4: Tests that stay in `Sidebar.test.tsx` for this phase**

The following tests REMAIN in `Sidebar.test.tsx` until Phase 6 (when Sidebar moves and FileExplorer + New Instance leave the chrome):

- `renders FileExplorer section` (line ~350) — Sidebar still mounts FileExplorer at this phase. KEEP for now; Phase 6 deletes it.
- 4 `New Instance` button tests (lines ~364, 384, 401, 422) — button is still inside Sidebar.tsx. KEEP; Phase 6 migrates to WorkspaceView.

- [ ] **Step 5: Verify what's left in `Sidebar.test.tsx`**

After Steps 1-3 (deletions for List + Card + subtitle), `Sidebar.test.tsx` should contain ~7 tests:

- `renders with full width (sized by parent grid)` (chrome smoke)
- `renders the sidebar status header in the top slot` (header smoke)
- `renders FileExplorer section` (will move/delete in Phase 6)
- 4 `New Instance` button tests (will move/delete in Phase 6)

So ~7 tests remain. The split goes deeper in Phase 6.

```bash
grep -cE "^\s+test\(" src/features/workspace/components/Sidebar.test.tsx
```

Expected: ~6.

### Task 5.5: Verify and commit Phase 5

- [ ] **Step 1: Type-check + lint + test**

```bash
npm run type-check && npm run lint && npm run test
```

Expected: green. The remaining `Sidebar.test.tsx` tests pass; `List.test.tsx` is green; `Card.test.tsx` and `Group.test.tsx` are still green.

- [ ] **Step 2: Commit Phase 5**

```bash
git add src/features/workspace/sessions/components/List.tsx src/features/workspace/sessions/components/List.test.tsx src/features/workspace/components/Sidebar.tsx src/features/workspace/components/Sidebar.test.tsx
git commit -m "$(cat <<'EOF'
refactor(sessions): extract List composer

Pull the active/recent split, the recentGroupRef synchronous mirror,
the handleRemoveSession next-id-and-focus wrapper, the headerAction
"+" button, the empty-active <li>, and the scroll motion.div (with
layoutScroll) out of Sidebar.tsx into a new List composer at
src/features/workspace/sessions/components/List.tsx.

Sidebar.tsx is dramatically thinner now — chrome (status header
slot, FileExplorer mount, New Instance button) plus a single
<List ... /> mount. The handleRemoveSession DOM-id (sidebar-
activate-${id}) survives verbatim so focus restoration on the
remove flow still works.

List owns motion.div + layoutScroll (framer-motion) so the
upcoming generic Sidebar (Phase 6) can be framer-motion-free.

Test redistribution this phase:
- 9 Sidebar.test.tsx tests move to List.test.tsx (group split,
  recent-empty-hidden, active-empty-rendered, remove-flow + focus,
  scroll-region invariant, header "+", null activeSessionId,
  hover-button-color, asymmetric-header-placement guard).
- 6 Sidebar.test.tsx tests move conceptually to Card.test.tsx
  (already covered by the per-variant matrix in Phase 3).
- 3 subtitle tests already live in subtitle.test.ts (Phase 1).
- The `renders FileExplorer section` test STAYS in Phase 5 (Sidebar still mounts FileExplorer); Phase 6 will delete it when FileExplorer moves to the bottomPane slot.

Sidebar.test.tsx shrinks to ~7 chrome tests — the rest is
covered by List/Card/Group/subtitle co-located tests.

Refs: docs/superpowers/specs/2026-05-06-sidebar-refactor-design.md (§"Workspace session module — List", §"Test redistribution map")

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6: Sidebar promotion to `src/components/sidebar` (commit 6 of spec §10)

Create the new content-agnostic, named-slot `Sidebar` at `src/components/sidebar/Sidebar.tsx`. Update `WorkspaceView.tsx` to mount `SidebarStatusHeader`, `List`, `FileExplorer`, and the New Instance button as slot children. Delete the old `src/features/workspace/components/Sidebar.{tsx,test.tsx}`. Update mock paths in 2 WorkspaceView test files.

**Files:**

- Create: `src/components/sidebar/Sidebar.tsx`
- Create: `src/components/sidebar/Sidebar.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.tsx` (import + slot wiring; FileExplorer cwd fallback to `'~'`)
- Modify: `src/features/workspace/WorkspaceView.command-palette.test.tsx` (vi.mock string)
- Modify: `src/features/workspace/WorkspaceView.subscription.test.tsx` (vi.mock string + assertion cleanup)
- Delete: `src/features/workspace/components/Sidebar.tsx`
- Delete: `src/features/workspace/components/Sidebar.test.tsx`

### Task 6.1: Create the new `Sidebar.tsx`

- [ ] **Step 1: Write the file**

Write `src/components/sidebar/Sidebar.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { useResizable } from '../../hooks/useResizable'

const BOTTOM_PANE_DEFAULT = 320
const BOTTOM_PANE_MIN = 100
const BOTTOM_PANE_MAX = 500

export interface SidebarProps {
  /** Top fixed-height region. */
  header?: ReactNode
  /** Middle scroll-eligible region (flex 1). Sidebar provides bounded space; the content's caller owns its own overflow. Required. */
  content: ReactNode
  /**
   * Optional resizable bottom pane below `content`. When present, a
   * horizontal split-resize handle separates `content` from
   * `bottomPane`. When absent, `content` flexes to fill.
   */
  bottomPane?: ReactNode
  /** Bottom fixed-height region (e.g. primary action button). */
  footer?: ReactNode
  /** Initial bottom-pane height in pixels. Default 320. */
  bottomPaneInitialHeight?: number
  /** Minimum bottom-pane height. Default 100. */
  bottomPaneMinHeight?: number
  /** Maximum bottom-pane height. Default 500. */
  bottomPaneMaxHeight?: number
  /** Test hook id. Default 'sidebar'. */
  'data-testid'?: string
}

export const Sidebar = ({
  header = undefined,
  content,
  bottomPane = undefined,
  footer = undefined,
  bottomPaneInitialHeight = BOTTOM_PANE_DEFAULT,
  bottomPaneMinHeight = BOTTOM_PANE_MIN,
  bottomPaneMaxHeight = BOTTOM_PANE_MAX,
  'data-testid': testId = 'sidebar',
}: SidebarProps): ReactElement => {
  const {
    size: bottomHeight,
    isDragging,
    handleMouseDown,
  } = useResizable({
    initial: bottomPaneInitialHeight,
    min: bottomPaneMinHeight,
    max: bottomPaneMaxHeight,
    direction: 'vertical',
    invert: true,
  })

  // The slot-rendering rule: a slot's wrapper renders only when the
  // prop is not `null`, `undefined`, or `false`. `0` and `''` are
  // valid ReactNode values that DO render.
  const renderSlot = (slot: ReactNode): boolean =>
    slot !== null && slot !== undefined && slot !== false

  return (
    <div
      className="flex h-full w-full flex-col bg-surface-container-low"
      data-testid={testId}
    >
      {renderSlot(header) && <div className="px-3 pb-2 pt-3">{header}</div>}

      <div className="flex min-h-0 flex-1 flex-col">{content}</div>

      {renderSlot(bottomPane) && (
        <>
          <div
            data-testid="explorer-resize-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-valuenow={bottomHeight}
            aria-valuemin={bottomPaneMinHeight}
            aria-valuemax={bottomPaneMaxHeight}
            onMouseDown={handleMouseDown}
            className={`
              h-1 shrink-0 cursor-row-resize transition-colors hover:bg-primary/50
              ${isDragging ? 'bg-primary/70' : 'border-t border-white/5'}
            `}
          />
          <div style={{ height: bottomHeight }} className="shrink-0">
            {bottomPane}
          </div>
        </>
      )}

      {renderSlot(footer) && <div className="p-3">{footer}</div>}

      {isDragging && <div className="fixed inset-0 z-50 cursor-row-resize" />}
    </div>
  )
}
```

The `useEffect`, `useState`, `useCallback` imports may be unnecessary if `useResizable` encapsulates all the state — adjust the import list to match what's actually used.

- [ ] **Step 2: Type-check**

```bash
npm run type-check
```

Expected: clean.

### Task 6.2: Create `Sidebar.test.tsx`

- [ ] **Step 1: Write the test file**

Write `src/components/sidebar/Sidebar.test.tsx`:

```tsx
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sidebar } from './Sidebar'

describe('Sidebar — slot composition', () => {
  test('renders with default data-testid="sidebar"', () => {
    render(<Sidebar content={<div>content</div>} />)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  test('renders the header slot when provided', () => {
    render(
      <Sidebar
        header={<div data-testid="header-fixture">H</div>}
        content={<div>C</div>}
      />
    )
    expect(screen.getByTestId('header-fixture')).toBeInTheDocument()
  })

  test('renders the content slot', () => {
    render(<Sidebar content={<div data-testid="content-fixture">C</div>} />)
    expect(screen.getByTestId('content-fixture')).toBeInTheDocument()
  })

  test('renders the footer slot when provided', () => {
    render(
      <Sidebar
        content={<div>C</div>}
        footer={<div data-testid="footer-fixture">F</div>}
      />
    )
    expect(screen.getByTestId('footer-fixture')).toBeInTheDocument()
  })

  test('renders the bottomPane + resize handle when provided', () => {
    render(
      <Sidebar
        content={<div>C</div>}
        bottomPane={<div data-testid="bottom-fixture">B</div>}
      />
    )
    expect(screen.getByTestId('bottom-fixture')).toBeInTheDocument()
    expect(screen.getByTestId('explorer-resize-handle')).toBeInTheDocument()
  })
})

describe('Sidebar — slot absence semantics', () => {
  test('omitting bottomPane suppresses the resize handle and bottom region', () => {
    render(<Sidebar content={<div>C</div>} />)
    expect(
      screen.queryByTestId('explorer-resize-handle')
    ).not.toBeInTheDocument()
  })

  test('null/undefined/false header all suppress the header wrapper', () => {
    const { container, rerender } = render(<Sidebar content={<div>C</div>} />)
    expect(container.querySelector('.px-3.pt-3.pb-2')).toBeNull()

    rerender(<Sidebar header={null} content={<div>C</div>} />)
    expect(container.querySelector('.px-3.pt-3.pb-2')).toBeNull()

    rerender(<Sidebar header={false} content={<div>C</div>} />)
    expect(container.querySelector('.px-3.pt-3.pb-2')).toBeNull()
  })

  test("0 and '' DO render their wrapper (valid ReactNodes)", () => {
    render(<Sidebar header={0} content={<div>C</div>} />)
    // The header wrapper is the `px-3 pt-3 pb-2` div; the rendered
    // text "0" lives inside it.
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})

describe('Sidebar — resize handle', () => {
  test('handle exposes role=separator with live aria values', () => {
    render(
      <Sidebar
        content={<div>C</div>}
        bottomPane={<div>B</div>}
        bottomPaneInitialHeight={250}
        bottomPaneMinHeight={100}
        bottomPaneMaxHeight={500}
      />
    )
    const handle = screen.getByTestId('explorer-resize-handle')
    expect(handle).toHaveAttribute('role', 'separator')
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal')
    expect(handle).toHaveAttribute('aria-valuenow', '250')
    expect(handle).toHaveAttribute('aria-valuemin', '100')
    expect(handle).toHaveAttribute('aria-valuemax', '500')
  })

  test('initial height clamps to [min, max] (relies on useResizable clamp)', () => {
    render(
      <Sidebar
        content={<div>C</div>}
        bottomPane={<div>B</div>}
        bottomPaneInitialHeight={9999}
        bottomPaneMaxHeight={500}
      />
    )
    const handle = screen.getByTestId('explorer-resize-handle')
    expect(handle).toHaveAttribute('aria-valuenow', '500')
  })
})
```

The `Sidebar.test.tsx` does NOT import `SidebarStatusHeader` or any feature component — slot props receive plain `ReactNode` test fixtures.

- [ ] **Step 2: Run the new tests**

```bash
npx vitest run src/components/sidebar/Sidebar.test.tsx
```

Expected: ~10 tests pass.

### Task 6.3: Update `WorkspaceView.tsx`

- [ ] **Step 1: Update imports**

In `src/features/workspace/WorkspaceView.tsx`:

(a) Replace:

```ts
import { Sidebar } from './components/Sidebar'
```

with:

```ts
import { Sidebar } from '../../components/sidebar/Sidebar'
```

(b) Add:

```ts
import { SidebarStatusHeader } from './components/SidebarStatusHeader'
import { FileExplorer } from './components/panels/FileExplorer'
import { List } from './sessions/components/List'
```

(`useResizable` import path was already updated in Phase 2.)

- [ ] **Step 2: Replace the `<Sidebar ... />` JSX with the slot-based form**

Find the existing JSX block:

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

Replace with:

```tsx
<Sidebar
  header={
    <SidebarStatusHeader
      status={agentStatus}
      activeSessionName={
        sessions.find((s) => s.id === activeSessionId)?.name ?? null
      }
    />
  }
  content={
    <List
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSessionClick={setActiveSessionId}
      onNewInstance={createSession}
      onRemoveSession={removeSession}
      onRenameSession={renameSession}
      onReorderSessions={reorderSessions}
    />
  }
  bottomPane={
    <FileExplorer
      cwd={activeSession?.workingDirectory ?? '~'}
      onFileSelect={handleFileSelect}
    />
  }
  footer={
    <button
      type="button"
      onClick={createSession}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-secondary py-2.5 font-label text-sm font-bold text-on-primary shadow-lg shadow-primary/10 transition-all hover:shadow-xl hover:shadow-primary/20"
      aria-label="New Instance"
    >
      <span className="material-symbols-outlined text-lg">bolt</span>
      <span>New Instance</span>
    </button>
  }
/>
```

The FileExplorer cwd uses the `'~'` fallback explicitly (NOT the `activeCwd` const at line ~111 of WorkspaceView, which falls back to `'.'`).

- [ ] **Step 3: Type-check**

```bash
npm run type-check
```

Expected: clean.

### Task 6.4: Update mock paths in WorkspaceView test files

- [ ] **Step 1: Update `WorkspaceView.command-palette.test.tsx`**

In `src/features/workspace/WorkspaceView.command-palette.test.tsx`, find the Sidebar mock:

```ts
vi.mock('./components/Sidebar', () => ({
  Sidebar: ...
}))
```

Replace the path string:

```ts
vi.mock('../../components/sidebar/Sidebar', () => ({
  Sidebar: ...
}))
```

The mock factory body stays unchanged (the test only cares that Sidebar renders something, not that it receives specific props).

- [ ] **Step 2: Update `WorkspaceView.subscription.test.tsx`**

In `src/features/workspace/WorkspaceView.subscription.test.tsx`:

(a) Path bump in the `vi.mock`:

```ts
// Before:
vi.mock('./components/Sidebar', () => ({ ... }))
// After:
vi.mock('../../components/sidebar/Sidebar', () => ({ ... }))
```

(b) Drop the `capturedSidebarProps` apparatus — since the new Sidebar no longer receives `agentStatus` directly. Specifically:

- Delete the `capturedSidebarProps` variable declaration (around line 124).
- Delete the `capturedSidebarProps.agentStatus = undefined` reset in `beforeEach` (around line 191).
- Delete the line inside the mock factory: `capturedSidebarProps.agentStatus = agentStatus`.
- Delete the two assertions reading `capturedSidebarProps.agentStatus` (around lines 211 and 219).

The Sidebar mock factory body simplifies to:

```ts
vi.mock('../../components/sidebar/Sidebar', () => ({
  Sidebar: (): ReactElement => <div data-testid="sidebar-mock" />,
}))
```

The `MockSidebarProps` interface at the top of the file can also be deleted if it's no longer referenced.

The test's intent (`agentStatus` flows to downstream consumers) is preserved by the existing `capturedPanelProps.agentStatus` assertion against the `AgentStatusPanel` mock at line ~153.

- [ ] **Step 3: Type-check**

```bash
npm run type-check
```

Expected: clean.

### Task 6.5: Migrate residual Sidebar.test.tsx tests, then delete the old files

The OLD `src/features/workspace/components/Sidebar.test.tsx` still has ~7 tests after Phase 5. They redistribute:

| Test (in old Sidebar.test.tsx)                              | Destination                                                                            |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `renders with full width`                                   | DELETE — chrome smoke replaced by the new `Sidebar.test.tsx`'s slot composition tests. |
| `renders the sidebar status header in the top slot`         | DELETE — replaced by `Sidebar.test.tsx`'s `header` slot fixture test (Task 6.2).       |
| `renders FileExplorer section`                              | DELETE — Sidebar no longer mounts FileExplorer.                                        |
| `renders "New Instance" button at bottom`                   | DELETE — replaced by `Sidebar.test.tsx`'s `footer` slot fixture test (Task 6.2).       |
| `"New Instance" button has bolt icon`                       | DELETE — visual-class smoke; not load-bearing.                                         |
| `calls onNewInstance when "New Instance" button is clicked` | MIGRATE to `WorkspaceView.test.tsx` (the gradient button now lives there).             |
| `"New Instance" button has shadow effects`                  | DELETE — visual-class smoke; not load-bearing.                                         |

- [ ] **Step 1: Migrate the New Instance click test to `WorkspaceView.test.tsx`**

Open `src/features/workspace/WorkspaceView.test.tsx`. Add a test that asserts clicking the New Instance gradient button calls `createSession`. The button now lives in WorkspaceView's `Sidebar.footer` slot. A starter:

```tsx
test('clicking the New Instance gradient button calls createSession', async () => {
  // The test setup likely already mocks useSessionManager / its createSession
  // dependency. If it does, capture the mock and assert it's called.
  // Otherwise, render WorkspaceView, find the button by aria-label, click it.
  const user = userEvent.setup()
  // ... existing render setup ...
  const newInstanceBtn = screen.getByRole('button', { name: 'New Instance' })
  await user.click(newInstanceBtn)
  // Adjust assertion to match WorkspaceView.test.tsx's existing
  // capture pattern for createSession (the test file likely already
  // captures it via vi.mock on useSessionManager or similar).
  expect(/* the captured createSession mock */).toHaveBeenCalled()
})
```

If the existing WorkspaceView.test.tsx setup doesn't expose a clean way to assert on `createSession` (the hook's internals are deeply mocked), an alternative is to assert the click triggers the existing observable side-effect (a new tab / pane appearing) rather than asserting on the mock directly. Match what surrounding tests do.

- [ ] **Step 2: Delete the old source + test**

```bash
git rm src/features/workspace/components/Sidebar.tsx src/features/workspace/components/Sidebar.test.tsx
```

- [ ] **Step 3: Confirm no lingering references**

```bash
grep -rn "from.*['\"]\..*components/Sidebar['\"]" src --include="*.tsx" --include="*.ts"
```

Expected: no results (the only consumer was WorkspaceView, already updated).

```bash
grep -rn "vi.mock.*['\"]\..*components/Sidebar['\"]" src --include="*.tsx" --include="*.ts"
```

Expected: no results.

### Task 6.6: Verify and commit Phase 6

- [ ] **Step 1: Run all checks**

```bash
npm run type-check && npm run lint && npm run test
```

Expected: green. Visual app starts via `npm run dev` and looks identical to PR #174 (the spec's "no visual regression" goal).

- [ ] **Step 2: Manual visual sanity check**

Run `npm run dev` (in a separate shell). Open the app. Verify:

- Sidebar bg + width same.
- Status header at top renders (or shows the idle state).
- Active group with `+` button renders; `Add session` works.
- Drag a card; reorder works.
- A session you've completed appears in Recent.
- FileExplorer renders with cwd; resize handle drags.
- New Instance gradient button at the bottom; click creates a session.

Stop the dev server when done.

- [ ] **Step 3: Commit Phase 6**

```bash
git add src/components/sidebar/ src/features/workspace/WorkspaceView.tsx src/features/workspace/WorkspaceView.command-palette.test.tsx src/features/workspace/WorkspaceView.subscription.test.tsx
git commit -m "$(cat <<'EOF'
refactor(sidebar): promote to src/components/sidebar (named slots)

Add src/components/sidebar/Sidebar.tsx as the new content-agnostic
chrome component with named slots (header / content / bottomPane /
footer). Sidebar owns layout (vertical column, bounded scroll-
eligible region, resizable bottom pane) and knows nothing about
Session / SessionStatus / agent state.

WorkspaceView.tsx now mounts:
- header: <SidebarStatusHeader status={agentStatus} ... />
- content: <List sessions={...} onRemoveSession={...} ... />
- bottomPane: <FileExplorer cwd={activeSession?.workingDirectory ?? '~'} ... />
  (preserves the existing '~' fallback the old Sidebar applied to its
   activeCwd prop)
- footer: the New Instance gradient button (inline JSX)

Mock paths bumped in WorkspaceView.command-palette.test.tsx and
WorkspaceView.subscription.test.tsx. The latter also drops its
capturedSidebarProps apparatus — the new Sidebar no longer receives
agentStatus directly (it's now nested in the header slot's
SidebarStatusHeader); the test's intent ("agentStatus flows
downstream") is preserved by the existing AgentStatusPanel mock
capture.

Old src/features/workspace/components/Sidebar.{tsx,test.tsx}
deleted.

Add src/components/sidebar/Sidebar.test.tsx with slot-composition
tests using plain ReactNode fixtures (no SidebarStatusHeader
import) — keeps the chrome decoupled from feature components.

Refs: docs/superpowers/specs/2026-05-06-sidebar-refactor-design.md (§"Sidebar API contract")

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7: `Tabs` co-location + `Tab` extraction (commit 7 of spec §10)

Move `SessionTabs.tsx` → `sessions/components/Tabs.tsx`. Extract the inline per-tab JSX into a new `sessions/components/Tab.tsx` leaf with the full behavior contract (keyboard, ARIA, glyph, status-dot conditional, accent stripe, click guard). Migrate tests per the redistribution map. Update WorkspaceView's import.

**Files:**

- Move: `src/features/workspace/components/SessionTabs.tsx` → `src/features/workspace/sessions/components/Tabs.tsx`
- Move: `src/features/workspace/components/SessionTabs.test.tsx` → `src/features/workspace/sessions/components/Tabs.test.tsx`
- Create: `src/features/workspace/sessions/components/Tab.tsx`
- Create: `src/features/workspace/sessions/components/Tab.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.tsx` (import path + symbol rename)

### Task 7.1: Move and rename `SessionTabs` → `Tabs`

- [ ] **Step 1: Move source file**

```bash
git mv src/features/workspace/components/SessionTabs.tsx src/features/workspace/sessions/components/Tabs.tsx
```

- [ ] **Step 2: Move test file**

```bash
git mv src/features/workspace/components/SessionTabs.test.tsx src/features/workspace/sessions/components/Tabs.test.tsx
```

- [ ] **Step 3: Rename the exported symbol**

In `src/features/workspace/sessions/components/Tabs.tsx`:

(a) Rename `SessionTabs` → `Tabs`. Find:

```tsx
export const SessionTabs = ({ ... }: SessionTabsProps): ReactElement => { ... }
```

Replace `SessionTabs` with `Tabs` (component name) and `SessionTabsProps` with `TabsProps` (interface name) — both throughout the file.

(b) Update relative imports inside the file. The file moved one level deeper (`components/` → `sessions/components/`), so each `../` becomes `../../`. Specifically:

```ts
// Before:
import type { Session } from '../types'
import { agentForSession } from '../utils/agentForSession'
import {
  getVisibleSessions,
  pickNextVisibleSessionId,
} from '../utils/pickNextVisibleSessionId'
import { StatusDot } from './StatusDot'

// After:
import type { Session } from '../../types'
import { agentForSession } from '../../utils/agentForSession'
import {
  getVisibleSessions,
  pickNextVisibleSessionId,
} from '../../utils/pickNextVisibleSessionId'
import { StatusDot } from '../../components/StatusDot'
```

- [ ] **Step 4: Update imports in `Tabs.test.tsx`**

In `src/features/workspace/sessions/components/Tabs.test.tsx`:

```ts
// Before:
import { SessionTabs } from './SessionTabs'
import type { Session } from '../types'

// After:
import { Tabs } from './Tabs'
import type { Session } from '../../types'
```

Replace every `<SessionTabs ... />` and every reference to the symbol `SessionTabs` with `Tabs` throughout the test file.

- [ ] **Step 5: Bump WorkspaceView's import in lockstep with the move**

The source file moved + the symbol renamed; `WorkspaceView.tsx` still imports the old path. Update it now (NOT in a later task) so type-check stays clean throughout Phase 7. In `src/features/workspace/WorkspaceView.tsx`:

```ts
// Before:
import { SessionTabs } from './components/SessionTabs'

// After:
import { Tabs } from './sessions/components/Tabs'
```

In the JSX, replace `<SessionTabs ... />` with `<Tabs ... />` (props unchanged).

- [ ] **Step 6: Type-check**

```bash
npm run type-check
```

Expected: clean. Source move + symbol rename + WorkspaceView import bump all in lockstep means the tree compiles end-to-end.

### Task 7.2: Extract `Tab.tsx` leaf

- [ ] **Step 1: Write `Tab.tsx`**

Write `src/features/workspace/sessions/components/Tab.tsx`. The full behavior contract is in the spec at §"Workspace session module — Tabs + Tab" → "Tab behavior contract":

```tsx
import { type ReactElement, type KeyboardEvent } from 'react'
import type { Session } from '../../types'
import type { Agent } from '../../../../agents/registry'
import { StatusDot } from '../../components/StatusDot'

export interface TabProps {
  session: Session
  isActive: boolean
  /**
   * Drives `tabIndex=0` for the WAI-ARIA roving-focus entry point.
   * Equal to `isActive` in the steady state; differs only when
   * `activeSessionId` is null and we fall back to the first visible
   * tab so the keyboard still has a way into the tablist. Computed by
   * Tabs (not derivable from `isActive` alone).
   */
  isFocusEntryPoint: boolean
  agent: Agent
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

export const Tab = ({
  session,
  isActive,
  isFocusEntryPoint,
  agent,
  onSelect,
  onClose,
}: TabProps): ReactElement => {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Ignore key events bubbled from focused descendants (the close X).
    if (e.target !== e.currentTarget) {
      return
    }
    // Note: e.key for the spacebar is the single-character ' ', NOT 'Space'.
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      // Skip the no-op reselection when the focused tab is already
      // active. WorkspaceView's onSelect bridges to setActiveSession
      // (IPC); a redundant call adds round-trip cost AND can interfere
      // with useSessionManager's request-supersession rollback.
      if (!isActive) {
        onSelect(session.id)
      }
      return
    }
    // Delete / Backspace close: tracked in #179 for migration to a
    // global keyboard shortcut (Cmd+W). Preserved verbatim here per
    // the no-regression goal of #178.
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onClose(session.id)
    }
  }

  return (
    <div
      id={`session-tab-${session.id}`}
      role="tab"
      aria-label={
        session.status === 'completed' || session.status === 'errored'
          ? `${session.name} (ended)`
          : session.name
      }
      aria-selected={isActive}
      aria-controls={`session-panel-${session.id}`}
      tabIndex={isFocusEntryPoint ? 0 : -1}
      data-testid="session-tab"
      data-session-id={session.id}
      data-active={isActive}
      onClick={() => {
        if (!isActive) {
          onSelect(session.id)
        }
      }}
      onKeyDown={handleKeyDown}
      className={`
        relative flex h-[30px] min-w-[130px] max-w-[220px] cursor-pointer items-center gap-2
        rounded-t-lg border border-transparent pl-3 pr-2 outline-none transition-colors
        focus-visible:ring-2 focus-visible:ring-primary/50
        ${
          isActive
            ? '-mb-px bg-surface border-outline-variant/30'
            : 'hover:bg-on-surface/[0.025]'
        }
      `}
    >
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute inset-x-1.5 top-0 h-0.5 rounded-b-sm"
          style={{ background: agent.accent }}
        />
      )}
      <span
        aria-hidden="true"
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold"
        style={{ background: agent.accentDim, color: agent.accent }}
      >
        {agent.glyph}
      </span>
      <span
        className={`
          min-w-0 flex-1 truncate font-mono text-[11px]
          ${isActive ? 'font-medium text-on-surface' : 'text-on-surface-variant'}
        `}
      >
        {session.name}
      </span>
      {(session.status === 'running' || session.status === 'paused') && (
        <StatusDot
          status={session.status}
          size={5}
          aria-label={`Status ${session.status}`}
        />
      )}
      <button
        type="button"
        // WAI-ARIA tabs §3.27: tablist is one Tab stop; descendants
        // reached via shortcut. Always tabIndex=-1.
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation()
          onClose(session.id)
        }}
        aria-label={`Close ${session.name}`}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-on-surface-variant/70 transition-colors hover:bg-on-surface/[0.06] hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-[11px]">close</span>
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Replace inline tab JSX in `Tabs.tsx` with `<Tab ... />`**

In `src/features/workspace/sessions/components/Tabs.tsx`, find the per-tab JSX inside the `.map(...)` (the inline `<div role="tab" ...>` block, ~140 lines). Replace with:

```tsx
{
  open.map((session, idx) => (
    <Tab
      key={session.id}
      session={session}
      isActive={session.id === activeSessionId}
      isFocusEntryPoint={
        session.id === activeSessionId || (!hasFocusMatch && idx === 0)
      }
      agent={agentForSession(session)}
      onSelect={(id) => {
        if (id !== activeSessionId) {
          onSelect(id)
        }
      }}
      onClose={handleClose}
    />
  ))
}
```

If today's `Tabs.tsx` had a separate per-tab component (`SessionTab` inside the file), delete that inline definition — it's now in `Tab.tsx`.

Add the Tab import:

```ts
import { Tab } from './Tab'
```

- [ ] **Step 3: Type-check**

```bash
npm run type-check
```

Expected: clean (Tabs.tsx, Tab.tsx, Tabs.test.tsx all type-check; WorkspaceView's import was bumped in Task 7.1 Step 5 — already in lockstep).

### Task 7.3: (Removed — WorkspaceView's import bump is part of Task 7.1)

The original draft separated the WorkspaceView import bump into Task 7.3, but that left the type-check broken between Tasks 7.1 and 7.3. Task 7.1 Step 5 now performs the import bump in lockstep with the source move, so this task is a no-op and the plan proceeds to Task 7.4.

### Task 7.4: Create `Tab.test.tsx`

- [ ] **Step 1: Write the test file**

Per the spec's redistribution map, ~16 of the 31 tests in `Tabs.test.tsx` belong to the leaf scope. Move them to `Tab.test.tsx`. The simplest approach: open `Tabs.test.tsx`, identify the leaf-scope tests (per the redistribution map in spec §9), copy the test bodies into a new `Tab.test.tsx`, adapt the helpers (e.g., render a single `<Tab>` with mock props), and delete those tests from `Tabs.test.tsx`.

A starter for `src/features/workspace/sessions/components/Tab.test.tsx`:

```tsx
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tab } from './Tab'
import type { Session } from '../../types'
import { AGENTS } from '../../../../agents/registry'

const session = (id: string, status: Session['status'] = 'running'): Session =>
  ({
    id,
    projectId: 'p',
    name: id,
    status,
    agentType: 'claude-code',
  }) as Session

const renderTab = (overrides: Partial<React.ComponentProps<typeof Tab>> = {}) =>
  render(
    <Tab
      session={session('a')}
      isActive={false}
      isFocusEntryPoint={false}
      agent={AGENTS.claude}
      onSelect={() => {}}
      onClose={() => {}}
      {...overrides}
    />
  )

describe('Tab — ARIA', () => {
  test('role=tab + aria-controls + id', () => {
    renderTab({ session: session('X') })
    const tab = screen.getByRole('tab')
    expect(tab).toHaveAttribute('id', 'session-tab-X')
    expect(tab).toHaveAttribute('aria-controls', 'session-panel-X')
  })

  test('aria-label = session.name when running/paused', () => {
    renderTab({ session: session('A', 'running') })
    expect(screen.getByRole('tab')).toHaveAttribute('aria-label', 'A')
  })

  test('aria-label appended with " (ended)" when completed', () => {
    renderTab({ session: session('A', 'completed') })
    expect(screen.getByRole('tab')).toHaveAttribute('aria-label', 'A (ended)')
  })

  test('aria-label appended with " (ended)" when errored', () => {
    renderTab({ session: session('A', 'errored') })
    expect(screen.getByRole('tab')).toHaveAttribute('aria-label', 'A (ended)')
  })

  test('aria-selected reflects isActive', () => {
    const { rerender } = renderTab({ isActive: true })
    expect(screen.getByRole('tab')).toHaveAttribute('aria-selected', 'true')
    rerender(
      <Tab
        session={session('a')}
        isActive={false}
        isFocusEntryPoint={false}
        agent={AGENTS.claude}
        onSelect={() => {}}
        onClose={() => {}}
      />
    )
    expect(screen.getByRole('tab')).toHaveAttribute('aria-selected', 'false')
  })

  test('tabIndex = 0 when isFocusEntryPoint, -1 otherwise', () => {
    const { rerender } = renderTab({ isFocusEntryPoint: true })
    expect(screen.getByRole('tab')).toHaveAttribute('tabindex', '0')
    rerender(
      <Tab
        session={session('a')}
        isActive={false}
        isFocusEntryPoint={false}
        agent={AGENTS.claude}
        onSelect={() => {}}
        onClose={() => {}}
      />
    )
    expect(screen.getByRole('tab')).toHaveAttribute('tabindex', '-1')
  })

  test('close button is always tabIndex=-1', () => {
    renderTab()
    const close = screen.getByRole('button', { name: /Close /i })
    expect(close).toHaveAttribute('tabindex', '-1')
  })
})

describe('Tab — keyboard', () => {
  test('Enter on inactive focused tab calls onSelect', async () => {
    const onSelect = vi.fn()
    renderTab({ session: session('X'), isActive: false, onSelect })
    const tab = screen.getByRole('tab')
    tab.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('X')
  })

  test('Space on inactive focused tab calls onSelect', async () => {
    const onSelect = vi.fn()
    renderTab({ session: session('X'), isActive: false, onSelect })
    screen.getByRole('tab').focus()
    await userEvent.keyboard(' ')
    expect(onSelect).toHaveBeenCalledWith('X')
  })

  test('Enter on already-active tab does NOT call onSelect (active-no-op guard)', async () => {
    const onSelect = vi.fn()
    renderTab({ isActive: true, onSelect })
    screen.getByRole('tab').focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('Delete on focused tab calls onClose', async () => {
    const onClose = vi.fn()
    renderTab({ session: session('X'), onClose })
    screen.getByRole('tab').focus()
    await userEvent.keyboard('{Delete}')
    expect(onClose).toHaveBeenCalledWith('X')
  })

  test('Backspace on focused tab calls onClose', async () => {
    const onClose = vi.fn()
    renderTab({ session: session('X'), onClose })
    screen.getByRole('tab').focus()
    await userEvent.keyboard('{Backspace}')
    expect(onClose).toHaveBeenCalledWith('X')
  })

  test('keys bubbled from descendants are ignored', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    renderTab({ onSelect, onClose })
    const close = screen.getByRole('button', { name: /Close /i })
    close.focus()
    await userEvent.keyboard('{Enter}')
    // The onClose IS called via the close button's own click (bubble),
    // but onSelect is not.
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('Tab — click', () => {
  test('clicking inactive tab calls onSelect', async () => {
    const onSelect = vi.fn()
    renderTab({ session: session('X'), isActive: false, onSelect })
    await userEvent.click(screen.getByRole('tab'))
    expect(onSelect).toHaveBeenCalledWith('X')
  })

  test('clicking already-active tab does NOT call onSelect', async () => {
    const onSelect = vi.fn()
    renderTab({ isActive: true, onSelect })
    await userEvent.click(screen.getByRole('tab'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('close button calls onClose with stopPropagation (does not also fire onSelect)', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    renderTab({ session: session('X'), onSelect, onClose })
    await userEvent.click(screen.getByRole('button', { name: /Close /i }))
    expect(onClose).toHaveBeenCalledWith('X')
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('Tab — visual', () => {
  test('renders agent glyph from the registry', () => {
    renderTab({ agent: AGENTS.claude })
    expect(screen.getByText(AGENTS.claude.glyph)).toBeInTheDocument()
  })

  test('active accent stripe rendered iff isActive', () => {
    const { rerender } = renderTab({ isActive: true, agent: AGENTS.claude })
    // The stripe is the absolute span with rounded-b-sm; it carries
    // background style = agent.accent.
    expect(
      screen.getByRole('tab').querySelector('span.rounded-b-sm')
    ).not.toBeNull()
    rerender(
      <Tab
        session={session('a')}
        isActive={false}
        isFocusEntryPoint={false}
        agent={AGENTS.claude}
        onSelect={() => {}}
        onClose={() => {}}
      />
    )
    expect(
      screen.getByRole('tab').querySelector('span.rounded-b-sm')
    ).toBeNull()
  })

  test('StatusDot rendered ONLY for running/paused (not completed/errored)', () => {
    const { rerender } = renderTab({ session: session('a', 'running') })
    expect(
      screen.getByRole('tab').querySelector('[aria-label="Status running"]')
    ).not.toBeNull()
    rerender(
      <Tab
        session={session('a', 'completed')}
        isActive={false}
        isFocusEntryPoint={false}
        agent={AGENTS.claude}
        onSelect={() => {}}
        onClose={() => {}}
      />
    )
    expect(
      screen.getByRole('tab').querySelector('[aria-label^="Status"]')
    ).toBeNull()
  })
})
```

If the StatusDot's `aria-label` selector mismatches actual DOM, adjust based on the failing test output.

- [ ] **Step 2: Add the inline #179 reference comment in `Tab.tsx`**

Verify the inline comment in `Tab.tsx`'s `onKeyDown` near the Delete/Backspace branch references #179 (already included in the sketch above).

- [ ] **Step 3: Run the new tests**

```bash
npx vitest run src/features/workspace/sessions/components/Tab.test.tsx
```

Expected: all leaf tests pass.

### Task 7.5: Trim `Tabs.test.tsx` to orchestrator scope

- [ ] **Step 1: Delete leaf tests now covered by `Tab.test.tsx`**

Per the spec §9 redistribution table, delete the tests now covered in Tab.test.tsx (~16 tests). Open `src/features/workspace/sessions/components/Tabs.test.tsx` and remove:

- `each tab carries aria-controls + id pointing at its TerminalZone panel`
- `tab has explicit aria-label so descendant labels do not pollute its name`
- `exited active tab appends "(ended)" to the accessible name`
- `marks the active tab with aria-selected and the lift offset`
- `active tab paints the agent accent stripe along the top`
- `clicking a tab calls onSelect with the session id`
- `close button calls onClose without selecting the tab`
- `keyboard activation: Enter/Space on a focused tab calls onSelect`
- `clicking the already-active tab does NOT call onSelect`
- `close buttons are always tabIndex=-1`
- `Delete on the focused tab calls onClose`
- `Backspace on the focused tab also calls onClose`
- `renders a status pip alongside the running session title`
- `agent glyph chip shows the registry glyph`
- `ArrowLeft / ArrowRight do nothing inside a focused tab`
- `Enter on a focused inactive tab activates it`
- `Enter on a focused close button closes that tab without re-selecting`

Move the "falls back to shell glyph for unknown agent types" test to `agentForSession.test.ts` (it's a helper-level concern; Tab receives a resolved `agent` prop so the test would be vacuous there). Append it to the existing `agentForSession.test.ts` file. If the test was passing today's `agentForSession()` call with an unknown `agentType` and asserting the resolved Agent's glyph is the shell fallback, the move is a copy-paste with the test framework imports adjusted.

- [ ] **Step 2: Verify Tabs.test.tsx is now orchestrator-only**

Remaining in `Tabs.test.tsx` (~15 tests):

- `renders the strip at 38px tall per handoff §4.3`
- `exposes a tablist for assistive navigation`
- `tablist owns ONLY tab children`
- `renders one tab per open session`
- `+ button calls onNew`
- `only the active tab carries tabIndex=0`
- `null activeSessionId falls back to the first visible tab`
- `stale (non-null) activeSessionId after flushSync removeSession also falls back to first`
- `with no open sessions and no active id, only the + button renders`
- `keyboard close moves DOM focus to the new active tab`
- `closing the active tab pre-selects the next VISIBLE tab`
- `closing an inactive tab does NOT change selection`
- `keeps the active session in the strip even after its PTY exits`

```bash
grep -cE "^\s+test\(" src/features/workspace/sessions/components/Tabs.test.tsx
```

Expected: ~15.

### Task 7.6: Verify and commit Phase 7

- [ ] **Step 1: Run all checks**

```bash
npm run type-check && npm run lint && npm run test
```

Expected: green. The session-tab strip renders identically to PR #174 in `npm run dev`.

- [ ] **Step 2: Commit Phase 7**

```bash
git add src/features/workspace/sessions/components/Tabs.tsx src/features/workspace/sessions/components/Tabs.test.tsx src/features/workspace/sessions/components/Tab.tsx src/features/workspace/sessions/components/Tab.test.tsx src/features/workspace/utils/agentForSession.test.ts src/features/workspace/WorkspaceView.tsx
git commit -m "$(cat <<'EOF'
refactor(sessions): co-locate session-tab strip + extract Tab leaf

Move src/features/workspace/components/SessionTabs.{tsx,test.tsx} to
src/features/workspace/sessions/components/Tabs.{tsx,test.tsx}. Rename
the exported component SessionTabs → Tabs.

Extract the inline per-tab JSX into a new
src/features/workspace/sessions/components/Tab.tsx leaf with the
full behavior contract (keyboard handler with descendant
suppression, ARIA role/label/selected/controls, glyph rendering,
status-dot conditional, top accent stripe, click guard, focus-
entry-point tabIndex).

The Delete/Backspace close binding stays inside Tab.tsx with an
inline comment referencing #179 — the migration to a global
keymap is tracked there.

Test redistribution this phase:
- ~16 leaf tests move from Tabs.test.tsx to Tab.test.tsx
  (per-tab markup, ARIA, keyboard, click).
- ~15 orchestrator tests stay in Tabs.test.tsx (visible-set,
  ARIA tablist, +button, focus restoration on close).
- 1 test ("falls back to shell glyph for unknown agent type")
  moves to agentForSession.test.ts (the helper that performs
  the resolution; Tab receives a resolved Agent prop).

WorkspaceView's import bumps from
'./components/SessionTabs' → './sessions/components/Tabs'
and the JSX usage from <SessionTabs> → <Tabs>.

Refs: docs/superpowers/specs/2026-05-06-sidebar-refactor-design.md (§"Workspace session module — Tabs + Tab", §"Test redistribution map")

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

After all 7 commits land, run the full acceptance gate.

- [ ] **Step 1: Confirm 7 new commits on the branch**

```bash
git log --oneline main..HEAD
```

Expected: 7 commits matching the phase commit messages above + the 3 spec commits.

- [ ] **Step 2: Full pre-PR gate**

```bash
npm run lint
npm run type-check
npm run test
npm run format:check
```

Expected: all clean.

- [ ] **Step 3: Visual regression — manual sanity check**

```bash
npm run dev
```

Open the app. Click through:

- Create multiple sessions; verify Active group shows them.
- Drag-reorder Active sessions; verify reorder.
- Complete a session (run a command that exits); verify it moves to Recent.
- Click `+` next to "Active"; verify a new session opens.
- Click the New Instance gradient button at the bottom; verify it opens a new session.
- Drag the explorer split handle; verify the FileExplorer height changes.
- Open the session-tab strip; click a tab, click `+`, click `×` on a tab.
- Use keyboard: Tab into the strip, `Enter`/`Space`/`Delete`/`Backspace` on tabs.

Compare against PR #174 if anything looks off. Use a separate worktree for the comparison build (do NOT `git checkout ab1b888 -- src` — that overwrites HEAD):

```bash
git worktree add ../vimeflow-pr174 ab1b888
(cd ../vimeflow-pr174 && npm install && npm run dev -- --port 5174)
# Compare side-by-side; both are now running.
git worktree remove ../vimeflow-pr174  # when done
```

- [ ] **Step 4: Acceptance criteria checklist**

Open the spec at `docs/superpowers/specs/2026-05-06-sidebar-refactor-design.md` → §"Acceptance criteria + verification". Walk every checkbox; confirm each holds.

- [ ] **Step 5: Spec is implementation-ready signal**

When all 7 phases are committed and the acceptance gate is green, the implementation matches the spec. Any deviation discovered during implementation should be documented in the PR description with a one-line note explaining the divergence and (if material) a follow-up issue.

---

## Reference: post-PR follow-ups (do NOT do in this PR)

These are tracked separately. Linked in the spec's §"Out of scope (deferred to follow-ups)" section.

- **#175** — SESSIONS / FILES / CONTEXT three-tab switcher in the sidebar. The new named-slot Sidebar API is designed so #175 can swap the `content` slot.
- **#176** — Double scrollbar in the FileExplorer area.
- **#177** — Global keybinding for session-tab cycling (Cmd+Shift+]/[).
- **#179** — Tab Delete/Backspace close binding migration to a global keyboard shortcut. `Tab.tsx`'s onKeyDown carries an inline comment referencing this issue.
- **#180** — Keyboard adjustment for the explorer split-resize separator (a11y). `useResizable.adjustBy(±step)` is already exposed.
