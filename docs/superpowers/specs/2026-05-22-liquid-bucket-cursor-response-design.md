# 2026-05-22 — Liquid bucket cursor response design

## 1. Summary

The agent-status feature renders two distinct "bucket fill" surfaces today:

- `src/features/agent-status/components/Bucket.tsx` — a 22×110 SVG bucket
  with two scrolling wave paths and an ambient slosh keyframe. Used twice
  in `AgentStatusRail.tsx:97-114` (CTX and CACHE) for the collapsed rail.
- `src/features/agent-status/components/ContextBucket.tsx` — a flat CSS
  gauge: a `<div>` inside `[data-testid="bucket-gauge"]` whose height grows
  to `effectivePct%` via a 500ms `transition: height` on a linear-gradient
  fill (`ContextBucket.tsx:117-130`). Used in the expanded agent-status
  panel as the CURRENT CONTEXT card.

Both visually represent "how full is this resource," and the user has
asked for the same cursor-responsive water effect on both. This spec
introduces a single shared liquid renderer that both consume, so the
behaviour is **global to bucket-style fills in agent-status** rather than
opt-in per component.

Two new modules under `src/features/agent-status/`:

- `hooks/useWaterCursor.ts` — a rAF-driven spring that takes a wrapper
  element and a set of SVG refs, attaches `pointermove` /
  `pointerleave`, and writes seven inline transforms per frame (tilt,
  scaleY, drift, lift, skew, wave-scroll speed, and a sheen position +
  opacity). Targets relax to ambient when the cursor leaves; the loop
  shuts down and clears every inline style once the spring settles, so
  the at-rest visual is once again pure CSS keyframes.
- `components/LiquidFill.tsx` — the SVG primitive. Renders the glass
  cell, a solid base rect, two phase-offset wave paths, and a sheen
  ellipse. Mounts `useWaterCursor` on its outer `<div>`. Supports two
  modes: `mode="bar"` (fixed 22×110, used by `Bucket`) and `mode="fill"`
  (measures its container via `ResizeObserver` and renders the SVG at
  the measured size with `preserveAspectRatio="none"`, used by
  `ContextBucket`).

Two existing components are modified:

- `Bucket.tsx` keeps its public API (`pct`, `color`, `label`, `title`)
  and its label + percentage chrome, but delegates all SVG rendering to
  `<LiquidFill mode="bar" pct={...} color={...} />`. The existing
  `vf-bucket-*` ambient CSS classes move with the SVG into `LiquidFill`.
- `ContextBucket.tsx` keeps its card chrome, scale labels, progress bar,
  token counts, and the existing color thresholds (primary-container /
  tertiary / error from `getColorClass`). The flat gradient `<div>` at
  `ContextBucket.tsx:117-130` is replaced by
  `<LiquidFill mode="fill" pct={effectivePct} color={...} />`. The
  height transition that used to animate the gradient's `height` is
  absorbed by the wave's `waterTop` y-coordinate transition inside
  `LiquidFill`, so percentage changes still rise smoothly.

The hook lives on each `LiquidFill` instance — there are no global
listeners, no module-level state, and no shutdown hooks. When the rail
collapses → expands, when the agent panel closes, or when the React
tree unmounts the component for any reason, the hook's cleanup cancels
its rAF and removes its listeners. **Reset is structural, not
imperative.**

No backend, no IPC, no preload changes.

## 2. Scope

In scope:

- New shared hook + primitive (`useWaterCursor`, `LiquidFill`).
- Modifying `Bucket.tsx` to delegate to `LiquidFill`.
- Modifying `ContextBucket.tsx`'s gauge fill to use `LiquidFill`.
- Moving the `vf-bucket-wave-a/b` and `vf-bucket-slosh` CSS from
  `src/index.css` into a renamed `vf-liquid-*` block that both consumers
  share (the rename is mandatory because the rules now apply outside the
  rail-only `Bucket`).
