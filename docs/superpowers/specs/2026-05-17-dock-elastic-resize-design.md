# Dock Elastic Resize — Design Spec

## 1. Context and Problem Statement

### Current state

`DockPanel` supports four positions (top, bottom, left, right). Vertical docks
(top/bottom) have a drag handle wired through `verticalDockResize` lifted to
`WorkspaceView`, but:

- The min/max bounds (150 px–640 px) are hardcoded in two places:
  `DockPanel.tsx` constants and the `useResizable` call in `WorkspaceView.tsx`.
- The 640 px max is too restrictive — it prevents the panel from growing
  beyond ~40 % of a standard 1440 px screen.
- Horizontal docks (left/right) have **no resize handle at all**. Their width
  is a fixed `flex: 0 0 40%` string with no drag or keyboard adjustment.

### Issue \#217

PR \#215 introduced height-persistence (resized size survives close/reopen)
but no automated test covers it. Issue \#217 is explicitly deferred to this
follow-up PR.

### Goals

1. **Horizontal resize** — left and right dock positions gain a drag handle on
   the inner edge (right edge of left-dock, left edge of right-dock), matching
   the sidebar-handle visual style. Width is fully adjustable, keyboard-
   navigable, and ARIA-annotated.
2. **Configurable, percent-based bounds** — min/max expressed as a fraction of
   the container's live dimension (default: 5 %–80 %). All constants live in a
   single config file (`panelConfig.ts`); a reviewer changes one value to tune the range.
3. **Shared resize logic via `useElasticContainer`** — a new hook that
   encapsulates percent→pixel conversion and `ResizeObserver` tracking. Dock
   (vertical + horizontal) and, in a future PR, TerminalZone all use the same
   hook. The name intentionally avoids panel-specific terminology.
4. **Tests** — unit tests for `useElasticContainer`; new DockPanel handle tests
   for left/right; WorkspaceView integration test covering issue \#217.

### Size-clamping invariant

Whenever the container's observed dimension changes (via `ResizeObserver`),
`useElasticContainer` re-clamps the stored pixel size against the updated pixel
bounds derived from the new dimension. Size is always stored as pixels; bounds
recomputation is the hook's responsibility, not the caller's.

**Invariant scope:** the 5 %–80 % contract is guaranteed when
`Math.ceil(dimension × minPercent) < Math.floor(dimension × maxPercent)`
(a condition, not a fixed px threshold — exact dimension depends on fractional
CSS pixels and config values). Degenerate containers and active-drag +
concurrent container-resize scenarios are best-effort: the post-drag re-clamp
closes the latter case after `mouseup`.

---

## 4. DockPanel Changes

### New props

```ts
interface DockPanelBaseProps {
  // existing vertical props (unchanged) ...
  verticalSize: number
  onVerticalResizeMouseDown: (event: MouseEvent) => void
  isVerticalResizing: boolean
  onVerticalSizeAdjust: (delta: number) => void
  verticalPixelMin: number // NEW — from useElasticContainer.pixelMin
  verticalPixelMax: number // NEW — from useElasticContainer.pixelMax

  // NEW horizontal props (ignored when position === 'top' | 'bottom')
  horizontalSize: number
  onHorizontalResizeMouseDown: (event: MouseEvent) => void
  isHorizontalResizing: boolean
  onHorizontalSizeAdjust: (delta: number) => void
  horizontalPixelMin: number
  horizontalPixelMax: number
}
```

### Container style

```ts
// vertical dock: controlled height
containerStyle = { height: `${verticalSize}px` }

// horizontal dock: controlled width (was: flex: 0 0 40%)
containerStyle = { width: `${horizontalSize}px` }
```

`SIDE_DOCK_BASIS = '40%'` and the hardcoded `DRAWER_MIN`/`DRAWER_MAX` constants
are **removed** from `DockPanel.tsx`. All bounds come from `panelConfig.ts`.

### Horizontal resize handle

Rendered when `position === 'left' | 'right'` at the inner edge:

- `right-dock` handle: `left-0` edge (faces terminal zone, mirrors sidebar handle)
- `left-dock` handle: `right-0` edge

```tsx
{
  !isVerticalDock && (
    <div
      data-testid="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={horizontalSize}
      aria-valuemin={horizontalPixelMin}
      aria-valuemax={horizontalPixelMax}
      tabIndex={0}
      onMouseDown={onHorizontalResizeMouseDown}
      onKeyDown={/* horizontal keyboard handler */}
      className={`absolute ${horizontalHandleEdgeClass} top-0 bottom-0 w-1 cursor-col-resize ...`}
    />
  )
}
```

