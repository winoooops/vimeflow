# Git Ref Chip — PR-A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare 🌲 worktree-emoji + plain branch text in each terminal pane header with a single `<GitRefChip>` component — a lavender-tinted inline-flex pill that renders `worktree → branch` with two Material Symbols icons. Forward-compatible with PR-B's coral detached-HEAD path (wired but unreachable in PR-A).

**Architecture:** Frontend-only refactor; zero backend changes. The chip lives at `src/features/terminal/components/TerminalPane/GitRefChip.tsx` and consumes existing hook-derived props (`worktreeName`, `branch`, optional `detached`). `HeaderMetadata.tsx` replaces its current two-segment layout with a single `<GitRefChip>`. All styling uses semantic Catppuccin tokens already in `tailwind.config.js`.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library, Tailwind 4.x (Catppuccin Mocha palette), Material Symbols Outlined (loaded in `src/index.css`), JetBrains Mono.

**Source spec:** `docs/superpowers/specs/2026-05-23-git-ref-chip-design.md` (committed at `62e2937` on `feat/git-chip-migration`, codex-reviewed footer present).

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/features/terminal/components/TerminalPane/GitRefChip.tsx` | Create | Presentational chip with three render shapes (worktree+branch, branch-only, detached-coral). Pure, no hooks. |
| `src/features/terminal/components/TerminalPane/GitRefChip.test.tsx` | Create | 10 unit tests covering null/empty normalisation, structural testids, class-presence assertions, accessibility. |
| `src/features/terminal/components/TerminalPane/HeaderMetadata.tsx` | Modify | Drop worktree-chip + branch text + their leading dots; insert `<GitRefChip>`; simplify `hasLeadingMetadata`. |
| `src/features/terminal/components/TerminalPane/HeaderMetadata.test.tsx` | Modify | Migrate testid assertions to `git-ref-chip*`; add worktree-without-branch + defensive empty-string cases. |
| `src/features/terminal/components/TerminalPane/Header.test.tsx` | Modify | Shift the negative-assertion target from outer chip to `git-ref-chip-wt-label` (outer chip still renders in the branch-only case). |

---

## Conventions

- No semicolons, single quotes, trailing commas (ES5), arrow-function components, explicit return types on exports — ESLint-enforced.
- Tests use `test()` (not `it()`); test data inlined at call site per `rules/typescript/testing/CLAUDE.md`.
- Conventional commits — task commits use `feat(terminal):`, `test(terminal):`, or `refactor(terminal):` to pass commitlint.
- Outer-span `data-testid="git-ref-chip"`; sub-segment testids follow `git-ref-chip-<part>` (`wt-icon`, `wt-label`, `chevron`, `br-icon`, `br-label`) per spec §5.1.
- All work happens on the existing `feat/git-chip-migration` worktree at `/home/will/projects/vimeflow/.claude/worktrees/git-chip-migration/`. Commits land directly on `feat/git-chip-migration` for this PR-A plan; the PR (when opened) targets that branch.

---

### Task 1: Write the failing `GitRefChip.test.tsx`

**Files:**
- Create: `src/features/terminal/components/TerminalPane/GitRefChip.test.tsx`

Tests first — TDD. The component doesn't exist yet, so all 10 tests will fail with a module-resolution error.

- [ ] **Step 1: Create the test file with all 10 cases**

Write `src/features/terminal/components/TerminalPane/GitRefChip.test.tsx`:

```tsx
// cspell:ignore worktree
import { render, screen } from '@testing-library/react'
import { GitRefChip } from './GitRefChip'

test('renders nothing when branch is null', () => {
  render(<GitRefChip worktreeName="feat-jose" branch={null} />)
  expect(screen.queryByTestId('git-ref-chip')).toBeNull()
})

test('renders nothing when branch is empty string', () => {
  render(<GitRefChip worktreeName="feat-jose" branch="" />)
  expect(screen.queryByTestId('git-ref-chip')).toBeNull()
})

