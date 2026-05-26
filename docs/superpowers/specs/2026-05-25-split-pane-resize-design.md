# Split-pane resize — design

- **Date:** 2026-05-25
- **Status:** Draft (awaiting review)
- **Area:** `src/features/terminal/components/SplitView/`, `src/features/workspace/components/DockPanel.tsx`, `src/components/`, `src/hooks/`
- **Topic:** Drag-to-resize the boundary between panes for every non-`single` layout, reusing the dock's elastic-resize machinery.

## Goal

When a session's layout is anything other than `single`, the user can drag the
border between panes to change their relative width and/or height. The
interaction reuses the resize machinery already shipped for the dock
(`useElasticContainer` + the dock's resize-handle affordance) rather than
inventing a parallel system.

## Decisions locked

| # | Decision | Source |
| - | -------- | ------ |
| D1 | Extract the dock's inline resize-handle markup into a shared `ResizeHandle` primitive **first**, as its own step. | user |
| D2 | Split ratios are **remembered within the session** (survive layout cycling and tab switches) but **not persisted across reload** — matching the existing non-persistence stance for `Pane.userLabel`. | user |
| D3 | `quad` uses a **shared cross**: one column split shared by both rows, one row split shared by both columns (2 logical dividers). Not independent per-quadrant tiling. | recommended default — flagged for veto |
| D4 | Cycling layouts (e.g. `vsplit → single → vsplit`) **keeps** each layout's remembered ratio rather than resetting to the default split. | recommended default — flagged for veto |

## Non-goals

- No persistence of ratios across app reload (D2). Easy follow-up later via the
  same localStorage-by-session-id mechanism `activityPanelCollapsed` uses.
- No independent per-quadrant resizing in `quad` (D3).
- No drag-to-reorder / drag-to-swap panes. This is resize only.
- No change to the keyboard layout-cycle (`Ctrl/Cmd+\`) or pane capacity rules.
- No backend / IPC / bindings changes — this is entirely frontend.

## Background (existing pieces we build on)

**Reusable machinery (the "dock thing"):**

- `src/hooks/useResizable.ts` — low-level mouse-drag → clamped pixel size, RAF
  coalesced, with `commit-on-end` + `onDragPreview` (drag a CSS value live,
  commit React state on mouseup), keyboard `adjustBy`, and `invert`.
- `src/hooks/useElasticContainer.ts` — wraps `useResizable` with a
  `containerRef` + `axis` + min/max **percent**. A `ResizeObserver` tracks the
  container dimension and converts pixel↔percent, restoring the user's intended
  proportion across window shrink→expand via `desiredPercentRef`. Returns
  `size` (px), `pixelMin`/`pixelMax`, `handleMouseDown`, `adjustBy`,
  `isDragging`. **A split divider's position is "X% of the pane space along one
  axis" — close to what this hook models, but the divider track and the grid's
  padding must be subtracted from the measured box first (see Step 2 §"Grid
  model").** We add a small backward-compatible `reservedPx` option to the hook
  to do exactly that. One instance per divider.
- The dock's resize-handle markup is currently inlined twice in
  `DockPanel.tsx` (lines ~269–305): `role="separator"`, `aria-orientation`,
  `aria-value*`, `tabIndex={0}`, `data-testid="resize-handle"`, hover/focus/
  active background tokens, `cursor-ns-resize` / `cursor-col-resize`.

**SplitView grid model** (`SplitView.tsx`, `layouts.ts`):

- CSS Grid with named areas. Today: `gap-2` (8px) between panes, `p-2.5` (10px)
  outer padding, panes placed via `gridArea: p${i}`, track sizes are static `fr`
  strings (`vsplit`/`hsplit`/`quad` = `1fr 1fr`; `threeRight` cols = `1.4fr 1fr`).
- No per-pane / per-split size state exists today on `Pane` or `Session`.

**Hidden-session constraint (important):** `TerminalZone` renders **every**
session's `SplitView` simultaneously and hides inactive ones with a `hidden`
class (to keep PTYs alive). `useElasticContainer` **hard-throws in DEV when its
container has zero dimension at mount** — and a hidden session's grid is
zero-sized. Therefore the divider layer must **only mount for the active
session** (see Step 2 §"Active-only mounting").

## Step 1 — Extract the `ResizeHandle` primitive (refactor, no behavior change)

New cross-feature primitive at `src/components/ResizeHandle.tsx` (sibling
`ResizeHandle.test.tsx`), alongside the existing `Tooltip` precedent. It owns
the *affordance*; the *consumer* owns *placement*.

**Owns (the primitive):** `role="separator"`, `aria-orientation`,
`aria-label` (default `"Resize panel"`), `aria-valuenow/min/max`,
`tabIndex={0}`, `data-testid` (default `"resize-handle"`, overridable),
`onMouseDown`, `onKeyDown`, the cursor (`horizontal` orientation → `ns-resize`,
`vertical` → `col-resize`), and the interaction colors
(`transition-colors hover:bg-primary/20 focus:bg-primary/40 focus:outline-none`,
plus `bg-primary/30` while `isDragging`).

**Owned by the consumer (via `className` + optional `style`):** position
(`absolute` offsets, `gridArea`/line placement), the stretch + thickness
(`left-0 right-0 h-1`, or `h-full w-full` to fill a track), and `z-index`.

Splitting responsibilities this way avoids the Tailwind merge footgun: the
primitive sets *cursor / background / transition*; the consumer sets
*position / size / z* — disjoint properties, so class order never matters.

```ts
interface ResizeHandleProps {
  orientation: 'horizontal' | 'vertical' // aria-orientation; picks the cursor
  isDragging: boolean
  ariaValueNow: number
  ariaValueMin: number
  ariaValueMax: number
  ariaLabel?: string // default 'Resize panel'
  testId?: string // default 'resize-handle'
  onMouseDown: (event: React.MouseEvent) => void
  onKeyDown: (event: React.KeyboardEvent) => void
  className?: string
  style?: React.CSSProperties
}
```

**DockPanel migration:** both inline handles become `<ResizeHandle>`. The
consumer keeps exactly today's positioning classes, e.g. the vertical-dock
handle passes
`className={`absolute ${position === 'top' ? 'bottom-0' : 'top-0'} left-0 right-0 z-10 h-1`}`
(the `z-10` comment about painting above `DockTab` stays at the call site). The
keyboard handlers (`handleVerticalKeyDown` / `handleHorizontalKeyDown`) and the
elastic-hook wiring are unchanged. Because the primitive preserves the same
`data-testid`, `role`, and `aria-*`, `DockPanel.test.tsx` stays green — it is
the regression net for this refactor.

This step is a pure refactor: identical rendered output and behavior.

## Step 2 — Split-pane dividers

### Divider map per layout

| Layout | Logical dividers | Handle elements | Notes |
| ------ | ---------------- | --------------- | ----- |
| `single` | 0 | 0 | nothing to resize |
| `vsplit` | 1 column (p0 \| p1) | 1 | full-height vertical bar, `col-resize` |
| `hsplit` | 1 row (p0 / p1) | 1 | full-width horizontal bar, `ns-resize` |
| `threeRight` | 1 column (p0 \| right) + 1 row (p1 / p2) | 2 | row divider spans the right column only |
| `quad` | 1 column + 1 row (shared cross) | 3 | column bar is segmented by the row bar (two elements, one hook); see below |

### Grid model: the draggable border *is* a grid track

Rather than overlay handles and compute their position from container width
minus padding/gap (fragile), we make the **border itself a grid track**. The
inter-pane gap is replaced by an explicit divider track that holds the
`ResizeHandle`; the browser's grid engine positions the handle exactly, with no
offset math for placement. (Pane *sizing* still needs a one-time reconciliation
for the divider width + padding — see "Sizing math" below.) This also matches
the user's mental model literally — "drag the border."

The first track's size comes straight from the elastic hook in pixels (the dock
pattern: dock sets `width: ${size}px`), the divider track is a fixed ~8px (≈
today's `gap-2`, giving a comfortable hit area), and the trailing track takes
the rest:

- `vsplit`: `gridTemplateColumns: ${colSize}px 8px minmax(0,1fr)`, areas
  `[['p0','vdiv','p1']]`.
- `hsplit`: `gridTemplateRows: ${rowSize}px 8px minmax(0,1fr)`, areas
  `[['p0'],['hdiv'],['p1']]`.
- `threeRight`: cols `${colSize}px 8px minmax(0,1fr)`, rows
  `${rowSize}px 8px minmax(0,1fr)`, areas
  `[['p0','vdiv','p1'],['p0','vdiv','hdiv'],['p0','vdiv','p2']]` — `p0` and
  `vdiv` each span all three rows; the row divider `hdiv` lives only in the
  right column.
- `quad`: cols `${colSize}px 8px minmax(0,1fr)`, rows
  `${rowSize}px 8px minmax(0,1fr)`, areas
  `[['p0','vdiv0','p1'],['hdiv','hdiv','hdiv'],['p2','vdiv1','p3']]`. The
  full-width row divider `hdiv` interrupts the column bar, so the column bar is
  two named cells (`vdiv0`, `vdiv1`) **driven by the same column hook** — one
  logical divider, two `ResizeHandle` elements that move together. Visually a
  clean `┼` with the horizontal bar dominant. (The inverse — segmenting the row
  bar instead — is equivalent; we pick the column bar to segment.)

The outer grid drops its inter-pane `gap` along divider axes (the divider track
replaces it); `single` is unchanged. Net visual spacing stays ~8px.

Because the handles are placed by grid *area*, they must be **direct grid
children** of `SplitView`'s outer grid div. `SplitDividers` therefore returns a
fragment of `<ResizeHandle style={{ gridArea: 'vdiv' }} … />` elements rendered
directly inside the grid (no wrapping `<div>`, which would break area
placement). The committed track sizes are emitted as CSS variables on the outer
div (e.g. `grid-template-columns: var(--split-col, <committed>px) 8px
minmax(0,1fr)`) so the live drag preview just rewrites the variable.

A small helper colocated with `layouts.ts`, e.g.
`resolveGrid(layoutId, sizes): { cols, rows, areas }`, produces the
divider-aware template from the existing `LAYOUTS` geometry plus the current
`{ colSize, rowSize }`. `LAYOUTS` stays the single source of geometry.

**Sizing math (reconciling the divider track + padding).** Two corrections make
the px tracks behave and keep the defaults honest:

1. **Measure the content box, not the padded box.** `useElasticContainer`
   measures `getBoundingClientRect()`, which includes the grid's `p-2.5`
   padding. So the divider layer measures the _inner_ grid: padding moves to an
   outer wrapper and the measured grid div carries no padding, making its box
   exactly the pane content width `Wc`.
2. **Reserve the divider width.** Add an optional `reservedPx` to
   `useElasticContainer` (default `0`, so the dock is unchanged). With
   `reservedPx = 8`, the hook applies its min/max/initial percentages to the
   _pane space_ `Wp = Wc − 8` rather than `Wc`, and also returns `Wp` so callers
   can convert between the hook's pixel `size` and a stored ratio.

With both in place, the template `${colSize}px 8px minmax(0,1fr)` gives
`track1 = colSize` and `track2 = Wc − colSize − 8 = Wp − colSize`. At the
default `colSize = 0.5·Wp` both panes are `0.5·Wp` — **symmetric, and
pixel-identical to `main`** (today's `1fr 1fr` + `gap-2` is also `(Wc − 8) / 2`
per pane). The 15–85% bounds (over `Wp`) then hold for _both_ panes, since
`track2 = Wp − track1 ∈ [0.15, 0.85]·Wp` whenever `track1 ∈ [0.15, 0.85]·Wp`.
`threeRight`'s default `colSize = 0.583·Wp` reproduces its current `1.4 : 1`.

### Ratio state + remember-within-session (D2)

`SplitView` owns the ratio state. Model it per layout so each layout remembers
its own split:

```ts
type LayoutRatios = { col: number; row: number } // fractions in (0,1)
// SplitView state: Partial<Record<LayoutId, LayoutRatios>>
```

Interpretation: `col` = the column split fraction (`vsplit`, `threeRight`
left|right, `quad`); `row` = the row split fraction (`hsplit`, `threeRight`
p1|p2, `quad`). Defaults derive from current `fr` values (`vsplit` col 0.5;
`hsplit` row 0.5; `threeRight` col ≈ 0.583 = 1.4/2.4, row 0.5; `quad`
0.5/0.5). State lives in the always-mounted `SplitView`, so it survives the
session being hidden (tab switch) and layout cycling — D2 comes essentially for
free. It resets only on reload (the `hidden` SplitView still unmounts then).

### Active-only mounting (the zero-dimension guard)

The hooks live in a child `<SplitDividers>` that `SplitView` renders **only when
`isActive`** (and therefore visible/non-zero). This sidesteps the
`useElasticContainer` zero-dimension DEV throw for hidden sessions.

`<SplitDividers>` does **not** call a variable number of hooks itself — that
would trip `react-hooks/rules-of-hooks`. Instead it switches on the layout and
renders a **per-layout subcomponent with a fixed hook count**, so each component
calls exactly the hooks it always needs:

- `VSplitDividers` / `HSplitDividers` — exactly **one** `useElasticContainer`.
- `ThreeRightDividers` / `QuadDividers` — exactly **two** (one per axis).

Each subcomponent is keyed by layout (`key={session.layout}`) so switching
layouts unmounts the old subcomponent and mounts the new one cleanly, seeding
each hook's `initialPercent` from the remembered ratio for that layout. (The key
governs _state reset on layout change_; the per-layout components are what keep
the hook calls unconditional.)

Inactive sessions render their grid from the remembered ratios directly (no
hooks, no handles) so revealing them shows the right proportions with no flash.

### Data flow

`useElasticContainer` has no `onCommit` callback — its **`size` (React state)**
is the committed value, and it updates on every path that matters: drag end,
keyboard `adjustBy`, and `ResizeObserver`. `onDragPreview` fires _only_ during a
mouse drag (in `commit-on-end` mode) and _not_ on the keyboard/observer paths.
The bridge is built around those two facts:

```
SplitView (owns remembered ratios + the grid template, always mounted)
  ├─ grid-template-*: var(--split-col, <remembered px>) 8px minmax(0,1fr)
  │     (the CSS var is the live driver; the fallback = remembered ratio)
  └─ when isActive: <SplitDividers> → per-layout subcomponent
        owns useElasticContainer per divider
          (axis, SPLIT_ELASTIC_CONFIG, reservedPx=8, initialPercent=remembered)
        ├─ during drag (commit-on-end): onDragPreview(px) writes --split-col on
        │    the outer div — smooth, no React re-render
        ├─ on every committed `size` change (drag end | keyboard | resize), a
        │    useEffect on `size`:
        │      • writes --split-col = `${size}px` (keeps the var current on the
        │        paths onDragPreview skips — keyboard + observer)
        │      • calls onRatioChange(layout, axis, size/Wp) so SplitView updates
        │        its remembered ratio (seeds the fallback + future remounts)
        └─ on unmount (session deactivates): clears --split-col so the
             remembered-ratio fallback drives the now-hidden session
```

Single writer of the live value: `SplitDividers` owns `--split-col` while
mounted; `SplitView`'s remembered ratio only seeds the fallback and survives
remounts. They can't drift, because the effect re-derives the ratio from the
same `size` it writes to the var. Window resizes ride the hook's
`ResizeObserver`/`desiredPercentRef` exactly like the dock, and `aria-valuenow`
tracks `size` on every path.

### Bounds config

Add to `src/features/workspace/panelConfig.ts` (where the dock configs live):

```ts
export const SPLIT_ELASTIC_CONFIG = {
  minPercent: 0.15, // a pane can't shrink below 15% of the pane space Wp
  maxPercent: 0.85,
  // initialPercent supplied per-divider from the remembered/default ratio
} as const
```

The percentages apply to the pane space `Wp = Wc − 8` (via the hook's
`reservedPx`), so both the leading and trailing pane stay within 15–85% (see the
sizing math above). Keyboard step reuses the shared `KEYBOARD_STEP_PX` /
`KEYBOARD_STEP_SHIFT_PX`.

### Alternative considered — overlay handles (rejected)

Keep the current gap-based grid and float absolutely-positioned handles over the
gaps, computing each handle's offset from the measured container dimension minus
`p-2.5` padding and `gap-2`. Rejected: the padding/gap offset math is fragile
across all four layouts (and unavoidable for `quad`'s cross), whereas
handle-as-track lets the grid engine place everything exactly. Overlay touches
`layouts.ts` less, but trades correctness for it.

## Testing strategy

Co-located, TDD, `import { test, expect } from 'vitest'` in every new test file
(globals don't satisfy `tsc -b` / lint-staged).

- `ResizeHandle.test.tsx`: renders `role="separator"`; `orientation` drives
  cursor class + `aria-orientation`; `isDragging` toggles the active background;
  `onMouseDown`/`onKeyDown` fire; consumer `className`/`style` pass through.
- `DockPanel.test.tsx`: unchanged assertions must still pass (regression net for
  Step 1).
- `SplitDividers.test.tsx`: each per-layout subcomponent calls a fixed hook
  count; the divider element count per layout matches the map (0/1/1/2/3);
  `quad` exposes two column-handle elements bound to one hook; a committed drag
  updates `--split-col` and calls `onRatioChange` with a clamped ratio; keyboard
  `adjustBy` updates the var + ratio on a path where `onDragPreview` never fires.
- `SplitView.test.tsx`: additions — `single` renders no dividers; dividers are
  absent when `isActive={false}`; a committed ratio changes the grid template;
  cycling layout and returning restores the remembered ratio (D2); switching the
  active session away and back preserves ratios.
- `layouts.test.ts` / `resolveGrid` test: default sizes reproduce today's
  templates; divider-aware templates have the expected track counts and area
  matrices.

## Risks / edge cases

- **Zero-dimension throw** for hidden sessions → handled by active-only mounting.
- **Rules-of-hooks** with variable divider counts → handled by per-layout
  subcomponents with fixed hook counts (the `key={layout}` only resets state).
- **Pane capacity vs. visible panes:** `selectVisiblePanes` can rescue an
  over-capacity active pane into the last slot; dividers key off the *layout*
  (fixed track structure), not the live pane list, so this is unaffected.
- **Spacing parity:** replacing `gap` with an 8px divider track must keep the
  current visual rhythm; `single` keeps no divider and is byte-identical.
- **Tailwind class merge:** avoided by the disjoint-property split in Step 1.

## Sequencing

1. **Step 1** — `ResizeHandle` extraction + DockPanel migration (refactor;
   `DockPanel.test.tsx` green).
2. **Step 2** — extend `useElasticContainer` with `reservedPx` (+ expose `Wp`;
   default `0` keeps the dock unchanged), `SPLIT_ELASTIC_CONFIG`, `resolveGrid`,
   the per-layout `SplitDividers` subcomponents, the `SplitView` padding-wrapper
   refactor + remembered-ratio state + active-only mounting, and tests
   (including a dock regression pass for the `reservedPx = 0` path).

Each step is independently reviewable and shippable; Step 2 depends on Step 1.
Exact branch/PR strategy (single PR with two commits vs. two stacked PRs on a
`feat/` integration branch) is deferred to the implementation plan.

<!-- codex-reviewed: 2026-05-26T04:27:36Z -->