Keyboard handler mirrors the vertical one (ArrowLeft/ArrowRight for left/right
docks; direction mapping matches the drag `invert` logic).

### ARIA updates

Vertical handle `aria-valuemin`/`aria-valuemax` now come from `verticalPixelMin`
/ `verticalPixelMax` (props) instead of the removed `DRAWER_MIN`/`DRAWER_MAX`
constants. Home/End keyboard handlers use these prop values.

---

## 5. WorkspaceView Wiring

### Definitive `useElasticContainer` declarations (consolidated)

```ts
// Ref to the dock-canvas-wrapper div (parent container, not the dock itself)
const dockCanvasRef = useRef<HTMLDivElement>(null)

// Bottom dock: drag UP grows panel → invert=true
// Top dock: drag DOWN grows panel → invert=false
// Right dock: drag LEFT grows panel → invert=true
// Left dock: drag RIGHT grows panel → invert=false
const verticalDockElastic = useElasticContainer({
  containerRef: dockCanvasRef,
  axis: 'vertical',
  ...DOCK_ELASTIC_CONFIG,
  invert: dockPosition === 'bottom',
})

const horizontalDockElastic = useElasticContainer({
  containerRef: dockCanvasRef,
  axis: 'horizontal',
  ...DOCK_ELASTIC_CONFIG,
  invert: dockPosition === 'right',
})
```

`dockCanvasRef` is attached to `<div data-testid="dock-canvas-wrapper">`.
The old `verticalDockResize = useResizable(...)` call is **removed**.

### Terminal fit deferral

The existing terminal fit deferral (`deferTerminalFit`) must include both drag
states — add `horizontalDockElastic.isDragging` alongside the existing
`verticalDockElastic.isDragging` and sidebar `isDragging`. Horizontal dock
dragging changes the available terminal width just as sidebar dragging does.

### DockPanel call site

```tsx
<DockPanel
  // ... existing props ...
  verticalSize={verticalDockElastic.size}
  onVerticalResizeMouseDown={verticalDockElastic.handleMouseDown}
  isVerticalResizing={verticalDockElastic.isDragging}
  onVerticalSizeAdjust={verticalDockElastic.adjustBy}
  verticalPixelMin={verticalDockElastic.pixelMin}
  verticalPixelMax={verticalDockElastic.pixelMax}
  horizontalSize={horizontalDockElastic.size}
  onHorizontalResizeMouseDown={horizontalDockElastic.handleMouseDown}
  isHorizontalResizing={horizontalDockElastic.isDragging}
  onHorizontalSizeAdjust={horizontalDockElastic.adjustBy}
  horizontalPixelMin={horizontalDockElastic.pixelMin}
  horizontalPixelMax={horizontalDockElastic.pixelMax}
/>
```

### jsdom test strategy

Two categories of WorkspaceView tests, handled differently:

**All existing WorkspaceView test files** (`.test.tsx`, `.integration.test.tsx`,
etc.) add a module-level mock to avoid zero-dimension throws:

```ts
vi.mock('../../hooks/useElasticContainer', () => ({
  useElasticContainer: vi.fn(() => ({
    size: 400,
    isDragging: false,
    handleMouseDown: vi.fn(),
    adjustBy: vi.fn(),
    resetToSize: vi.fn(),
    sizeRef: { current: 400 },
    pixelMin: 40,
    pixelMax: 640,
  })),
}))
```

**Issue \#217 persistence test** lives in a **new, separate file**
(`WorkspaceView.elastic.test.tsx`) that does **not** mock `useElasticContainer`.
It uses the real hook with DOM stubs:

```ts
// ResizeObserver stub
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    disconnect = vi.fn()
    unobserve = vi.fn()
  }
)
// Realistic container dimensions (avoids the zero-dim throw)
vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
  width: 1200,
  height: 800,
  top: 0,
  left: 0,
  right: 1200,
  bottom: 800,
  x: 0,
  y: 0,
  toJSON: () => undefined,
} as DOMRect)
```

This cleanly separates mocked tests from the real-hook persistence proof.

---

## 6. Test Plan

### 6.1 `useResizable.test.ts` additions

- `resetToSize` clamps to `[min, max]`
- `resetToSize` with explicit bounds clamps to the provided bounds
- `resetToSize` during active drag re-anchors `startSize` so next `mousemove`
  continues from the reset position
- `sizeRef.current` updates synchronously after `resetToSize`