test('renders all six testids when worktreeName and branch are present', () => {
  render(<GitRefChip worktreeName="feat-jose" branch="feat/jose-auth" />)
  expect(screen.getByTestId('git-ref-chip')).toBeInTheDocument()
  expect(screen.getByTestId('git-ref-chip-wt-icon')).toBeInTheDocument()
  expect(screen.getByTestId('git-ref-chip-wt-label')).toHaveTextContent('feat-jose')
  expect(screen.getByTestId('git-ref-chip-chevron')).toBeInTheDocument()
  expect(screen.getByTestId('git-ref-chip-br-icon')).toBeInTheDocument()
  expect(screen.getByTestId('git-ref-chip-br-label')).toHaveTextContent('feat/jose-auth')
})

test('renders branch-only when worktreeName is null', () => {
  render(<GitRefChip worktreeName={null} branch="main" />)
  expect(screen.getByTestId('git-ref-chip')).toBeInTheDocument()
  expect(screen.queryByTestId('git-ref-chip-wt-icon')).toBeNull()
  expect(screen.queryByTestId('git-ref-chip-wt-label')).toBeNull()
  expect(screen.queryByTestId('git-ref-chip-chevron')).toBeNull()
  expect(screen.getByTestId('git-ref-chip-br-icon')).toBeInTheDocument()
  expect(screen.getByTestId('git-ref-chip-br-label')).toHaveTextContent('main')
})

test('branch label has min-w-0 truncate classes', () => {
  render(<GitRefChip worktreeName="feat-jose" branch="feat/jose-auth" />)
  expect(screen.getByTestId('git-ref-chip-br-label').className).toMatch(/min-w-0/)
  expect(screen.getByTestId('git-ref-chip-br-label').className).toMatch(/truncate/)
})

test('worktree label has max-w-[120px] + truncate + shrink-0 classes', () => {
  render(
    <GitRefChip
      worktreeName="this-is-a-very-long-worktree-name-for-test"
      branch="feat/jose-auth"
    />
  )
  const wtLabel = screen.getByTestId('git-ref-chip-wt-label')
  expect(wtLabel.className).toMatch(/max-w-\[120px\]/)
  expect(wtLabel.className).toMatch(/truncate/)
  expect(wtLabel.className).toMatch(/shrink-0/)
})

test('detached=true applies coral classes to chip frame, branch label, worktree label', () => {
  render(<GitRefChip worktreeName="feat-jose" branch="a7f23c" detached />)
  const chip = screen.getByTestId('git-ref-chip')
  expect(chip.className).toMatch(/bg-tertiary\/\[0\.06\]/)
  expect(chip.className).toMatch(/border-tertiary/)
  expect(screen.getByTestId('git-ref-chip-br-label').className).toMatch(/text-tertiary/)
  expect(screen.getByTestId('git-ref-chip-wt-label').className).toMatch(/text-error/)
})

test('detached=true with worktreeName=null renders coral branch-only chip', () => {
  render(<GitRefChip worktreeName={null} branch="a7f23c" detached />)
  const chip = screen.getByTestId('git-ref-chip')
  expect(chip.className).toMatch(/bg-tertiary\/\[0\.06\]/)
  expect(screen.queryByTestId('git-ref-chip-wt-icon')).toBeNull()
  expect(screen.queryByTestId('git-ref-chip-wt-label')).toBeNull()
  expect(screen.getByTestId('git-ref-chip-br-label')).toHaveTextContent('a7f23c')
})