- Spec-defaults tuning constants live in `LiquidFill.tsx` as a single
  `LIQUID_DEFAULTS` object.

Out of scope:

- Touching `TokenCache.tsx`, `BudgetMetrics.tsx`, `FilesChanged.tsx`,
  `TestResults.tsx`, or any other agent-status component that does not
  render a "fill level." A follow-up may extend the primitive there.
- Touching `AgentStatusRail.tsx`, `AgentStatusPanel/`, or `Header.tsx` —
  the agent-status panel collapse / expand / close lifecycle is the
  feature's natural unmount path and is unchanged.
- Touching `src/features/terminal/`, `src/features/files/`,
  `src/features/diff/`, or any other feature.
- Backend changes — there are none.
- Storybook / visual-regression scaffolding — this repo has no Storybook
  setup and adding one is not part of this change.

## 3. Tuning constants (locked)

These are the values the user selected by hand in
`~/projects/water-bucket-prototype/index.html`, frozen here as the
production defaults:

```ts
export const LIQUID_DEFAULTS = {
  // Field
  halo: 70, // px — radius around the bucket where the cursor
  //      starts to influence the surface
  omega: 6.5, // rad/s — spring stiffness (critically damped,
  //         zeta = 1.0). ~600 ms settling time.

  // Response
  maxTilt: 1.6, // deg — whole-body rotation toward the cursor
  ampMax: 1.5, // × ambient — wave amplitude gain at full proximity
  maxShift: 1.0, // px — horizontal drift of the wave near the cursor
  maxLift: 1.0, // px — vertical pull of the surface toward the cursor
  meniscus: 2.3, // deg — surface-skew (skewX on the wave layers)
  speedup: 1.02, // × — wave-scroll animation-duration multiplier
  //     when the cursor is at the bucket
} as const
```

A `prefers-reduced-motion: reduce` media query short-circuits the hook
to a no-op (matching the existing behavior at `src/index.css:209-215`).
The ambient CSS keyframes are also disabled by the same media query, so
the at-rest visual under reduced motion is a static gradient fill — the
same fallback we ship today.

## 4. `useWaterCursor` hook

Location: `src/features/agent-status/hooks/useWaterCursor.ts`.

Signature:

```ts
export interface LiquidRefs {
  slosh: SVGGElement // wrapper for the tilt rotation
  waveAShift: SVGGElement // wave-A translate / scale / skew target
  waveBShift: SVGGElement // wave-B translate / scale / skew target
  waveAAnim: SVGGElement // wave-A animation-duration target
  waveBAnim: SVGGElement // wave-B animation-duration target
  sheen: SVGEllipseElement // sheen position + opacity target
  waterTop: number // y of the waterline at rest (px)
  ambientAmp: number // wave amplitude at rest (px)
  dims: { w: number; h: number } // SVG viewport size, used for the
  //   rotate transform-origin
}

export const useWaterCursor: (
  wrapRef: RefObject<HTMLElement>,
  refsRef: RefObject<LiquidRefs | null>,
  tune?: Partial<typeof LIQUID_DEFAULTS>
) => void
```

The hook only reads from the refs — never writes through React state.
Each animation frame it integrates a critically-damped spring for eight
scalar signals (`tilt`, `amp`, `shiftX`, `lift`, `skew`, `speedT`,
`sheenX`, `sheenA`) and writes the result directly to the DOM via the
ref handles. React renders are not involved in the loop.

Lifecycle:

- On mount: register `pointermove` and `pointerleave` on `wrapRef.current`.
- On `pointermove`: compute proximity (smoothstep, not linear — kills
  the "jittery at distance" feel where a cursor twitch 200px away makes
  the water visibly move) and update spring targets.
- On `pointerleave`: targets snap to ambient (`tilt=0`, `amp=1`, …).
- The rAF loop runs only while any signal is away from its target. Once
  all eight signals settle and all eight targets are at ambient, the
  loop calls `clearInline()` (removes every inline style it added,
  removes the `data-interactive="on"` attribute) and cancels itself.
  This is what hands control back to the CSS keyframes.
