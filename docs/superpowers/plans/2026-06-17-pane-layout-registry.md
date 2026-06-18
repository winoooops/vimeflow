# Pane Layout Registry — Implementation Plan

> For agentic workers: implement in PR-sized slices from the `feature/vim-151`
> umbrella branch. Stop when a PR is created. PR titles must not start with
> `[codex]`. Apply labels `auto-review` and `auto-approve`.

**Goal:** introduce a central pane-layout registry and an extensible ratio model
that make a real `grid3x2` layout possible without further architectural churn.

**Spec:** `docs/superpowers/specs/2026-06-17-pane-layout-registry-design.md`

**Linear:** `VIM-151`

## Branch strategy

- Umbrella branch: `feature/vim-151`
- PR1 branch: `feature/vim-151-pr1-layout-registry`
- PR2 branch: `feature/vim-151-pr2-ratio-model`
- PR3 branch: `feature/vim-151-pr3-grid3x2`
- PR4 branch: `feature/vim-151-pr4-polish`

Each PR branch is cut from the umbrella branch, then rebased as prior PRs land.

## PR1 — central layout registry extraction

**Goal:** centralize layout definitions without changing runtime behavior.

### Scope

- create `src/features/terminal/layout-registry/`
- define the canonical `LayoutId` union there
- move existing labels, order, capacity, and geometry into `LayoutSpec`s
- make `LayoutSwitcher`, `usePaneShortcuts`, `groupSessionsFromInfos`, and
  `paneLifecycle` read from the registry where possible
- keep the current 5 layouts only
- keep the current ratio shape unchanged in PR1

### Files

- create:
  - `src/features/terminal/layout-registry/index.ts`
  - `src/features/terminal/layout-registry/layoutIds.ts`
  - `src/features/terminal/layout-registry/layoutSpecs.ts`
  - `src/features/terminal/layout-registry/layoutRegistry.ts`
- modify:
  - `src/features/sessions/types/index.ts`
  - `src/features/terminal/components/SplitView/layouts.ts`
  - `src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.tsx`
  - `src/features/terminal/components/LayoutSwitcher/LayoutGlyph.tsx`
  - `src/features/terminal/hooks/usePaneShortcuts.ts`
  - `src/features/sessions/utils/groupSessionsFromInfos.ts`
  - `src/features/sessions/utils/paneLifecycle.ts`

### Tests

- `layouts.test.ts`
- `LayoutSwitcher.test.tsx`
- `LayoutGlyph.test.tsx`
- `usePaneShortcuts.test.ts`
- `paneLifecycle.test.ts`
- `index.test.ts` for `LayoutId`

### Verification

- `npx prettier --check docs/technical-notes/pane-layout-3x2.html docs/technical-notes/pane-layout-3x2.zh-CN.html`
- `npx vitest run src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.test.tsx src/features/terminal/components/LayoutSwitcher/LayoutGlyph.test.tsx src/features/terminal/components/SplitView/layouts.test.ts src/features/terminal/hooks/usePaneShortcuts.test.ts src/features/sessions/utils/paneLifecycle.test.ts src/features/sessions/types/index.test.ts`
- `npm run lint`
- `npm run type-check`

### PR title

`refactor(terminal): centralize pane layout definitions in a registry`

## PR2 — extensible ratio model

**Goal:** replace `{ col, row }` with a track-array ratio model while preserving
the current 5-layout runtime behavior.

### Scope

- add `ratioModel.ts`
- widen `SplitView` ratio state to `{ cols: number[]; rows: number[] }`
- refactor `resolveGrid`, `useSplitDivider`, and `SplitDividers` to bind against
  track arrays rather than layout-specific `col` / `row` fields
- keep current layouts visually unchanged

### Key risk

- regression in resize behavior for `threeRight` and `quad`

## PR3 — grid3x2 layout

**Goal:** add the new `grid3x2` layout end to end.

### Scope

- add the `grid3x2` spec
- add the glyph
- expose the pill
- extend keyboard cycle order
- extend restore legality
- add autoshrink policy for 6/5/4/3/2 pane transitions
- add tests for render, resize handles, and lifecycle shrink behavior

## PR4 — polish

**Goal:** narrow follow-up correctness and ergonomics work discovered while
shipping the first three PRs.

### Candidate items

- roadmap/progress updates
- copy/tooltips for the new layout
- small divider polish
- any narrow test gaps or restore edge cases found during review

## Execution rule

Implement only one PR scope at a time. When a PR branch is ready:

1. verify locally
2. create the PR with the planned title shape
3. apply labels `auto-review` and `auto-approve`
4. pause