test('title attribute composition for all four states', () => {
  const { rerender } = render(
    <GitRefChip worktreeName="feat-jose" branch="feat/jose-auth" />
  )
  expect(screen.getByTestId('git-ref-chip').getAttribute('title')).toBe(
    'worktree: feat-jose · branch: feat/jose-auth'
  )

  rerender(<GitRefChip worktreeName={null} branch="feat/jose-auth" />)
  expect(screen.getByTestId('git-ref-chip').getAttribute('title')).toBe(
    'branch: feat/jose-auth'
  )

  rerender(<GitRefChip worktreeName="feat-jose" branch="a7f23c" detached />)
  expect(screen.getByTestId('git-ref-chip').getAttribute('title')).toBe(
    'worktree: feat-jose · detached HEAD: a7f23c'
  )

  rerender(<GitRefChip worktreeName={null} branch="a7f23c" detached />)
  expect(screen.getByTestId('git-ref-chip').getAttribute('title')).toBe(
    'detached HEAD: a7f23c'
  )
})

test('icons carry material-symbols-outlined class + aria-hidden', () => {
  render(<GitRefChip worktreeName="feat-jose" branch="feat/jose-auth" />)
  const wtIcon = screen.getByTestId('git-ref-chip-wt-icon')
  const brIcon = screen.getByTestId('git-ref-chip-br-icon')

  expect(wtIcon.className).toMatch(/material-symbols-outlined/)
  expect(brIcon.className).toMatch(/material-symbols-outlined/)
  expect(wtIcon.getAttribute('aria-hidden')).toBe('true')
  expect(brIcon.getAttribute('aria-hidden')).toBe('true')
})
```

- [ ] **Step 2: Run the test file — expect 10 failures**

Run: `npx vitest run src/features/terminal/components/TerminalPane/GitRefChip.test.tsx`

Expected: all 10 fail with `Failed to resolve import "./GitRefChip"` (or equivalent module-resolution error).

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/features/terminal/components/TerminalPane/GitRefChip.test.tsx
git commit -m "test(terminal): add failing GitRefChip tests"
```

Pre-commit lint-staged runs ESLint on the staged file. ESLint may flag the missing module — that's expected; the next task creates it. The commit-msg hook validates conventional commits (`test(terminal):` is accepted). The pre-push hook (`vitest run`) does NOT fire on commit, only on push — so failing tests are not a blocker for this commit.

---

### Task 2: Implement `GitRefChip.tsx` so all 10 tests pass

**Files:**
- Create: `src/features/terminal/components/TerminalPane/GitRefChip.tsx`

- [ ] **Step 1: Write the component**

Create `src/features/terminal/components/TerminalPane/GitRefChip.tsx`:

```tsx
// cspell:ignore worktree
import type { ReactElement } from 'react'

export interface GitRefChipProps {
  /** Linked-worktree basename, or null when on the main checkout. */
  worktreeName: string | null
  /** Branch name (PR-A) — or short SHA when HEAD is detached. */
  branch: string | null
  /** PR-A: optional, always defaults to false. PR-B wires the live value. */
  detached?: boolean
}

const composeTitle = (
  worktreeName: string | null,
  branch: string,
  detached: boolean
): string => {
  const branchLabel = detached ? 'detached HEAD' : 'branch'
  if (worktreeName !== null && worktreeName.length > 0) {
    return `worktree: ${worktreeName} · ${branchLabel}: ${branch}`
  }
  return `${branchLabel}: ${branch}`
}

export const GitRefChip = ({
  worktreeName,
  branch,
  detached = false,
}: GitRefChipProps): ReactElement | null => {
  if (branch === null || branch.length === 0) {
    return null
  }

  const hasWorktree = worktreeName !== null && worktreeName.length > 0

  const frameBase =
    'inline-flex items-center gap-1.5 h-[22px] pl-1.5 pr-2 rounded-chip border max-w-[340px] overflow-hidden'
  const frameClasses = detached
    ? `${frameBase} bg-tertiary/[0.06] border-tertiary/25`
    : `${frameBase} bg-primary-container/[0.06] border-primary-container/20`

  const wtIconClasses = `material-symbols-outlined text-[13px] shrink-0 ${
    detached ? 'text-error' : 'text-secondary-dim'
  }`

  const wtLabelClasses = `font-mono text-[10.5px] max-w-[120px] shrink-0 truncate ${
    detached ? 'text-error' : 'text-secondary-dim'
  }`

  const brIconClasses = `material-symbols-outlined text-[13px] shrink-0 ${
    detached ? 'text-tertiary' : 'text-primary-container'
  }`

  const brLabelClasses = `font-medium font-mono text-[10.5px] min-w-0 truncate ${
    detached ? 'text-tertiary' : 'text-on-surface'
  }`

  return (
    <span
      data-testid="git-ref-chip"
      title={composeTitle(worktreeName, branch, detached)}
      className={frameClasses}
    >
      {hasWorktree && (
        <>
          <span
            data-testid="git-ref-chip-wt-icon"
            aria-hidden="true"
            className={wtIconClasses}
          >
            account_tree
          </span>
          <span data-testid="git-ref-chip-wt-label" className={wtLabelClasses}>
            {worktreeName}
          </span>
          <span
            data-testid="git-ref-chip-chevron"
            className="text-outline-variant text-[11px] shrink-0"
          >
            ›
          </span>
        </>
      )}
      <span
        data-testid="git-ref-chip-br-icon"
        aria-hidden="true"
        className={brIconClasses}
      >
        fork_right
      </span>
      <span data-testid="git-ref-chip-br-label" className={brLabelClasses}>
        {branch}
      </span>
    </span>
  )
}
```

