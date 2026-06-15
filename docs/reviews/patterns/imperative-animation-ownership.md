---
id: imperative-animation-ownership
category: react-patterns
created: 2026-06-15
last_updated: 2026-06-15
ref_count: 1
---

# Imperative Animation Ownership

## Summary

When an imperative animation loop (e.g., `requestAnimationFrame`) mutates DOM
attributes, React must not own those same attributes via JSX props. React's
reconciler commits the prop value before the next animation frame, so ordinary
prop updates can overwrite the live animated value for one frame and produce a
visible snap or flicker.

The fix shape:

1. Remove the JSX prop that React would reconcile (e.g., `d={...}` on an SVG
   path).
2. Seed the initial / resting attribute value imperatively via refs, usually in
   a layout effect so the first paint is valid.
3. Let the animation loop own updates during normal operation.
4. Under reduced motion (or whenever the loop is inactive), keep the static
   attribute in sync with prop changes via a passive effect so the UI still
   reflects current data.

## Findings

### 1. React-managed SVG `d` props overwrote the rAF-painted reservoir surface

- **Source:** github-codex-connector | PR #457 round 1 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/WaterTank.tsx`
- **Finding:** `WaterTank` rendered `d={resting.fill}` and `d={resting.crest}` on
  the same `<path>` elements that `useReservoirFlow` mutated every animation
  frame. When `pct` changed, React committed the new phase-0 resting path over
  the live animated path until the next rAF tick, causing a brief water-surface
  flicker.
- **Fix:** Removed the React-managed `d` props from the JSX. Added a
  `useLayoutEffect` to seed the initial/resting `d` attributes imperatively when
  the tank becomes non-empty, and a `useEffect` to re-sync the static path under
  `prefers-reduced-motion`. The rAF loop in `useReservoirFlow` now owns the
  animated `d` attributes without React interference.
- **Commit:** _(same commit as this entry)_

### 2. Reduced-motion toggle stopped rAF but left the water surface frozen in its animated state

- **Source:** github-codex-connector | PR #457 round 3 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/hooks/useReservoirFlow.ts`
- **Finding:** When `prefers-reduced-motion: reduce` was enabled mid-session,
  `onMqlChange` only called `stop()`. It did not reset `amp`/`targetAmp` or
  repaint the SVG paths, and `WaterTank`'s reduced-motion sync effect only ran
  when `resting.fill`/`resting.crest` changed. Users could see the last animated
  hover/drift frame frozen until another render-triggering data change occurred.
- **Fix:** On `mql.matches === true`, reset swell state to rest and imperatively
  write a resting `buildReservoirSurface` path to both SVG paths using the
  current geometry. Added test coverage verifying the surface returns to the
  resting crest when reduced motion is enabled mid-hover.
- **Commit:** _(same commit as this entry)_
