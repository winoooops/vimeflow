---
id: imperative-animation-ownership
category: react-patterns
created: 2026-06-15
last_updated: 2026-06-17
ref_count: 2
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

### 3. Perpetual rAF loop polls `getBoundingClientRect` at 60+ fps per pane forever

- **Source:** github-claude | PR #515 round 1 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/features/browser/components/BrowserPane.tsx`
- **Finding:** A `requestAnimationFrame` loop scheduled on mount called `syncBounds()` every frame for the component's entire lifetime. `syncBounds` ran `getBoundingClientRect()` and built a string key on every tick even when nothing had moved; the dedup only short-circuited the IPC call, not the DOM read.
- **Fix:** Added a 60-frame idle counter inside the rAF tick. When the bounds key is unchanged for 60 consecutive frames the loop stops rescheduling. A `useLayoutEffect` that already fires `syncBounds()` on every React render bumps a `boundsGeneration` key whenever the bounds actually change, causing the rAF effect to re-run and restart the loop.
- **Commit:** _(same commit as this entry)_

### 4. Bounds-sync rAF runs for hidden/background browser panes

- **Source:** github-codex-connector | PR #515 round 1 | 2026-06-17
- **Severity:** P2 / MEDIUM
- **File:** `src/features/browser/components/BrowserPane.tsx`
- **Finding:** `TerminalZone` keeps inactive session panels mounted and only hides them with CSS, so the unconditional rAF loop started for every background `BrowserPane`. Hidden panes kept calling `syncBounds()`/`getBoundingClientRect()` once per frame even after they had already sent invisible/0×0 bounds.
- **Fix:** Gated the rAF effect on `nativePaneReady && isActive && !isOccluded` so the loop only runs while the pane is visible. The existing focus/occlusion effects still send a final invisible bounds update when the pane becomes inactive or occluded.
- **Commit:** _(same commit as this entry)_

### 5. rAF idle cutoff leaves stale native bounds after position-only ancestor moves

- **Source:** github-claude | PR #515 round 2 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/features/browser/components/BrowserPane.tsx`
- **Finding:** After 60 unchanged frames the rAF bounds-sync loop stopped and only restarted from React-visible dependencies. A later CSS transform or other position-only ancestor move that did not cause a React render left the native `WebContentsView` at stale coordinates until an unrelated render occurred.
- **Fix:** Added a 250 ms post-idle polling interval and an ancestor `MutationObserver` watching `style`/`class` attributes up to 10 ancestors deep. Either detector restarts a short rAF burst that calls `syncBounds()`, catching CSS-only moves without restoring a perpetual 60 fps loop.
- **Commit:** _(same commit as this entry)_

### 6. `nativePaneReady` state is not reset in creation-effect cleanup

- **Source:** github-claude | PR #515 round 2 | 2026-06-17
- **Severity:** LOW
- **File:** `src/features/browser/components/BrowserPane.tsx`
- **Finding:** The creation effect cleanup set `nativePaneReadyRef.current = false` but did not call `setNativePaneReady(false)`. If `browserSessionId` or `pane.id` changed and the effect re-ran, the rAF guard stayed `true` and the loop spun for up to 60 idle frames before `syncBounds()`'s ref guard short-circuited each tick.
- **Fix:** Added `setNativePaneReady(false)` to the cleanup so the reactive state mirror matches the ref and reliably restarts the rAF effect on re-mount.
- **Commit:** _(same commit as this entry)_