- [ ] **Step 2: Run the tests — expect 10 passes**

Run: `npx vitest run src/features/terminal/components/TerminalPane/GitRefChip.test.tsx`

Expected: 10 passes.

- [ ] **Step 3: Lint + type-check the new component**

```bash
npm run lint -- src/features/terminal/components/TerminalPane/GitRefChip.tsx src/features/terminal/components/TerminalPane/GitRefChip.test.tsx
npm run type-check
```

Expected: no errors on either.

- [ ] **Step 4: Commit**

```bash
git add src/features/terminal/components/TerminalPane/GitRefChip.tsx
git commit -m "feat(terminal): add GitRefChip component"
```

---

### Task 3: Wire `GitRefChip` into `HeaderMetadata.tsx`

**Files:**
- Modify: `src/features/terminal/components/TerminalPane/HeaderMetadata.tsx`

This task removes the existing `worktree-chip` testid and the bare branch span. `HeaderMetadata.test.tsx` and `Header.test.tsx` will fail after this commit; Tasks 4 and 5 fix them.

- [ ] **Step 1: Replace the file body**

Overwrite `src/features/terminal/components/TerminalPane/HeaderMetadata.tsx`:

```tsx
// cspell:ignore worktree
import type { ReactElement } from 'react'
import { formatRelativeTime } from '../../../agent-status/utils/relativeTime'
import type { Session } from '../../../sessions/types'
import { GitRefChip } from './GitRefChip'

export interface HeaderMetadataProps {
  worktreeName: string | null
  branch: string | null
  added: number
  removed: number
  session: Session
}

export const HeaderMetadata = ({
  worktreeName,
  branch,
  added,
  removed,
  session,
}: HeaderMetadataProps): ReactElement => {
  const hasGitRef = branch !== null && branch.length > 0
  const hasDeltas = added > 0 || removed > 0
  const hasLeadingMetadata = hasGitRef || hasDeltas

  return (
    <>
      {hasGitRef && (
        <>
          <span className="text-outline-variant/60">·</span>
          <GitRefChip worktreeName={worktreeName} branch={branch} />
        </>
      )}
      {hasDeltas && (
        <>
          <span className="text-outline-variant/60">·</span>
          <span className="text-success">+{added}</span>
          <span className="text-error">−{removed}</span>
        </>
      )}
      {hasLeadingMetadata && <span className="text-outline-variant/60">·</span>}
      <span className="whitespace-nowrap text-on-surface-muted">
        {formatRelativeTime(session.lastActivityAt)}
      </span>
    </>
  )
}
```