- On unmount: cancel rAF, remove listeners, run `clearInline()`. Idempotent.

Reduced-motion: if
`window.matchMedia('(prefers-reduced-motion: reduce)').matches` is true,
the hook installs no listeners and the inline transforms never appear.
The ambient CSS classes themselves are disabled by the same media query
inside `src/index.css`, so the visual is a static fill.

## 5. `LiquidFill` primitive

Location: `src/features/agent-status/components/LiquidFill.tsx`.

```ts
export interface LiquidFillProps {
  pct: number // 0..100
  color: string // CSS color for the wave fill
  mode: 'bar' | 'fill'
  ariaHidden?: boolean // default true
  className?: string // applied to the outer <div>
  testId?: string
  tune?: Partial<typeof LIQUID_DEFAULTS>
}
```

Internals:

- `mode="bar"`: SVG is rendered at `22×110` with `viewBox="0 0 22 110"`
  and `preserveAspectRatio="xMidYMid meet"`. This is the exact geometry
  the current `Bucket` ships, so the rail mockup does not shift by a
  pixel.
- `mode="fill"`: a `ResizeObserver` measures the outer `<div>` and the
  SVG renders at the measured width × height with
  `preserveAspectRatio="none"`. The wave path's `width` argument is set
  to the measured CSS width × 2 (matching the `DIMS.w * 2` scaling the
  prototype uses) so the wavelength looks the same whether the gauge is
  60px wide or 240px wide.

Geometry — these are constants and behaviors that come straight from the
prototype:

- `liquidH = (h - 4) * (pct / 100)` — usable interior height is reduced
  by 2px at top and 2px at bottom for the glass frame.
- `top = h - liquidH` — y of the waterline at rest.
- `ambientAmp = min(1.8, w * 0.09)` for `mode="bar"`. For `mode="fill"`,
  the same formula is used, so on a 200-px-wide gauge the ambient amp
  reaches its 1.8 cap immediately — wide tanks don't get unreasonably
  large waves.
- Two wave paths are built via `buildWavePath(w * 2, ambientAmp, h,
phase)` at `phase=0` and `phase=0.25`. Phase-offsetting prevents the
  two waves from cancelling into a horizontal line at any moment.
- The solid base rect's y is `top + ambientAmp + 0.5` — **below the
  wave's deepest trough**. This is the key fix that hides what used to
  read as a static seam at the water surface: the rect's flat top edge
  sits inside the wave's filled body and is never visible.

Pct transitions: `mode="fill"`'s `waterTop` is animated by a CSS
`transition: y 500ms ease` on the wave-shift `<g>` elements (matching
the 500ms transition the current ContextBucket gradient uses at
`ContextBucket.tsx:123`), so percentage changes still rise smoothly.

ARIA: when `ariaHidden !== false`, the SVG carries `aria-hidden="true"`
and the cursor effect carries no role. The percentage text and label
that consumers render around `LiquidFill` (in `Bucket.tsx`) and the
percentage text in `ContextBucket.tsx:92-97` remain the accessible
representation of state. No additional `aria-live` is added.

## 6. Consumer changes

### 6.1 `Bucket.tsx`

The public API (`BucketProps = { pct, color, label, title? }`) is
unchanged. The label and percentage `<div>`s at `Bucket.tsx:38-55` and
`Bucket.tsx:142-147` are unchanged. The SVG block at `Bucket.tsx:57-140`
is replaced by:

```tsx
<LiquidFill
  mode="bar"
  pct={clamped}
  color={color}
  testId={`bucket-${labelKey}-svg`}
/>
```

