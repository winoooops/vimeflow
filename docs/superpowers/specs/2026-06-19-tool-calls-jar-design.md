# Tool Calls Jar — design spec

**Date:** 2026-06-19 · **Status:** approved (demo-validated) · **Area:** `src/features/agent-status`

## Overview

Replace the activity panel's **Tool Calls** readout — today a wrapping list of
`name + count` chips (`ToolCallSummary`) — with a self-contained **packed
vessel**: a recessed tank tiled edge-to-edge with soft-cornered rectangles, one
per tool, each sized by how often that tool was called. Counts roll like an
odometer, tiles bloat/shrink to rebalance as calls arrive, and brand-new tools
pop in with an entrance animation. A long tail of trivial tools folds into a
single **"others"** shape that reveals the full breakdown on hover. A header
switcher flips between the new **Packed** view and the original **Tags** view.

Source handoff: `~/Downloads/design_handoff_toolcalls_jar/` (canonical reference
`toolcalls.jsx`). A throwaway variant-explorer (`~/Downloads/tool-calls-jar-demo.html`)
was used to validate the theme-adaptive recipe across all four themes and to
settle the open decisions below.

## Decisions (locked)

| Decision         | Choice                                                                                                  | Why                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Tile color       | **Theme-adaptive** ramp from `--color-primary*` tokens                                                  | Multi-theme app + `no-hardcoded-colors`; validated across Catppuccin / Flexoki / Tokyo Night / Dracula |
| Views            | **Both** Packed + Tags, with persisted switcher                                                         | It's the handoff design; keeps the original representation                                             |
| Equal height     | Both views occupy the **same** body height (vessel height, **180px**)                                   | Toggling must not shift the panel                                                                      |
| Tags fill        | `align-content: space-between` so rows span the full box                                                | "Always fill the space"; mirrors the jar's edge-to-edge fill                                           |
| Tags scrollbar   | `overflow-y:auto` + **scrollbar hidden** (`scrollbar-width:none` / `::-webkit-scrollbar{display:none}`) | Kills the entrance-pop scrollbar flash; no bar ever paints; wheel-scroll still works                   |
| No top fade      | dropped the scroll mask                                                                                 | The top gradient clipped the first pill row                                                            |
| Widget feel      | `cursor: default` + `select-none` on the section                                                        | Non-editable status surface — no text I-beam                                                           |
| Odometer font    | **Manrope** (`font-display`)                                                                            | Reference's Instrument Sans isn't shipped; matches Token Cache's big number                            |
| Active indicator | **Dropped**                                                                                             | Dead in current wiring (running tool is promoted to `LiveActionCard`)                                  |
| Demo-only bits   | **Dropped** synthetic auto-stream + `vf:toolcall` listener                                              | Production drives from real `status.toolCalls`                                                         |

## Architecture

New group `src/features/agent-status/components/ToolCalls/`. Each file has a
co-located `.test.tsx`/`.test.ts`.

```
components/ToolCalls/
  ToolCallsSection.tsx     # section shell: header (label · total · switch) + body; replaces ToolCallSummary
  ToolJarVessel.tsx        # recessed tank; self-measures width; packs + renders tiles
  ToolJarTile.tsx          # one tile: tone, auto-fit label, entrance, geometry transitions
  ToolJarBreakdown.tsx     # portaled "others" hover card
  ToolTagsView.tsx         # TjTagView + TjTag — accent-tinted pills (fills height)
  ToolCallsViewSwitch.tsx  # 2-button segmented toggle (grid_view / sell)
  OdometerNumber.tsx       # digit-roll number (TjNumber/TjDigit)
utils/
  squarify.ts              # tjSquarify + tjPack (squarified treemap)
  toolJarAggregate.ts      # tjAggregate (others folding)
  toolJarTone.ts           # theme-adaptive tone + auto-contrast (eslint-disable, like contextTone)
  toolCallsToTools.ts      # byType Record -> ordered Tool[]
hooks/
  useToolCallsView.ts      # localStorage pub/sub via useSyncExternalStore
  useElementWidth.ts       # vessel ResizeObserver width
  useAutoFitScale.ts       # per-tile auto-fit (delayed re-measures + ResizeObserver)
```

## Data flow & integration

In `AgentStatusPanel/index.tsx`, replace the `ToolCallSummary` element with:

```tsx
<ToolCallsSection
  total={status.toolCalls.total}
  byType={status.toolCalls.byType}
/>
```

- `tools = Object.entries(byType).map(([name, count]) => ({ name, count }))` —
  `byType` is already insertion-ordered (Rust appends new tools in arrival
  order, then increments), so tile identity (keyed by `name`) stays stable and
  tiles morph in place instead of reshuffling. `toolCallsToTools` centralizes
  this contract.
- `total` from the prop (authoritative count). `max = Math.max(...counts)`.
- Remove `ToolCallSummary.tsx` + test (verify no other importers).
  `CollapsibleSection` / `Chip` stay (shared).
- Section is a plain non-collapsible block matching sibling section rhythm
  (padding + bottom divider).

## Theme-adaptive tone (`toolJarTone`)

Per tile, `t = (count / max) ** 0.42`. The ramp is computed in JS from the
active theme's token hexes (`useTheme().ui`), mirroring CSS `color-mix(in srgb)`
exactly (a straight sRGB component lerp), so behaviour matches the demo
bit-for-bit. Locked recipe:

```
accentPct = 36 + t*58                                   // 36% … 94%
graded    = mix(primary,  surface-bright, accentPct)    // muted tail → vivid head
base      = mix(graded,   primary-deep,   73)           // darken 27% toward deep
bottom    = mix(base,     primary-deep,   84)           // gradient bottom (deep-mix 16%)
fill      = linear-gradient(152deg, base, bottom)
text      = auto-contrast(base)                         // light vs dark by relative luminance
```

where `mix(a, b, pa)` = sRGB lerp = CSS `color-mix(in srgb, a pa%, b)`. Packing
`exp = 0.3`, `minArea = 2600`, vessel height `180`.

`toolJarTone` carries a file-level `/* eslint-disable vimeflow/no-hardcoded-colors -- … */`
with justification (a per-tile continuous blend + luminance-driven contrast that
no static token can express), exactly as `contextTone.ts` does. It takes the
resolved token hexes so it stays pure and unit-testable.

**Chrome that does NOT need luminance** (vessel bg, switch, tag tint, breakdown
card, "others" tile, depth shadows) uses CSS `color-mix(in srgb, var(--color-*) X%, …)`
strings — theme-reactive and lint-clean, matching `ContextReservoirCard` /
`TokenCache`. Tag pills: `bg = color-mix(var(--color-primary-container) (7+t*16)%, transparent)`,
border `(12+t*20)%`, count in `var(--color-primary)`. "others" neutral tile:
`linear-gradient(152deg, var(--color-surface-container-high), var(--color-surface-container-lowest))`.

## Aggregation (`toolJarAggregate`) — verbatim from reference

A tool is **trivial** iff `count <= 3` AND `count/total < 0.05`. Folding only
happens when `tools.length > 8` AND `trivialCount >= 3`; otherwise every tool
shows. When folding: keep non-trivial tools in order, append
`{ name:'others', count: Σtrivial, others: [...trivial desc] }`. Constants:
`OTHERS_MAX=3`, `TRIVIAL_SHARE=0.05`, `MIN_TILES=8`, `MIN_FOLD=3`.

## Packing (`squarify`) — verbatim from reference

Squarified treemap (Bruls/Huizing/van Wijk). Area ∝ compressed weight
`max(1,count) ** exp` (`exp=0.3`), with a min-area floor
`min(minArea, (W*H)/n * 0.92)` (`minArea=2600`) so every tile is labelable.
Geometry **rounded to whole pixels** so unchanged tiles keep their exact box (no
jitter). Tile radius `min(10, m*0.16)` where `m=min(w,h)`.

## Views, equal height, fill, scrollbar, cursor

- Header row: section label "Tool calls" (mono 10px uppercase) · total odometer
  (13px/700, `text-on-surface`) · spacer · `ToolCallsViewSwitch`.
- Body is a fixed **180px** box in both views.
- **Packed**: `ToolJarVessel` fills the box.
- **Tags**: `overflow-y:auto` + `.tj-noscroll` (hidden scrollbar); inner
  `flex-wrap` with `align-content: space-between; min-height:100%` so rows span
  top-to-bottom. No fade mask.
- View persists to `localStorage['vimeflow:agent-status:toolCallsView']`
  (`'jar' | 'tags'`, default `'jar'`) via a pub/sub store + `useSyncExternalStore`,
  mirroring `sidebarCollapsedStore`.
- Section root: `cursor-default select-none`; switch buttons → `pointer`; the
  `others` tile/pill → `help`.

## Motion

- Odometer: each digit place is a `0–9` column clipped to one cell, translated by
  `transform` with `transition .5s cubic-bezier(.34,1.25,.5,1)`; digits keyed
  from the right; `tabular-nums`.
- Tile geometry: `transition left/top/width/height .8s cubic-bezier(.4,0,.2,1)`,
  fires only when rounded geometry changes.
- Entrance pop `tjEnter` (scale .4 → 1.07 → 1) on newly-mounted tiles/pills/popover.
  Defined as a real CSS keyframe in the global stylesheet (not runtime-injected),
  gated with the repo's `motion-safe:` convention.
- Auto-fit: a uniform `transform: scale(s)` on tile content, re-measured on
  mount, at `[60,200,500,1000,1800]ms`, on `document.fonts.ready`, and via
  ResizeObserver; sub-pixel deltas (<0.004) ignored. `transform-origin: left top`.
- Portal breakdown: theme vars resolve at `:root`, so use `var(--color-*)`
  directly in the portaled card (verify) rather than the reference's
  `getComputedStyle` hack.

## Testing

- `squarify`: tiles fill the rect, aspect ratios near 1, whole-px geometry,
  min-area floor honored.
- `toolJarAggregate`: trivial detection, fold/no-fold thresholds, order
  preserved, `others` sum + sorted breakdown.
- `toolJarTone`: muted tail → vivid head (saturation/contrast monotonic-ish),
  auto-contrast flips light vs dark text by luminance, deterministic strings;
  use comma-rgb assertions for jsdom.
- `toolCallsToTools`: order preserved, shape mapping.
- Hooks: `useToolCallsView` persists + restores + cross-instance sync;
  `useElementWidth` / `useAutoFitScale` via mocked `ResizeObserver` (follow
  `LiquidFill` / `ContextReservoirCard` test patterns).
- Components: view switch + persistence, odometer digit output, "others" fold +
  hover breakdown, entrance class present, reduced-motion, equal-height body,
  hidden scrollbar class, `cursor-default`.
- Coverage 80%+; TDD throughout.

## Out of scope

Synthetic auto-stream, `vf:toolcall` event, the active/"running" indicator, any
change to how `status.toolCalls` is produced upstream.