- [ ] **Step 2: Run the focused tests — expect failures**

Run: `npx vitest run src/features/terminal/components/TerminalPane/HeaderMetadata.test.tsx src/features/terminal/components/TerminalPane/Header.test.tsx`

Expected: failures referencing `worktree-chip` testid in both files. These are fixed in Tasks 4 and 5.

- [ ] **Step 3: Lint + type-check the modified file**

```bash
npm run lint -- src/features/terminal/components/TerminalPane/HeaderMetadata.tsx
npm run type-check
```

Expected: no errors (the test failures don't surface through lint or tsc).

- [ ] **Step 4: Commit the integration**

```bash
git add src/features/terminal/components/TerminalPane/HeaderMetadata.tsx
git commit -m "refactor(terminal): use GitRefChip in HeaderMetadata"
```

Note: pre-commit lint-staged only checks the staged file, so the broken test files do NOT block this commit. The pre-push hook (`vitest run`) DOES run the whole suite — this commit must NOT be pushed until Tasks 4 + 5 land.

---

### Task 4: Update `HeaderMetadata.test.tsx`

**Files:**
- Modify: `src/features/terminal/components/TerminalPane/HeaderMetadata.test.tsx`

- [ ] **Step 1: Locate the failing assertions**

Run: `grep -n worktree-chip src/features/terminal/components/TerminalPane/HeaderMetadata.test.tsx`

Expected output (line numbers may drift; semantic matches are what matters):

```
69:    expect(screen.queryByTestId('worktree-chip')).not.toBeInTheDocument()
117:    expect(screen.getByTestId('worktree-chip')).toHaveTextContent(...
144:    expect(screen.queryByTestId('worktree-chip')).not.toBeInTheDocument()
158:    expect(screen.getByTestId('worktree-chip')).toBeInTheDocument()
```

- [ ] **Step 2: Migrate each assertion per the matrix**

For each `worktree-chip` reference, classify by context (look at the surrounding test's props) and replace:

- **Negative `queryByTestId('worktree-chip')` when worktreeName is null AND branch is non-empty** (the branch-only render case):
  ```tsx
  expect(screen.queryByTestId('git-ref-chip-wt-label')).not.toBeInTheDocument()
  expect(screen.getByTestId('git-ref-chip-br-label')).toHaveTextContent('<the-branch-from-this-test>')
  ```
  Replace `'<the-branch-from-this-test>'` with the literal string that the surrounding `render(<HeaderMetadata ...>)` call passes as `branch=`.

- **Negative `queryByTestId('worktree-chip')` when BOTH worktreeName AND branch are null** (no chip at all):
  ```tsx
  expect(screen.queryByTestId('git-ref-chip')).toBeNull()
  ```

- **Positive `getByTestId('worktree-chip').toHaveTextContent('<wt>')`**:
  ```tsx
  expect(screen.getByTestId('git-ref-chip-wt-label')).toHaveTextContent('<wt>')
  ```

- **Positive `getByTestId('worktree-chip').toBeInTheDocument()`**:
  ```tsx
  expect(screen.getByTestId('git-ref-chip')).toBeInTheDocument()
  ```

- **Any `getByText('<branch-string>')` that checked the bare branch text** → switch to the chip's branch label:
  ```tsx
  expect(screen.getByTestId('git-ref-chip-br-label')).toHaveTextContent('<branch-string>')
  ```

- [ ] **Step 3: Add the §4.3 behaviour test (worktree without branch)**

Append at the bottom of the file:

```tsx
test('suppresses chip + leading dot when worktreeName is set but branch is null', () => {
  render(
    <HeaderMetadata
      worktreeName="feat-jose"
      branch={null}
      added={0}
      removed={0}
      session={{
        id: 'sess-1',
        projectId: 'proj-1',
        name: 'session 1',
        status: 'idle',
        workingDirectory: '/home/user/proj',
        agentType: 'claude-code',
        layout: 'single',
        panes: [],
        createdAt: '2026-05-23T00:00:00Z',
        lastActivityAt: '2026-05-23T00:00:00Z',
        activity: { kind: 'idle' },
      }}
    />
  )
  expect(screen.queryByTestId('git-ref-chip')).toBeNull()
  expect(screen.queryByText('·')).toBeNull()
})
```

If the existing test file uses a shared `baseSession` fixture instead of inlining, re-use that fixture name in place of the inline object above (`session={baseSession}` and remove the inline literal).

- [ ] **Step 4: Add the defensive empty-string test**

Append:

```tsx
test('treats branch="" the same as branch=null (chip + leading dot suppressed)', () => {
  render(
    <HeaderMetadata
      worktreeName="feat-jose"
      branch=""
      added={0}
      removed={0}
      session={{
        id: 'sess-1',
        projectId: 'proj-1',
        name: 'session 1',
        status: 'idle',
        workingDirectory: '/home/user/proj',
        agentType: 'claude-code',
        layout: 'single',
        panes: [],
        createdAt: '2026-05-23T00:00:00Z',
        lastActivityAt: '2026-05-23T00:00:00Z',
        activity: { kind: 'idle' },
      }}
    />
  )
  expect(screen.queryByTestId('git-ref-chip')).toBeNull()
  expect(screen.queryByText('·')).toBeNull()
})
```

Same `baseSession` substitution rule applies.

- [ ] **Step 5: Run the focused suite**

Run: `npx vitest run src/features/terminal/components/TerminalPane/HeaderMetadata.test.tsx`

Expected: all existing tests pass + 2 new tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/terminal/components/TerminalPane/HeaderMetadata.test.tsx
git commit -m "test(terminal): migrate HeaderMetadata tests to GitRefChip"
```

---

### Task 5: Update `Header.test.tsx`

**Files:**
- Modify: `src/features/terminal/components/TerminalPane/Header.test.tsx`

- [ ] **Step 1: Locate the two assertion sites**

Run: `grep -n worktree-chip src/features/terminal/components/TerminalPane/Header.test.tsx`

Expected output (line numbers may drift; semantic matches are what matters):

```
89:    expect(screen.queryByTestId('worktree-chip')).not.toBeInTheDocument()
101:    expect(screen.getByTestId('worktree-chip')).toHaveTextContent(...
```

- [ ] **Step 2: Replace the negative assertion (currently line 89)**

The test around line 89 calls `render(<Header ...>)` with `worktreeName={null}` and a non-null branch (look 5–15 lines above for the actual `branch=` literal). The negative target shifts from the outer chip to the worktree segment:

```tsx
expect(screen.queryByTestId('git-ref-chip-wt-label')).not.toBeInTheDocument()
expect(screen.getByTestId('git-ref-chip-br-label')).toHaveTextContent('<the-branch-from-this-test>')
```

Replace `'<the-branch-from-this-test>'` with the literal value the existing `render` passes (e.g. `'main'`, `'feat/jose-auth'`).

- [ ] **Step 3: Replace the positive assertion (currently line 101)**

The test around line 101 calls `render(<Header ...>)` with a real `worktreeName=` value. Replace:

```tsx
expect(screen.getByTestId('git-ref-chip-wt-label')).toHaveTextContent('<the-wt-name-from-this-test>')
```

Substitute `'<the-wt-name-from-this-test>'` with the literal worktree name (e.g. `'feat-jose'`).

- [ ] **Step 4: Run the focused suite**

Run: `npx vitest run src/features/terminal/components/TerminalPane/Header.test.tsx`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/components/TerminalPane/Header.test.tsx
git commit -m "test(terminal): migrate Header tests to GitRefChip"
```

---

### Task 6: Full-suite verification + manual QA acceptance gate

**Files:** none modified unless §7.4 overflow fix is needed.

- [ ] **Step 1: Full test suite**

Run: `npm run test`

Expected: green across the board (no failures, no skipped failures).

- [ ] **Step 2: Lint + format + type-check**

```bash
npm run lint
npm run format:check
npm run type-check
```

Expected: all three pass with no errors. If `format:check` finds drift, run `npm run format` and stage the result as a follow-up commit:

```bash
git add -p
git commit -m "chore: prettier formatting after GitRefChip migration"
```

- [ ] **Step 3: Start the dev server**

```bash
npm run dev
```

Wait for Vite's `Local: http://localhost:<port>/` line.

- [ ] **Step 4: Manual QA — 1280×800, 4-pane SplitView (spec §7.4)**

Open the dev URL in a browser sized to 1280×800. Switch to a 4-pane SplitView layout. For each visible pane, verify:

1. Header renders without overflow — the chip + diff counts + relative-time label fit on one line.
2. Both icons (`account_tree`, `fork_right`) render as glyphs, not literal text.
3. With a long branch name (simulate with `git checkout -b feat/extremely-long-branch-name-for-overflow-test` in one of the panes), the branch label ellipsizes; both icons + chevron remain visible.
4. With a long worktree basename (≥ 40 chars), the worktree label ellipsizes at ~120 px and the branch slot still shows ~145 px wide.
5. On the main checkout pane (no linked worktree), the chip renders branch-only — no worktree icon, no chevron, no leading dot before the chip is missing only if branch is also null/empty.

- [ ] **Step 5: If overflow is observed, apply the spec §7.4 fallback**

Stop the dev server. Edit `src/features/terminal/components/TerminalPane/GitRefChip.tsx`:

- In `frameBase`, replace `max-w-[340px]` with `max-w-full`.
- In `GitRefChip.test.tsx` cases 5–7, remove or relax any assertion that depended on the 340 px cap (case 5 asserts `min-w-0 truncate` on the branch label — keep; nothing references the chip's `max-w` directly).

Re-run the focused vitest file and the full QA gate:

```bash
npx vitest run src/features/terminal/components/TerminalPane/GitRefChip.test.tsx
npm run test
npm run dev   # repeat manual QA
```

Commit:

```bash
git add src/features/terminal/components/TerminalPane/GitRefChip.tsx
git commit -m "fix(terminal): let GitRefChip grow with pane width

Per spec §7.4 acceptance gate at 1280x800 with a 4-pane SplitView,
the 340px max-width caused chip overflow against narrow pane headers.
Replacing with max-w-full lets the chip share width with the diff
counts via flex math."
```

- [ ] **Step 6: Final state check**

```bash
git status                                         # should be clean
git log --oneline feat/git-chip-migration ^main    # see commits below
```

Expected commit history on `feat/git-chip-migration` (top = newest):

```
[fix(terminal): let GitRefChip grow with pane width]   ← only if §7.4 fallback fired
test(terminal): migrate Header tests to GitRefChip
test(terminal): migrate HeaderMetadata tests to GitRefChip
refactor(terminal): use GitRefChip in HeaderMetadata
feat(terminal): add GitRefChip component
test(terminal): add failing GitRefChip tests
docs(spec): mark spec codex-reviewed
docs(spec): apply codex feedback
docs(spec): git-ref-chip-migration
```

---

## What this plan does NOT do

- **PR-B work.** The backend `git_head_state` IPC, `useGitBranch` shape change, and live coral path are explicitly out of scope per spec §6 — they get their own spec + plan as a follow-up.
- **The PR-A pull request.** This plan stops at "code complete + manual QA passed on `feat/git-chip-migration`". Open the PR with `/lifeline:request-pr` (it auto-detects the integration branch as the base — see the stacked-PR pattern in CLAUDE.md / memory).
- **Worktree-only fallback variant.** Spec §7.1 leaves this as an open question for the PR reviewer; this plan ships option B (no fallback).
- **PR-B's typed-mock audit.** Spec §6.3 calls for an `rg "UseGitBranchReturn" src/` sweep — that's PR-B's task list, not PR-A's.
