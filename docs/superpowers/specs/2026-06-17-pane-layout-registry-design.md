---
title: Pane layout registry + extensible ratio model
date: 2026-06-17
status: draft
issue: VIM-151
owners: [winoooops]
related:
  - docs/technical-notes/pane-layout-3x2.html
  - docs/technical-notes/pane-layout-3x2.zh-CN.html
  - docs/superpowers/specs/2026-05-11-step-5b-splitview-render-design.md
  - docs/superpowers/specs/2026-05-12-step-5c-1-layout-picker-design.md
  - docs/superpowers/specs/2026-05-12-step-5c-2-pane-lifecycle-design.md
  - docs/superpowers/specs/2026-05-25-split-pane-resize-design.md
---

# Pane layout registry + extensible ratio model

## Context

The terminal pane system already supports:

- per-session `layout: LayoutId`
- a `SplitView` grid renderer
- a layout pill switcher in workspace top chrome
- click / shortcut focus changes
- pane add/remove lifecycle
- per-layout resize for the current 5 canonical layouts

But the implementation is still coupled to a fixed layout universe:

- `LayoutId` is a closed 5-value union
- `LAYOUTS` is only one of several layout-definition sources
- `usePaneShortcuts` derives cycle order from `LAYOUTS` insertion order
- restore legality is maintained separately in `groupSessionsFromInfos.ts`
- autoshrink policy is maintained separately in `paneLifecycle.ts`
- divider rendering is layout-switch based
- ratio state is fixed to `{ col, row }`, which assumes one logical column split
  and one logical row split per layout

This makes a real `3x2` layout expensive in the wrong way. The visible work
looks like "one more pill", but the underlying system still assumes the world
ends at `quad`.

## Problem

We need to add a real 6-pane `3x2` layout without continuing to widen the same
coupling pattern. If we only add another `LayoutId`, more `switch` cases, and a
special-case divider arrangement, the next layout will force the same refactor
again.

The design goal is therefore broader than "support `grid3x2`". We need a
central layout-definition system and a ratio model that can represent future
layouts without changing core types each time.

## Goals

1. Introduce a central pane-layout registry as the normative source for:
   - `LayoutId`
   - display label
   - visible ordering in the pill group
   - keyboard cycle ordering
   - capacity
   - default ratio model
   - grid resolution
   - divider specification
   - autoshrink behavior
   - restore legality
2. Replace the fixed `{ col, row }` ratio model with an extensible track-array
   model, so layouts can express `N` column tracks and `M` row tracks.
3. Refactor `SplitView` grid resolution and divider rendering to read from the
   registry instead of independent layout switches.
4. Add a new `grid3x2` layout on top of the widened infrastructure.
5. Preserve all current layout behavior for `single`, `vsplit`, `hsplit`,
   `threeRight`, and `quad` through the migration.

## Non-goals

1. No persistence of resize ratios across app reload in this feature.
2. No drag-to-reorder or drag-to-swap panes.
3. No change to PTY ownership, session restore transport, or backend schema
   beyond accepting the new layout id in existing shape contracts.
4. No new per-layout user customization UI beyond the `3x2` pill itself.
5. No attempt to generalize arbitrary freeform layouts; the registry governs a
   curated set of canonical layouts.

## Decisions

| #   | Decision                                                                                                                                                         | Rationale                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Introduce a `layout-registry` module under `src/features/terminal/` instead of continuing to widen `layouts.ts` only.                                            | The system already has multiple layout-definition consumers. A deeper module is needed so new layouts stop triggering repo-wide switch proliferation. |
| 2   | The registry may be implemented as a typed module rather than an OO class, but it must behave as a single coordination point.                                    | The important property is centralization of policy and geometry, not syntax.                                                                          |
| 3   | `LayoutRatios` becomes a track model: `{ cols: number[]; rows: number[] }`.                                                                                      | This scales to `3x2`, `4x2`, `3x3`, and asymmetric future layouts.                                                                                    |
| 4   | Ratio semantics are "pane track weights", not divider positions.                                                                                                 | Track weights compose naturally into CSS grid templates and survive multiple divider counts cleanly.                                                  |
| 5   | Divider rendering becomes data-driven from `DividerSpec[]`.                                                                                                      | This removes the current growth path of one more hard-coded component branch per layout.                                                              |
| 6   | New layout id is `grid3x2`.                                                                                                                                      | It is explicit about geometry and leaves room for other 6-pane layouts later.                                                                         |
| 7   | `grid3x2` uses `cols: [1, 1, 1]`, `rows: [1, 1]` as its default ratios.                                                                                          | Symmetric default, consistent with the existing system's bias toward simple canonical defaults.                                                       |
| 8   | `grid3x2` autoshrink policy is `6/5 -> grid3x2`, `4 -> quad`, `3 -> threeRight`, `2 -> vsplit` unless the current 2-pane semantic explicitly preserves `hsplit`. | Avoids surprising collapse to `single` too early and keeps the shrink path predictable.                                                               |
| 9   | Existing layouts are migrated onto the registry before `grid3x2` is enabled in the user-facing pill group.                                                       | Keeps the refactor bisectable and avoids mixing infrastructure churn with the new feature all at once.                                                |

## Architecture

### 1. Central layout registry

New module family:

```text
src/features/terminal/layout-registry/
├── index.ts
├── layoutIds.ts
├── layoutSpecs.ts
├── ratioModel.ts
├── dividerSpecs.ts
└── layoutRegistry.ts
```

Suggested public shape:

```ts
export type LayoutId =
  | 'single'
  | 'vsplit'
  | 'hsplit'
  | 'threeRight'
  | 'quad'
  | 'grid3x2'

export interface LayoutRatiosModel {
  cols: number[]
  rows: number[]
}

export interface DividerSpec {
  id: string
  axis: 'horizontal' | 'vertical'
  gridArea: string
  trackIndex: number
}

export interface ResolvedGrid {
  cols: string
  rows: string
  areas: readonly (readonly string[])[]
}

export interface LayoutSpec {
  id: LayoutId
  label: string
  capacity: number
  cycleOrder: number
  createDefaultRatios: () => LayoutRatiosModel
  resolveGrid: (ratios: LayoutRatiosModel) => ResolvedGrid
  getDividerSpecs: (ratios: LayoutRatiosModel) => DividerSpec[]
  autoShrinkTo: (nextPaneCount: number, currentLayoutId: LayoutId) => LayoutId
}
```

The registry exports:

- ordered visible layouts
- lookup by `LayoutId`
- keyboard cycle helper
- restore validation helper
- autoshrink helper

### 2. Ratio model

Current:

```ts
type LayoutRatios = { col: number; row: number }
```

Proposed:

```ts
interface LayoutRatiosModel {
  cols: number[]
  rows: number[]
}
```

Examples:

- `single` -> `{ cols: [1], rows: [1] }`
- `vsplit` -> `{ cols: [1, 1], rows: [1] }`
- `hsplit` -> `{ cols: [1], rows: [1, 1] }`
- `threeRight` -> `{ cols: [1.4, 1], rows: [1, 1] }`
- `quad` -> `{ cols: [1, 1], rows: [1, 1] }`
- `grid3x2` -> `{ cols: [1, 1, 1], rows: [1, 1] }`

The resize system continues to reason in terms of track sizes, but the state
shape is no longer coupled to "exactly one column split and one row split".

### 3. Grid resolution

`resolveGrid` is moved behind the registry. The input is a `LayoutSpec` plus
its current ratios, and the output is the concrete CSS grid template:

- `grid-template-columns`
- `grid-template-rows`
- `grid-template-areas`

For `grid3x2`, the resolved grid should explicitly segment vertical dividers
around the full-width row divider so rendering remains direct and data-driven:

```ts
;[
  ['p0', 'vdiv0a', 'p1', 'vdiv1a', 'p2'],
  ['hdiv', 'hdiv', 'hdiv', 'hdiv', 'hdiv'],
  ['p3', 'vdiv0b', 'p4', 'vdiv1b', 'p5'],
]
```

### 4. Divider rendering

`SplitDividers` no longer switches directly on layout id. Instead it renders
the divider specs returned by the active layout spec.

This implies a small widening of `useSplitDivider`:

- accept arbitrary CSS variable names or track bindings
- map `trackIndex` to the appropriate track weight update
- preserve keyboard and drag behavior already shipped for the current layouts

### 5. Autoshrink

Autoshrink policy becomes registry-owned rather than living as a partially
global rule in `paneLifecycle.ts`.

Suggested entrypoint:

```ts
getAutoShrinkTarget({
  currentLayoutId,
  nextPaneCount,
})
```

This keeps shrink behavior attached to layout semantics, not distributed across
session mutation helpers.

### 6. Restore and layout legality

Restore code should stop maintaining a separate manual list of valid layout ids.
Instead it should ask the registry whether a layout id is known and fall back to
`single` only for truly unknown values.

This prevents the current class of bug where a newly persisted layout silently
restores as `single` because one whitelist was not updated.

## PR slicing

This feature should ship through an umbrella branch with small PRs:

1. **PR1: central registry extraction**
   - add layout-registry module
   - migrate existing 5 layouts onto it
   - keep runtime behavior identical
2. **PR2: extensible ratio model**
   - widen ratio state and divider bindings
   - keep current layouts visually unchanged
3. **PR3: `grid3x2` support**
   - add new layout spec, glyph, pill, shortcuts, restore support
4. **PR4: polish and follow-up behavior**
   - targeted shrink-path refinements, tests, roadmap/progress updates, any
     small correctness fixes discovered in real usage

## Verification

At the end of the feature:

1. All existing layouts still render and resize correctly.
2. `Cmd/Ctrl+\` cycles through the registry order, including `grid3x2`.
3. Restore accepts and round-trips `grid3x2`.
4. `grid3x2` can host up to 6 panes and shrink predictably.
5. The layout system can express future multi-column layouts without changing
   the core ratio type again.

## Risks

1. The ratio-model migration can accidentally regress current `quad` and
   `threeRight` resize semantics if track ordering is not tested carefully.
2. `SplitDividers` currently has layout-specific behavior around segmented
   handles; a partial refactor can leave hidden assumptions behind.
3. PR2 is the highest-risk step because it changes the underlying geometry
   representation while preserving visible behavior.

## Open follow-ups

1. Persist ratios across reload if product value justifies it.
2. Allow the layout display config surface to hide or reorder visible layouts
   once the registry exists.
3. Consider whether browser panes and shell panes need different future default
   layout sets.