### 6.2 `useElasticContainer.test.ts` (new file)

- Initialization sets size from `initialPercent`
- Initialization throws when `containerRef.current` is null
- Initialization throws when percent bounds are invalid (`minPercent >= maxPercent`)
- `ResizeObserver` re-clamp updates `pixelMin`/`pixelMax` and clamps size
- `ResizeObserver` defers `resetToSize` during active drag and fires post-drag
- Tiny-container guard: production forces `pixelMax = pixelMin`, dev throws
- StrictMode idempotency: double-running the initialization effect produces the
  same final state

### 6.3 `DockPanel.test.tsx` additions

- Renders horizontal resize handle for `position='left'` and `position='right'`
- Does not render resize handle for `position='top'` and `position='bottom'` — wait, vertical IS rendered. Clarification: renders resize handle for ALL four positions (vertical for top/bottom, horizontal for left/right)
- Horizontal handle mousedown calls `onHorizontalResizeMouseDown`
- Horizontal handle keyboard ArrowLeft/ArrowRight calls `onHorizontalSizeAdjust`
- Side dock uses `width: ${horizontalSize}px` (not the old `flex: 0 0 40%`)
- `aria-valuemin`/`aria-valuemax` on vertical handle come from `verticalPixelMin`/`verticalPixelMax` props

### 6.4 `WorkspaceView.integration.test.tsx` additions (issue \#217)

The test uses the **real** `useElasticContainer` hook (not mocked) to prove that
resize state actually lives in `WorkspaceView` — a mock that always returns a
fixed size cannot distinguish correct from incorrect architecture.

jsdom stubs required (in `beforeEach`):

```ts
// ResizeObserver stub
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    disconnect = vi.fn()
    unobserve = vi.fn()
  }
)

// Return realistic dimensions so useElasticContainer does not throw
vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
  width: 1200,
  height: 800,
  top: 0,
  left: 0,
  right: 1200,
  bottom: 800,
  x: 0,
  y: 0,
  toJSON: () => undefined,
} as DOMRect)
```