The `BucketLiquid` inner component, `buildWavePath` helper, `DIMS`
constant, `TICK_LEVELS` constant, and `useId`-based gradient-id sanitizer
move into `LiquidFill.tsx`. The 25/50/75% tick marks at
`Bucket.tsx:103-126` move with them. Existing tests
(`Bucket.test.tsx`) that assert on `data-testid="bucket-tick-25"`,
`data-testid="bucket-liquid"`, and on the rendered percentage continue
to pass because those test ids live on the SVG internals, which are now
rendered by `LiquidFill` but unchanged in structure.

### 6.2 `ContextBucket.tsx`

Lines 117-130 — the `<div data-testid="bucket-fill" ...>` block that
renders the flat gradient — are replaced by:

```tsx
<LiquidFill
  mode="fill"
  pct={effectivePct}
  color={cssVarForColorClass(pct)} // see below
  testId="bucket-fill"
/>
```

`getColorClass` at `ContextBucket.tsx:45-68` currently returns Tailwind
class fragments (`from-error/50 to-error`, etc.). `LiquidFill` needs a
single CSS color, so a sibling helper resolves the Tailwind token to the
CSS variable it expands to (`var(--md-sys-color-error)`, etc.).
`tailwind.config.js` defines these tokens; the helper does not introduce
new colors and does not change the threshold logic. The progress bar
(`ContextBucket.tsx:143-155`), token counts, header, scale, and dot
overlay are untouched.

The `data-testid="bucket-fill"` attribute is preserved on the new
`<LiquidFill>` outer `<div>` so existing snapshot or query tests keep
finding it.

## 7. CSS changes

In `src/index.css:187-215`:

- Rename `@keyframes vfSlosh`, `@keyframes vfWaveA`, `@keyframes vfWaveB`
  and the `.vf-bucket-*` selectors to `vfLiquidSlosh`, `vfLiquidWaveA`,
  `vfLiquidWaveB`, `.vf-liquid-*`. The rename signals the wider scope —
  these are no longer rail-bucket-specific.
- Add `.vf-liquid-slosh[data-interactive="on"] { animation: none; }` so
  the inline rotate from the hook wins over the CSS slosh while the
  cursor is active. The hook removes the attribute on its way back to
  rest, so the keyframe takes back over once the spring settles.
- Keep the `@media (prefers-reduced-motion: reduce)` block — adjust
  selectors to the new names.

No other CSS files change. Tailwind classes referenced by consumers
(`text-error`, `bg-primary-container`, etc.) are untouched.

## 8. Testing

Co-located tests follow the project pattern (sibling `.test.tsx`).

`hooks/useWaterCursor.test.tsx`:

- After mount, no inline transform is written until a `pointermove`
  fires (the loop only starts on demand).
- `pointermove` with the cursor over the wrap: within the next
  `requestAnimationFrame`, the slosh element gains
  `data-interactive="on"` and a non-zero `transform: rotate(...)`.
- `pointerleave`: the loop continues to run until the spring settles,
  then clears inline styles and removes `data-interactive`.
- Unmount: rAF cancelled, listeners removed, inline styles cleared.
  Tested by spying on `cancelAnimationFrame` and by asserting the
  removed-from-DOM element has no leftover inline style values on a
  ref we keep around.
- `prefers-reduced-motion: reduce` → no listeners registered (verified
  by spying on `addEventListener` on the wrap).

`components/LiquidFill.test.tsx`:

- `mode="bar"` renders an SVG at the fixed `22×110` viewport.
- `mode="fill"` renders an SVG that updates its `width` / `height`
  attributes in response to a `ResizeObserver` callback (mocked).
- Tick marks at 25/50/75 are present in `mode="bar"` (regression for
  the current Bucket visual).
- The base rect's `y` attribute equals `top + ambientAmp + 0.5`
  (regression for the surface-line fix).
- Two wave paths are built with `phase=0` and `phase=0.25` (regression
  against accidental same-phase rendering returning).

`components/Bucket.test.tsx`:

- Existing tests pass with no changes — the public API and test ids
  carried by the SVG internals are preserved.

`components/ContextBucket.test.tsx`:

- The `data-testid="bucket-fill"` element is present.
- The percentage text and color-threshold logic
  (`{ pct >= 90 → error, pct >= 80 → tertiary, else → primary-container }`)
  are unchanged.
- The 500ms transition behavior is unchanged when `pct` updates (test
  asserts the `waterTop` value, not the `height` style).

`AgentStatusRail.test.tsx`: existing tests pass.

`AgentStatusPanel/index.test.tsx`: existing tests pass.

Run `npm run test`, `npm run lint`, and `npm run type-check` before
opening the PR. The pre-push hook (`.husky/pre-push`) runs the full
vitest suite — that gate stays green.

## 9. Manual verification

The full design lives in working form at
`~/projects/water-bucket-prototype/index.html` with the locked tuning
defaults already applied. The implementation is a port of that
prototype's SVG + hook into React, so the production look-and-feel
should match it byte-for-byte once the defaults from §3 are in code.

Manual smoke checks before merge:

1. Open the app. Collapse the agent panel to the rail. Move the cursor
   slowly toward and away from the CTX bucket — water should tilt, lift,
   skew, and quicken. Repeat for CACHE.
2. Expand the agent panel. Move the cursor over the CURRENT CONTEXT
   gauge — same response in the wider rectangular tank.
3. Toggle rail collapsed ↔ expanded several times. Open Chrome devtools
   and inspect the `Bucket` and `ContextBucket` subtrees. After each
   toggle, no `[data-interactive="on"]` attributes should remain on
   detached nodes; no inline `transform` styles should linger on
   freshly mounted components.
4. Close the agent panel entirely. The `ContextBucket` is unmounted —
   browser memory inspection should not show pending rAF handles.
5. Enable "Reduce motion" at the OS level. Waves and slosh stop; the
   cursor effect stops; the fill is static. No JS errors in the console.

## 10. Risks and non-issues

- **Visual change to ContextBucket.** The flat gradient becomes a wavy
  fill. This is an aesthetic decision the user confirmed in
  brainstorming; the percentage display, scale, progress bar, and color
  thresholds are unchanged, so the _information_ the card conveys is
  identical. If review pushes back, reverting is a one-line consumer
  change (`<LiquidFill mode="fill" ...>` → the old gradient div).
- **`ResizeObserver` availability.** Already used elsewhere in the
  Electron renderer; no polyfill needed for Chrome 100+.
- **Spring stability.** Critically damped (zeta=1.0), so no overshoot.
  The fixed-omega integration runs at ≤60Hz and uses `dt` clamped to
  50ms, so frame drops do not blow up the simulation.
- **Performance.** One rAF loop per visible `LiquidFill`. With the
  current panel that's at most three (rail CTX, rail CACHE, expanded
  context bucket — and the rail bucket is unmounted when the panel
  expands, so the steady state is one or two). Each loop writes ~8
  inline style attributes per frame. Negligible on any machine that can
  run Electron.
- **Tailwind-token → CSS-var helper.** The new helper in
  `ContextBucket.tsx` (§6.2) is a small lookup table mapping the
  threshold buckets (error / tertiary / primary-container) to their
  CSS-variable names. It is co-located with `ContextBucket` (not
  exported) and not introduced as a general-purpose primitive.

## 11. File-level diff plan

```
A  src/features/agent-status/hooks/useWaterCursor.ts
A  src/features/agent-status/hooks/useWaterCursor.test.tsx
A  src/features/agent-status/components/LiquidFill.tsx
A  src/features/agent-status/components/LiquidFill.test.tsx
M  src/features/agent-status/components/Bucket.tsx
M  src/features/agent-status/components/ContextBucket.tsx
M  src/index.css                          # vf-bucket-* → vf-liquid-*
A  docs/superpowers/specs/2026-05-22-liquid-bucket-cursor-response-design.md
```

No backend (`crates/backend/`) files change. No electron preload changes.
No `package.json` changes.