Test sequence (proves issue \#217 invariant):

1. Render `WorkspaceView`
2. Fire `mousedown` + `mousemove` + `mouseup` on `getByTestId('resize-handle')`
   to produce a non-default size (e.g. delta = +100 px)
3. Assert `dock-panel` style reflects the new height
4. Click collapse — assert `DockPanel` unmounts
5. Click `DockPeekButton` — assert `DockPanel` remounts
6. Assert `dock-panel` still has the height from step 3 (not the initial value)

This fails if someone accidentally co-locates resize state inside `DockPanel`
(remount would reset to `initialPercent`, not the user-set value).

Additional integration tests (real hook, same stubs):

- Position switch `bottom → right`: horizontal size retains its initial value;
  vertical size is independent and retains its value
- Position switch `right → left`: horizontal size persists across position flip

---

## 3. Configuration — `src/features/workspace/panelConfig.ts`

All numeric constants that were previously hardcoded in `DockPanel.tsx` and
`WorkspaceView.tsx` move here. This is the **single tuning surface** for all
panel size constraints in the workspace.

```ts
/**
 * Dock panel elastic config — used by WorkspaceView's two useElasticContainer
 * instances (one for vertical dock size, one for horizontal dock size).
 */
export const DOCK_ELASTIC_CONFIG = {
  minPercent: 0.05,
  maxPercent: 0.8,
  initialPercent: 0.3,
} as const

/**
 * Terminal zone outer elastic config — for future useElasticContainer wiring
 * of the whole terminal zone. Reserved now so the config is the single tuning
 * surface when that PR lands.
 */
export const TERMINAL_ZONE_ELASTIC_CONFIG = {
  minPercent: 0.1,
  maxPercent: 0.9,
  initialPercent: 0.5,
} as const

/**
 * Per-pane elastic config descriptor for TerminalZone's 1–4 pane splits.
 * The terminal zone can render 1, 2, 3, or 4 panes simultaneously; each pane
 * gets its own useElasticContainer instance.
 *
 * This interface intentionally omits `containerRef` and `axis` — those are
 * call-site concerns (the caller supplies the ref to the pane's parent element
 * and knows its axis). It is NOT directly spreadable into UseElasticContainerOptions.
 *
 * Out of scope for this PR — data structure is defined here to avoid a future
 * breaking change to panelConfig.ts when pane resize is implemented.
 */
export interface PaneElasticConfig {
  minPercent: number
  maxPercent: number
  /**
   * undefined = compute as 1/paneCount at runtime (equal share default).
   * Set to a fixed fraction to pin the pane's initial size.
   */
  initialPercent: number | undefined
}

/**
 * Elastic config for each pane slot (index 0–3 for pane 1–4).
 * When fewer than 4 panes are shown, only the first `paneCount` entries
 * are used.
 */
export const TERMINAL_PANE_ELASTIC_CONFIGS: PaneElasticConfig[] = [
  { minPercent: 0.1, maxPercent: 0.9, initialPercent: undefined },
  { minPercent: 0.1, maxPercent: 0.9, initialPercent: undefined },
  { minPercent: 0.1, maxPercent: 0.9, initialPercent: undefined },
  { minPercent: 0.1, maxPercent: 0.9, initialPercent: undefined },
]

/** Keyboard resize step sizes (pixels), shared by all panels. */
export const KEYBOARD_STEP_PX = 20
export const KEYBOARD_STEP_SHIFT_PX = 100
```

`DockPanel.tsx` imports **only `KEYBOARD_STEP_PX` and `KEYBOARD_STEP_SHIFT_PX`**
from `panelConfig.ts` — pixel bounds for ARIA come from the
`verticalPixelMin`/`verticalPixelMax`/`horizontalPixelMin`/`horizontalPixelMax`
props (live values from `useElasticContainer`). `WorkspaceView.tsx` spreads
`DOCK_ELASTIC_CONFIG` into each `useElasticContainer` call. The terminal zone
and pane configs (`TERMINAL_ZONE_ELASTIC_CONFIG`, `TERMINAL_PANE_ELASTIC_CONFIGS`,
`PaneElasticConfig`) are forward-looking data definitions only — they are not
wired to any hook in this PR and do not affect `UseElasticContainerOptions`'s
required `containerRef`/`axis` fields. They establish the shape for future PRs
without requiring spreading the full config object directly.

---

## 2. `useElasticContainer` Hook

### Location

`src/hooks/useElasticContainer.ts` (sibling of `src/hooks/useResizable.ts`)

### Purpose

A thin wrapper over `useResizable` that adds percent-bound tracking, a
`ResizeObserver`, and correct percent-to-pixel conversion. The hook creates one
instance per axis; `WorkspaceView` creates two (vertical and horizontal).

- A `containerRef` the caller attaches to the **parent available-area element**
  (not the dock panel itself — attaching to the panel creates self-referential
  bounds).
- A `ResizeObserver` that watches `containerRef` and recomputes pixel bounds
  whenever the observed dimension changes, then re-clamps the current size.
- Percent→pixel conversion: `pixelMin = Math.ceil(dimension × minPercent)`,
  `pixelMax = Math.floor(dimension × maxPercent)`.

`useResizable`'s existing logic is unchanged. The hook gains two new public API
members (`resetToSize` and `sizeRef`) to support `useElasticContainer`.

### Required `useResizable` API extension

`useElasticContainer` needs to set an absolute size after measuring the
container. `adjustBy(delta)` is not suitable because it clamps against stale
closure bounds. The `useResizable` implementation gains two new public API members; all
existing logic is unchanged.

**Add two members to `UseResizableResult`:**

```ts
// New members on UseResizableResult
resetToSize: (px: number, explicitMin?: number, explicitMax?: number) => void
/** Synchronous read of the last committed size; safe to read in callbacks. */
sizeRef: MutableRefObject<number>  // MutableRefObject (not readonly RefObject)
```

Implementation:

1. `cancelPendingSize()` — stops any in-flight RAF.
2. Compute `nextSize = clampSize(px, explicitMin ?? min, explicitMax ?? max)`.
3. `commitSize(nextSize)`.
4. Always update `previewSize.current = nextSize` (unconditionally, not only
   during drag) so `adjustBy` in `commit-on-end` mode reads a fresh baseline.
5. If `isDraggingRef.current`, also re-anchor drag baselines:
   `startPos.current = currentPos.current`, `startSize.current = nextSize`.

When explicit bounds are provided they bypass stale closure values.

**Test-mock update required:** any test that mocks `useResizable`'s return value
must add both new members:

```ts
resetToSize: vi.fn(),
sizeRef: { current: 0 },
```

The existing `useResizable` unit tests do not mock themselves; only tests that
mock the hook at a higher level are affected.

### `containerRef` ownership

`containerRef` **must be attached to the parent available-area element** — the
element whose shrinking or growing changes how much space the dock can occupy
(e.g. the `dock-canvas-wrapper` div in `WorkspaceView`). It must **not** be
attached to the dock panel itself. Attaching it to the panel would create a
self-referential loop where the bounds are derived from the panel's own current
size.

### API

```ts
export interface UseElasticContainerOptions {
  /**
   * Ref attached to the *parent* container that defines the available space
   * (not the resizable element itself — see ownership note above).
   *
   * **Pre-condition (hard):** `containerRef.current` MUST be non-null when the
   * first `useLayoutEffect` fires. Violation throws in both development and
   * production — there is no silent fallback or recovery path.
   *
   * **Mount-time constant:** `containerRef` (the ref object itself) must not
   * change after mount. The `ResizeObserver` is attached once to the element
   * present at first layout effect and never reconnected. If the observed
   * element is replaced, behavior is undefined.
   */
  containerRef: RefObject<Element | null>
  /**
   * Which dimension to observe and use for percent → pixel conversion.
   * Maps directly to `useResizable.direction` (horizontal → clientX,
   * vertical → clientY for drag tracking).
   *
   * **Mount-time constant.** Changing after mount results in undefined behavior.
   * Callers must create separate hook instances per axis (one for vertical dock
   * size, one for horizontal) so that each size survives position switches.
   */
  axis: 'horizontal' | 'vertical'
  /**
   * Fraction of available dimension for minimum size, e.g. 0.05.
   * Pre-condition: 0 < minPercent < maxPercent ≤ 1. Throws if violated.
   * **Mount-time constant** — changes after mount are ignored.
   */
  minPercent: number
  /**
   * Fraction of available dimension for maximum size, e.g. 0.80.
   * **Mount-time constant** — changes after mount are ignored.
   */
  maxPercent: number
  /**
   * Initial size as a fraction of the available dimension at mount.
   * Defaults to (minPercent + maxPercent) / 2 when omitted.
   * Clamped to [minPercent, maxPercent].
   * **Mount-time constant** — used only during initialization.
   */
  initialPercent?: number
  /** Forwarded verbatim to useResizable. */
  updateMode?: 'live' | 'commit-on-end'
  /** Forwarded verbatim to useResizable. */
  invert?: boolean
  /** Forwarded verbatim to useResizable. */
  onDragPreview?: (size: number) => void
}

export interface UseElasticContainerResult extends UseResizableResult {
  /** Current lower pixel bound; use for aria-valuemin and keyboard Home. */
  pixelMin: number
  /** Current upper pixel bound; use for aria-valuemax and keyboard End. */
  pixelMax: number
  // Note: UseResizableResult now also includes:
  //   resetToSize(px, explicitMin?, explicitMax?): void
  //   sizeRef: MutableRefObject<number>
}
```

### Behaviour contract

#### First-render bootstrap

`useElasticContainer` calls `useResizable` with placeholder values
`{ initial: 0, min: 0, max: Number.MAX_SAFE_INTEGER }` on the first render.
These are never painted: the initialization `useLayoutEffect` fires before the
browser paints and replaces them with correct values.

#### Bound computation — integer-safe

To prevent the `Math.round` in `clampSize` from producing a value below the
minimum:

```
pixelMin = Math.ceil(dimension * minPercent)
pixelMax = Math.floor(dimension * maxPercent)
```

Any clamped-then-rounded size is guaranteed ≥ `pixelMin` and ≤ `pixelMax`.

#### Initialization (`useLayoutEffect`, deps `[]` — idempotent, mount only)

`axis` is a mount-time constant so the initialization effect has empty deps.
React StrictMode runs setup/cleanup/setup in development — the effect must be
idempotent. Percent options are captured via `useRef(initialValue)` on first
render; refs are never reassigned.

Asserts `containerRef.current !== null` (throws in both dev and prod — no
fallback). Validates `0 < minPercent < maxPercent ≤ 1` (throws). Reads
`getBoundingClientRect()`. Computes, **in this order:**

1. `newMin = Math.ceil(dim × minPercent)`
2. `newMax = Math.floor(dim × maxPercent)`
3. Apply tiny-container guard: in development, throw invariant error if
   `newMin >= newMax`; in production, force `newMax = newMin` silently.
4. `effective = initialPercent ?? (minPercent + maxPercent) / 2`
5. `newInitial = clampSize(dim × effective, newMin, newMax)`

Calls `setPixelMin(newMin)`, `setPixelMax(newMax)`, and synchronously
writes `pixelMinRef.current = newMin`, `pixelMaxRef.current = newMax` (internal
refs used by the post-drag re-clamp to read latest bounds without a re-render).
Then calls **`resetToSize(newInitial, newMin, newMax)`** with explicit bounds.

#### `ResizeObserver` re-clamp

`useElasticContainer` maintains:

- `isDraggingRef: MutableRefObject<boolean>` — kept in sync with
  `useResizable.isDragging` via `useLayoutEffect` (fires before paint, so the
  ref is current when any ResizeObserver callback fires in the same frame).
- `pixelMinRef / pixelMaxRef: MutableRefObject<number>` — updated synchronously
  with `setPixelMin`/`setPixelMax` to allow callbacks to read latest bounds.
- `pendingReclampRef: MutableRefObject<boolean>` — set when a re-clamp is
  deferred to post-drag.

On each observation, the callback:

1. Computes `newMin`/`newMax` (integer-safe, tiny-container guard applied).
2. Synchronously writes `pixelMinRef.current = newMin`, `pixelMaxRef.current = newMax`.
3. Calls `setPixelMin(newMin)`, `setPixelMax(newMax)`.

**During active drag:** defers `resetToSize` (avoids disrupting the in-progress
drag). Sets `pendingReclampRef.current = true`. The `setPixelMin`/`setPixelMax`
state update causes a re-render → `useResizable` is called with fresh `min`/`max`
→ its drag effect re-registers with new bounds on the next render. Subsequent
`mousemove` events are clamped by the fresh bounds after that render. There is
a one-frame window where in-progress RAF sizes may be clamped against previous
bounds — this is the documented acceptable race.

**After `mouseup`** (detected via `useEffect` watching `isDragging`, firing on
`true → false` transition): calls
`resetToSize(sizeRef.current, pixelMinRef.current, pixelMaxRef.current)` if
`pendingReclampRef.current` is true, then clears the flag. This closes the
case where no `mousemove` fired after the bounds update.

**When not dragging:** calls `resetToSize(sizeRef.current, newMin, newMax)`
immediately (no deferral needed).

#### Tiny-container guard

If `pixelMin >= pixelMax` after integer rounding (exact threshold depends on
fractional CSS pixels returned by `getBoundingClientRect()` and the configured
percent values; not a fixed pixel dimension), the hook silently forces
`pixelMax = pixelMin` in production and throws an invariant error in
development. Use `import.meta.env.DEV` (Vite's dev-mode flag, available in
this renderer) to guard the throw — do not use `process.env.NODE_ENV`.
(No `console.warn` — the project lint rule blocks all `console.*` calls.)
The result is equal bounds (`min === max`), which is valid input for
`useResizable` — `clampSize(value, n, n)` always returns `n` correctly.
The 5 %–80 % invariant is relaxed for this edge case ("size stays at
`pixelMin`"). This is a degenerate case for effectively zero-dimension
containers, not a normal operating condition.

#### Other behaviours

- **Drag** — delegates to `useResizable`. `min`/`max` passed per render reflect
  current `pixelMin`/`pixelMax` state. The existing `useResizable` drag effect
  already lists `[min, max]` in its deps (verified in `src/hooks/useResizable.ts`
  line 235); when `pixelMin`/`pixelMax` state changes, React re-registers the
  drag handler with fresh bounds on the next render.
- **Keyboard** — delegates to `useResizable.adjustBy`.
- **Cleanup** — `ResizeObserver` disconnected on unmount.

### Relationship

```
useElasticContainer              useResizable
┌──────────────────────┐         ┌─────────────────────────────┐
│ containerRef         │         │ min, max  (pixels, from     │
│ axis                 │ calls ─▶│   pixelMin/pixelMax state)  │
│ minPercent           │         │ direction                   │
│ maxPercent           │         │ invert                      │
│ ResizeObserver       │         │ updateMode                  │
│ re-clamp on resize   │         │ onDragPreview               │
└──────────────────────┘         └─────────────────────────────┘
          │                                 │
          │   returns UseElasticContainerResult:
          │     { ...UseResizableResult,    │
          │       pixelMin, pixelMax }      │
          └──────────────────────────────── ┘
```

---

### Non-goals (this PR)

- TerminalZone resize — `useElasticContainer` is wired there in a follow-up.
- Persistence across page refreshes — size is in-memory (`WorkspaceView` React
  state) only; the in-memory approach satisfies issue \#217 (size survives
  the `isDockOpen` flip because state lives in `WorkspaceView`, not in the
  unmounted `DockPanel`).
- Touch / pointer-events resize — mouse and keyboard only, matching the current
  sidebar.
