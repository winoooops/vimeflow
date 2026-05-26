# Split-pane Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag the border between panes to resize width/height in every non-`single` layout, reusing the dock's elastic-resize machinery.

**Architecture:** Two phases. Phase 1 extracts the dock's inline resize-handle markup into a shared `ResizeHandle` primitive (pure refactor). Phase 2 adds split-pane dividers: a backward-compatible `reservedPx` option on `useElasticContainer`, a `resolveGrid` template helper, per-layout `SplitDividers` subcomponents (fixed hook counts), and `SplitView` ownership of remembered ratios with active-only divider mounting.

**Tech Stack:** React + TypeScript, CSS Grid, Vitest + Testing Library, Tailwind (Catppuccin tokens).

**Spec:** `docs/superpowers/specs/2026-05-25-split-pane-resize-design.md` (committed + codex-reviewed).

**Worktree:** All work happens in `/home/will/projects/vimeflow/.claude/worktrees/split-pane-resize` on branch `feat/split-pane-resize`. Run every git command as `git -C /home/will/projects/vimeflow/.claude/worktrees/split-pane-resize …`. The primary checkout is on an unrelated branch — never touch it.

**Conventions:** No semicolons, single quotes, trailing commas (es5). Arrow-function components only. Explicit return types on exported functions. `import { test, expect, … } from 'vitest'` explicitly in every test. Co-located sibling tests. Run a single test file with `npx vitest run <path>`.

---

## File Structure

**Phase 1**

- Create `src/components/ResizeHandle.tsx` — presentational resize-handle affordance (role/aria/cursor/colors/handlers). Owns affordance only; consumer owns placement.
- Create `src/components/ResizeHandle.test.tsx`.
- Modify `src/features/workspace/components/DockPanel.tsx` — replace the two inline handle `<div>`s with `<ResizeHandle>`. `DockPanel.test.tsx` is the unchanged regression net.

**Phase 2**

- Modify `src/hooks/useElasticContainer.ts` — add optional `reservedPx` (default `0`) so percentages run over `dimension − reservedPx`; expose `effectiveDimension`.
- Modify `src/hooks/useElasticContainer.test.ts` — add `reservedPx` cases; existing cases stay green.
- Create `src/features/terminal/components/SplitView/resolveGrid.ts` — `SPLIT_DIVIDER_PX`, `DEFAULT_RATIOS`, `resolveGrid(layoutId, ratios)`.
- Create `src/features/terminal/components/SplitView/resolveGrid.test.ts`.
- Modify `src/features/workspace/panelConfig.ts` — add `SPLIT_ELASTIC_CONFIG`.
- Create `src/features/terminal/components/SplitView/useSplitDivider.ts` — wraps `useElasticContainer` for one divider; owns the CSS-var bridge + keyboard handler.
- Create `src/features/terminal/components/SplitView/SplitDividers.tsx` — layout switch + the four per-layout subcomponents (`VSplitDividers`, `HSplitDividers`, `ThreeRightDividers`, `QuadDividers`), each with a fixed hook count.
- Create `src/features/terminal/components/SplitView/SplitDividers.test.tsx`.
- Modify `src/features/terminal/components/SplitView/SplitView.tsx` — padding moves to an outer `split-view-canvas` wrapper; the inner measured grid holds panes + dividers; ratio state + `resolveGrid` template + active-only `<SplitDividers>`.
- Modify `src/features/terminal/components/SplitView/SplitView.test.tsx` — update grid-template/padding assertions; add divider integration tests.

---

## Phase 1 — Extract the `ResizeHandle` primitive

### Task 1: `ResizeHandle` component

**Files:**

- Create: `src/components/ResizeHandle.tsx`
- Test: `src/components/ResizeHandle.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { test, expect, vi, describe } from 'vitest'
import { ResizeHandle, type ResizeHandleProps } from './ResizeHandle'

const baseProps: ResizeHandleProps = {
  orientation: 'horizontal',
  isDragging: false,
  ariaValueNow: 100,
  ariaValueMin: 40,
  ariaValueMax: 640,
  onMouseDown: vi.fn(),
  onKeyDown: vi.fn(),
}

describe('ResizeHandle', () => {
  test('renders a separator with the given orientation', () => {
    render(<ResizeHandle {...baseProps} orientation="vertical" />)
    const handle = screen.getByTestId('resize-handle')
    expect(handle).toHaveAttribute('role', 'separator')
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
  })

  test('horizontal orientation uses ns-resize, vertical uses col-resize', () => {
    const { rerender } = render(
      <ResizeHandle {...baseProps} orientation="horizontal" />
    )
    expect(screen.getByTestId('resize-handle').className).toMatch(
      /cursor-ns-resize/
    )
    rerender(<ResizeHandle {...baseProps} orientation="vertical" />)
    expect(screen.getByTestId('resize-handle').className).toMatch(
      /cursor-col-resize/
    )
  })

  test('exposes aria value range', () => {
    render(
      <ResizeHandle
        {...baseProps}
        ariaValueNow={120}
        ariaValueMin={50}
        ariaValueMax={900}
      />
    )
    const handle = screen.getByTestId('resize-handle')
    expect(handle).toHaveAttribute('aria-valuenow', '120')
    expect(handle).toHaveAttribute('aria-valuemin', '50')
    expect(handle).toHaveAttribute('aria-valuemax', '900')
  })

  test('applies the active background only while dragging', () => {
    const { rerender } = render(
      <ResizeHandle {...baseProps} isDragging={false} />
    )
    expect(screen.getByTestId('resize-handle').className).not.toMatch(
      /bg-primary\/30/
    )
    rerender(<ResizeHandle {...baseProps} isDragging />)
    expect(screen.getByTestId('resize-handle').className).toMatch(
      /bg-primary\/30/
    )
  })

  test('forwards mouse + keyboard events', () => {
    const onMouseDown = vi.fn()
    const onKeyDown = vi.fn()
    render(
      <ResizeHandle
        {...baseProps}
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
      />
    )
    const handle = screen.getByTestId('resize-handle')
    fireEvent.mouseDown(handle)
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(onMouseDown).toHaveBeenCalled()
    expect(onKeyDown).toHaveBeenCalled()
  })

  test('passes through consumer className, style and testId', () => {
    render(
      <ResizeHandle
        {...baseProps}
        testId="split-resize-handle"
        className="absolute z-10 h-1 left-0 right-0"
        style={{ gridArea: 'vdiv' }}
      />
    )
    const handle = screen.getByTestId('split-resize-handle')
    expect(handle.className).toMatch(/\bz-10\b/)
    expect(handle.className).toMatch(/left-0/)
    expect(handle.style.gridArea).toBe('vdiv')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ResizeHandle.test.tsx`
Expected: FAIL — `Cannot find module './ResizeHandle'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
} from 'react'

export interface ResizeHandleProps {
  /** aria-orientation. 'horizontal' separator → ns-resize; 'vertical' → col-resize. */
  orientation: 'horizontal' | 'vertical'
  isDragging: boolean
  ariaValueNow: number
  ariaValueMin: number
  ariaValueMax: number
  ariaLabel?: string
  testId?: string
  onMouseDown: (event: MouseEvent) => void
  onKeyDown: (event: KeyboardEvent) => void
  /** Consumer-owned placement: position offsets, stretch + thickness, z-index. */
  className?: string
  style?: CSSProperties
}

export const ResizeHandle = ({
  orientation,
  isDragging,
  ariaValueNow,
  ariaValueMin,
  ariaValueMax,
  ariaLabel = 'Resize panel',
  testId = 'resize-handle',
  onMouseDown,
  onKeyDown,
  className = '',
  style = undefined,
}: ResizeHandleProps): ReactElement => {
  const cursor =
    orientation === 'horizontal' ? 'cursor-ns-resize' : 'cursor-col-resize'

  return (
    <div
      data-testid={testId}
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      aria-valuenow={ariaValueNow}
      aria-valuemin={ariaValueMin}
      aria-valuemax={ariaValueMax}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      style={style}
      className={`${cursor} transition-colors hover:bg-primary/20 focus:bg-primary/40 focus:outline-none ${
        isDragging ? 'bg-primary/30' : ''
      } ${className}`}
    />
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ResizeHandle.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint + commit**

```bash
WT=/home/will/projects/vimeflow/.claude/worktrees/split-pane-resize
npx vitest run src/components/ResizeHandle.test.tsx
git -C "$WT" add src/components/ResizeHandle.tsx src/components/ResizeHandle.test.tsx
git -C "$WT" commit -m "refactor: extract shared ResizeHandle primitive"
```

### Task 2: Migrate `DockPanel` to `ResizeHandle`

**Files:**

- Modify: `src/features/workspace/components/DockPanel.tsx` (the two handle `<div>`s, ~269–305; add import)
- Regression net: `src/features/workspace/components/DockPanel.test.tsx` (unchanged)

- [ ] **Step 1: Add the import**

At the top of `DockPanel.tsx`, alongside the other component imports:

```tsx
import { ResizeHandle } from '../../../components/ResizeHandle'
```

- [ ] **Step 2: Replace the vertical-dock handle**

Replace the `isVerticalDock ? (<div data-testid="resize-handle" … />)` branch's `<div>` with:

```tsx
<ResizeHandle
  orientation="horizontal"
  isDragging={isVerticalResizing}
  ariaValueNow={verticalSize}
  ariaValueMin={verticalPixelMin}
  ariaValueMax={verticalPixelMax}
  onMouseDown={onVerticalResizeMouseDown}
  onKeyDown={handleVerticalKeyDown}
  // z-10 keeps the 4-px handle above the DockTab header (relative sibling)
  className={`absolute ${position === 'top' ? 'bottom-0' : 'top-0'} left-0 right-0 z-10 h-1`}
/>
```

- [ ] **Step 3: Replace the horizontal-dock handle**

Replace the `: (<div data-testid="resize-handle" … />)` branch's `<div>` with:

```tsx
<ResizeHandle
  orientation="vertical"
  isDragging={isHorizontalResizing}
  ariaValueNow={horizontalSize}
  ariaValueMin={horizontalPixelMin}
  ariaValueMax={horizontalPixelMax}
  onMouseDown={onHorizontalResizeMouseDown}
  onKeyDown={handleHorizontalKeyDown}
  className={`absolute ${position === 'right' ? 'left-0' : 'right-0'} top-0 bottom-0 z-10 w-1`}
/>
```

- [ ] **Step 4: Run the regression net**

Run: `npx vitest run src/features/workspace/components/DockPanel.test.tsx`
Expected: PASS (all existing tests — `resize-handle` testid, `aria-orientation`, `aria-valuemin/max`, `z-10`, `left-0`/`right-0`, mousedown forwarding, keyboard arrows all preserved).

- [ ] **Step 5: Lint + commit**

```bash
WT=/home/will/projects/vimeflow/.claude/worktrees/split-pane-resize
npx vitest run src/features/workspace/components/DockPanel.test.tsx
npm run lint -- src/features/workspace/components/DockPanel.tsx src/components/ResizeHandle.tsx
git -C "$WT" add src/features/workspace/components/DockPanel.tsx
git -C "$WT" commit -m "refactor: migrate DockPanel handles to ResizeHandle"
```

---

## Phase 2 — Split-pane dividers

### Task 3: Add `reservedPx` to `useElasticContainer`

`reservedPx` (default `0`) subtracts a fixed amount (the divider track) from the measured dimension before computing percentages, and the hook exposes the resulting `effectiveDimension` so callers can convert `size ↔ ratio`. Default `0` leaves the dock unchanged.

**Files:**

- Modify: `src/hooks/useElasticContainer.ts`
- Test: `src/hooks/useElasticContainer.test.ts`

- [ ] **Step 1: Write failing tests** (append inside the existing `describe`)

```ts
test('reservedPx subtracts from the dimension before applying percentages', () => {
  // dim 1200, reserved 8 → effective 1192; initial 0.5 → round(596)
  const { result } = renderElastic({
    axis: 'horizontal',
    minPercent: 0.15,
    maxPercent: 0.85,
    initialPercent: 0.5,
    reservedPx: 8,
  })
  expect(result.current.size).toBe(596)
  expect(result.current.pixelMin).toBe(Math.ceil(1192 * 0.15)) // 179
  expect(result.current.pixelMax).toBe(Math.floor(1192 * 0.85)) // 1013
  expect(result.current.effectiveDimension).toBe(1192)
})

test('reservedPx defaults to 0 (dock behavior unchanged)', () => {
  const { result } = renderElastic({ axis: 'horizontal', initialPercent: 0.3 })
  expect(result.current.size).toBe(360)
  expect(result.current.effectiveDimension).toBe(1200)
})
```

Add `reservedPx?: number` to the `RenderElasticOverrides` interface and pass it through `renderElastic`'s `useElasticContainer({ … })` call.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/hooks/useElasticContainer.test.ts`
Expected: FAIL — `reservedPx` not accepted / `effectiveDimension` undefined.

- [ ] **Step 3: Implement `reservedPx` + `effectiveDimension`**

In `UseElasticContainerOptions` add:

```ts
  /** Fixed pixels removed from the measured dimension before percentages apply
   *  (e.g. a divider track that sits between the two resizable regions).
   *  Default 0 — leaves single-panel consumers (the dock) unchanged.
   *  Mount-time constant by contract, like `axis` / `minPercent` / `maxPercent`:
   *  captured once into a ref; changing it after mount does NOT re-derive bounds. */
  reservedPx?: number
```

Destructure it with a default in the hook signature: `reservedPx = 0,`. Add a ref and an exposed state:

```ts
const reservedPxRef = useRef(reservedPx)
const [effectiveDimension, setEffectiveDimension] = useState(0)
```

Add to `UseElasticContainerResult`:

```ts
effectiveDimension: number
```

In `computeBounds`, compute against the reserved-adjusted dimension:

```ts
const effective = Math.max(1, dimension - reservedPxRef.current)
const newMin = Math.ceil(effective * configuredMin)
let newMax = Math.floor(effective * configuredMax)
```

In the mount `useLayoutEffect`, replace the `dimension`-based initial sizing with the effective value and publish it:

```ts
const effective = Math.max(1, dimension - reservedPxRef.current)
dimensionRef.current = dimension
setEffectiveDimension(effective)
const { newMin, newMax } = computeBounds(dimension)
const effectiveInitial =
  initialPercentRef.current ??
  (minPercentRef.current + maxPercentRef.current) / 2
const nextInitial = clampSize(effective * effectiveInitial, newMin, newMax)
```

In the `ResizeObserver` callback, mirror the same adjustment:

```ts
dimensionRef.current = nextDimension
const effective = Math.max(1, nextDimension - reservedPxRef.current)
setEffectiveDimension(effective)
const { newMin: resizedMin, newMax: resizedMax } = computeBounds(nextDimension)
// …unchanged clamp/restore, but proportional restore uses `effective`:
const proportionalPx = Math.round(effective * desiredPercentRef.current)
```

In the `desiredPercentRef` update effect, divide by the effective dimension:

```ts
const effective = Math.max(1, dimensionRef.current - reservedPxRef.current)
if (dimensionRef.current > 0) {
  desiredPercentRef.current = Math.min(
    Math.max(sizeRef.current / effective, minPercentRef.current),
    maxPercentRef.current
  )
}
```

And in the pending-clamp effect, target the effective dimension:

```ts
const effective = Math.max(1, dimensionRef.current - reservedPxRef.current)
const targetPx =
  dimensionRef.current > 0
    ? Math.round(effective * desiredPercentRef.current)
    : sizeRef.current
```

Finally add `effectiveDimension` to the returned object:

```ts
return { ...resizable, pixelMin, pixelMax, effectiveDimension }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/hooks/useElasticContainer.test.ts`
Expected: PASS — new `reservedPx` tests plus all pre-existing tests (which use the default `reservedPx = 0`).

- [ ] **Step 5: Commit**

```bash
WT=/home/will/projects/vimeflow/.claude/worktrees/split-pane-resize
npx vitest run src/hooks/useElasticContainer.test.ts
git -C "$WT" add src/hooks/useElasticContainer.ts src/hooks/useElasticContainer.test.ts
git -C "$WT" commit -m "feat(resize): add reservedPx + effectiveDimension to useElasticContainer"
```

### Task 4: `resolveGrid` helper + split config

The committed/fallback template uses **fr ratios** (need no measurement — an inactive session renders correct proportions), and the live drag overrides the leading track via a **px CSS variable**. The trailing track is the only remaining `fr`, so it always absorbs "the rest" whether the leading track is `fr` (inactive) or `px` (active). This reproduces the spec's symmetry math.

**Files:**

- Create: `src/features/terminal/components/SplitView/resolveGrid.ts`
- Test: `src/features/terminal/components/SplitView/resolveGrid.test.ts`
- Modify: `src/features/workspace/panelConfig.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { test, expect, describe } from 'vitest'
import { resolveGrid, DEFAULT_RATIOS, SPLIT_DIVIDER_PX } from './resolveGrid'

describe('resolveGrid', () => {
  test('single has no divider tracks', () => {
    const g = resolveGrid('single', DEFAULT_RATIOS.single)
    expect(g.cols).toBe('minmax(0,1fr)')
    expect(g.rows).toBe('minmax(0,1fr)')
    expect(g.areas).toEqual([['p0']])
  })

  test('vsplit emits one column divider track + var fallback', () => {
    const g = resolveGrid('vsplit', { col: 0.5, row: 0.5 })
    expect(g.cols).toBe(`var(--split-col, 0.5fr) ${SPLIT_DIVIDER_PX}px 0.5fr`)
    expect(g.rows).toBe('minmax(0,1fr)')
    expect(g.areas).toEqual([['p0', 'vdiv', 'p1']])
  })

  test('hsplit emits one row divider track', () => {
    const g = resolveGrid('hsplit', { col: 0.5, row: 0.4 })
    expect(g.rows).toBe(`var(--split-row, 0.4fr) ${SPLIT_DIVIDER_PX}px 0.6fr`)
    expect(g.areas).toEqual([['p0'], ['hdiv'], ['p1']])
  })

  test('threeRight spans p0 + vdiv across all rows; hdiv only in right column', () => {
    const g = resolveGrid('threeRight', { col: 0.583, row: 0.5 })
    expect(g.areas).toEqual([
      ['p0', 'vdiv', 'p1'],
      ['p0', 'vdiv', 'hdiv'],
      ['p0', 'vdiv', 'p2'],
    ])
  })

  test('quad segments the column bar around the full-width row bar', () => {
    const g = resolveGrid('quad', { col: 0.5, row: 0.5 })
    expect(g.areas).toEqual([
      ['p0', 'vdiv0', 'p1'],
      ['hdiv', 'hdiv', 'hdiv'],
      ['p2', 'vdiv1', 'p3'],
    ])
  })

  test('default ratios reproduce current proportions', () => {
    expect(DEFAULT_RATIOS.vsplit.col).toBe(0.5)
    expect(DEFAULT_RATIOS.threeRight.col).toBeCloseTo(1.4 / 2.4, 5)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/terminal/components/SplitView/resolveGrid.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `resolveGrid.ts`**

```ts
// cspell:ignore vsplit hsplit
import type { LayoutId } from '../../../sessions/types'

/** Width of the divider track that replaces the inter-pane gap (px). */
export const SPLIT_DIVIDER_PX = 8

export interface LayoutRatios {
  /** Column split fraction (leading column / pane space). */
  col: number
  /** Row split fraction (leading row / pane space). */
  row: number
}

export interface ResolvedGrid {
  cols: string
  rows: string
  areas: readonly (readonly string[])[]
}

/** Per-layout defaults that reproduce the pre-resize `fr` proportions. */
export const DEFAULT_RATIOS: Record<LayoutId, LayoutRatios> = {
  single: { col: 0.5, row: 0.5 },
  vsplit: { col: 0.5, row: 0.5 },
  hsplit: { col: 0.5, row: 0.5 },
  threeRight: { col: 1.4 / 2.4, row: 0.5 },
  quad: { col: 0.5, row: 0.5 },
}

const axisTemplate = (cssVar: string, ratio: number): string =>
  `var(${cssVar}, ${ratio}fr) ${SPLIT_DIVIDER_PX}px ${1 - ratio}fr`

export const resolveGrid = (
  layoutId: LayoutId,
  ratios: LayoutRatios
): ResolvedGrid => {
  const col = axisTemplate('--split-col', ratios.col)
  const row = axisTemplate('--split-row', ratios.row)

  switch (layoutId) {
    case 'single':
      return { cols: 'minmax(0,1fr)', rows: 'minmax(0,1fr)', areas: [['p0']] }
    case 'vsplit':
      return { cols: col, rows: 'minmax(0,1fr)', areas: [['p0', 'vdiv', 'p1']] }
    case 'hsplit':
      return {
        cols: 'minmax(0,1fr)',
        rows: row,
        areas: [['p0'], ['hdiv'], ['p1']],
      }
    case 'threeRight':
      return {
        cols: col,
        rows: row,
        areas: [
          ['p0', 'vdiv', 'p1'],
          ['p0', 'vdiv', 'hdiv'],
          ['p0', 'vdiv', 'p2'],
        ],
      }
    case 'quad':
      return {
        cols: col,
        rows: row,
        areas: [
          ['p0', 'vdiv0', 'p1'],
          ['hdiv', 'hdiv', 'hdiv'],
          ['p2', 'vdiv1', 'p3'],
        ],
      }
  }
}
```

- [ ] **Step 4: Add `SPLIT_ELASTIC_CONFIG` to `panelConfig.ts`**

Append to `src/features/workspace/panelConfig.ts`:

```ts
/**
 * Elastic config for split-pane dividers. Percentages apply to the pane space
 * (container minus the 8px divider track, via useElasticContainer's reservedPx),
 * so both panes stay within 15–85%.
 */
export const SPLIT_ELASTIC_CONFIG = {
  minPercent: 0.15,
  maxPercent: 0.85,
} as const
```

- [ ] **Step 5: Run + commit**

```bash
WT=/home/will/projects/vimeflow/.claude/worktrees/split-pane-resize
npx vitest run src/features/terminal/components/SplitView/resolveGrid.test.ts
git -C "$WT" add src/features/terminal/components/SplitView/resolveGrid.ts \
  src/features/terminal/components/SplitView/resolveGrid.test.ts \
  src/features/workspace/panelConfig.ts
git -C "$WT" commit -m "feat(split-view): add resolveGrid template helper + split config"
```

### Task 5: `useSplitDivider` bridge hook

Wraps one `useElasticContainer` and bridges it to the grid: live drag writes the px CSS var; an effect on the committed `size` keeps the var current on the keyboard/observer paths (where `onDragPreview` is silent) and mirrors the ratio up; unmount clears the var so the fr fallback drives the hidden session.

**Files:**

- Create: `src/features/terminal/components/SplitView/useSplitDivider.ts`
- Test: `src/features/terminal/components/SplitView/useSplitDivider.test.tsx`

- [ ] **Step 1: Write the failing bridge test**

Task 6 only asserts divider _counts_; this test pins the bridge behavior the
components rely on — the ratio mirrored up, the px CSS var written on the
**keyboard** path (where `onDragPreview` never fires), and the var removed on
unmount. The container lives in a parent that stays mounted while the divider
child unmounts — mirroring active-only mounting, so `containerRef.current` is
still valid when the cleanup effect runs.

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import { useRef } from 'react'
import { useSplitDivider } from './useSplitDivider'

class MockResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}
vi.stubGlobal('ResizeObserver', MockResizeObserver)

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1200,
    height: 800,
    top: 0,
    left: 0,
    right: 1200,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: (): undefined => undefined,
  } as DOMRect)
})
afterEach(() => vi.restoreAllMocks())

const DividerChild = ({
  containerRef,
  onRatioChange,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  onRatioChange: (r: number) => void
}): React.ReactElement => {
  const divider = useSplitDivider({
    containerRef,
    axis: 'horizontal',
    cssVar: '--split-col',
    initialRatio: 0.5,
    onRatioChange,
  })
  return <div data-testid="handle" tabIndex={0} onKeyDown={divider.onKeyDown} />
}

const Harness = ({
  active,
  onRatioChange,
}: {
  active: boolean
  onRatioChange: (r: number) => void
}): React.ReactElement => {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} data-testid="container" style={{ width: 1200, height: 800 }}>
      {active ? (
        <DividerChild containerRef={ref} onRatioChange={onRatioChange} />
      ) : null}
    </div>
  )
}

describe('useSplitDivider', () => {
  test('keyboard resize mirrors a clamped ratio up and writes the px var', () => {
    const onRatioChange = vi.fn()
    render(<Harness active onRatioChange={onRatioChange} />)
    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowRight' })
    const ratio = onRatioChange.mock.calls.at(-1)?.[0] as number
    expect(ratio).toBeGreaterThanOrEqual(0.15)
    expect(ratio).toBeLessThanOrEqual(0.85)
    expect(
      screen.getByTestId('container').style.getPropertyValue('--split-col')
    ).toMatch(/px$/)
  })

  test('removes the CSS var on unmount (container stays mounted)', () => {
    const { rerender } = render(<Harness active onRatioChange={vi.fn()} />)
    const container = screen.getByTestId('container')
    expect(container.style.getPropertyValue('--split-col')).toMatch(/px$/)
    rerender(<Harness active={false} onRatioChange={vi.fn()} />)
    expect(container.style.getPropertyValue('--split-col')).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/terminal/components/SplitView/useSplitDivider.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useSplitDivider.ts`**

```ts
import {
  useCallback,
  useEffect,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { useElasticContainer } from '../../../../hooks/useElasticContainer'
import {
  KEYBOARD_STEP_PX,
  KEYBOARD_STEP_SHIFT_PX,
  SPLIT_ELASTIC_CONFIG,
} from '../../../workspace/panelConfig'
import { SPLIT_DIVIDER_PX } from './resolveGrid'

export interface SplitDividerBinding {
  isDragging: boolean
  size: number
  pixelMin: number
  pixelMax: number
  handleMouseDown: (event: React.MouseEvent) => void
  onKeyDown: (event: KeyboardEvent) => void
}

export interface UseSplitDividerArgs {
  containerRef: RefObject<HTMLElement | null>
  axis: 'horizontal' | 'vertical'
  cssVar: '--split-col' | '--split-row'
  initialRatio: number
  onRatioChange: (ratio: number) => void
}

export const useSplitDivider = ({
  containerRef,
  axis,
  cssVar,
  initialRatio,
  onRatioChange,
}: UseSplitDividerArgs): SplitDividerBinding => {
  const writeVar = useCallback(
    (px: number): void => {
      containerRef.current?.style.setProperty(cssVar, `${px}px`)
    },
    [containerRef, cssVar]
  )

  const elastic = useElasticContainer({
    containerRef,
    axis,
    minPercent: SPLIT_ELASTIC_CONFIG.minPercent,
    maxPercent: SPLIT_ELASTIC_CONFIG.maxPercent,
    initialPercent: initialRatio,
    reservedPx: SPLIT_DIVIDER_PX,
    updateMode: 'commit-on-end',
    onDragPreview: writeVar,
  })

  const { size, effectiveDimension, pixelMin, pixelMax, isDragging, adjustBy } =
    elastic

  // Committed `size` change (drag end | keyboard | resize): keep the var current
  // on the paths onDragPreview skips, and mirror the ratio up for remember-within-session.
  useEffect(() => {
    writeVar(size)
    if (effectiveDimension > 0) {
      const ratio = Math.min(
        Math.max(size / effectiveDimension, SPLIT_ELASTIC_CONFIG.minPercent),
        SPLIT_ELASTIC_CONFIG.maxPercent
      )
      onRatioChange(ratio)
    }
  }, [size, effectiveDimension, writeVar, onRatioChange])

  // Restore fr fallback control when this divider unmounts (session deactivates).
  useEffect(
    () => (): void => {
      containerRef.current?.style.removeProperty(cssVar)
    },
    [containerRef, cssVar]
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      const step = event.shiftKey ? KEYBOARD_STEP_SHIFT_PX : KEYBOARD_STEP_PX
      const grow = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
      const shrink = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
      if (event.key === grow) {
        event.preventDefault()
        adjustBy(step)
      } else if (event.key === shrink) {
        event.preventDefault()
        adjustBy(-step)
      } else if (event.key === 'Home') {
        event.preventDefault()
        adjustBy(pixelMin - size)
      } else if (event.key === 'End') {
        event.preventDefault()
        adjustBy(pixelMax - size)
      }
    },
    [axis, adjustBy, pixelMin, pixelMax, size]
  )

  return {
    isDragging,
    size,
    pixelMin,
    pixelMax,
    handleMouseDown: elastic.handleMouseDown,
    onKeyDown,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/terminal/components/SplitView/useSplitDivider.test.tsx`
Expected: PASS (2 tests — keyboard mirror + unmount cleanup).

- [ ] **Step 5: Commit**

```bash
WT=/home/will/projects/vimeflow/.claude/worktrees/split-pane-resize
npx vitest run src/features/terminal/components/SplitView/useSplitDivider.test.tsx
git -C "$WT" add src/features/terminal/components/SplitView/useSplitDivider.ts \
  src/features/terminal/components/SplitView/useSplitDivider.test.tsx
git -C "$WT" commit -m "feat(split-view): useSplitDivider bridge (CSS var + ratio mirror)"
```

### Task 6: `SplitDividers` per-layout components

Each per-layout subcomponent calls a **fixed** number of `useSplitDivider` hooks (no conditional hooks). Handles are direct children (returned as a fragment) so grid-area placement works.

**Files:**

- Create: `src/features/terminal/components/SplitView/SplitDividers.tsx`
- Test: `src/features/terminal/components/SplitView/SplitDividers.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { render, screen } from '@testing-library/react'
import { test, expect, describe, vi } from 'vitest'
import { useRef } from 'react'
import { SplitDividers } from './SplitDividers'
import { DEFAULT_RATIOS } from './resolveGrid'
import type { LayoutId } from '../../../sessions/types'

const Harness = ({ layout }: { layout: LayoutId }): React.ReactElement => {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} style={{ width: 1200, height: 800 }}>
      <SplitDividers
        layout={layout}
        containerRef={ref}
        ratios={DEFAULT_RATIOS[layout]}
        onRatioChange={vi.fn()}
      />
    </div>
  )
}

describe('SplitDividers', () => {
  test.each([
    ['single', 0],
    ['vsplit', 1],
    ['hsplit', 1],
    ['threeRight', 2],
    ['quad', 3],
  ] as const)('%s renders %i handle element(s)', (layout, count) => {
    render(<Harness layout={layout} />)
    expect(screen.queryAllByTestId('split-resize-handle')).toHaveLength(count)
  })

  test('vsplit handle is a vertical separator (col-resize)', () => {
    render(<Harness layout="vsplit" />)
    expect(screen.getByTestId('split-resize-handle')).toHaveAttribute(
      'aria-orientation',
      'vertical'
    )
  })
})
```

> Note: `useElasticContainer` requires a non-zero measured container. In jsdom, `getBoundingClientRect` returns zeros by default, so add a `beforeEach` that mocks it to `{ width: 1200, height: 800, … }` exactly as `useElasticContainer.test.ts` does (copy that mock block), and stub `ResizeObserver` the same way. This keeps the active-mount path from throwing.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/terminal/components/SplitView/SplitDividers.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SplitDividers.tsx`**

```tsx
// cspell:ignore vsplit hsplit
import { Fragment, type ReactElement, type RefObject } from 'react'
import { ResizeHandle } from '../../../../components/ResizeHandle'
import type { LayoutId } from '../../../sessions/types'
import { useSplitDivider } from './useSplitDivider'
import type { LayoutRatios } from './resolveGrid'

export interface SplitDividersProps {
  layout: LayoutId
  containerRef: RefObject<HTMLElement | null>
  ratios: LayoutRatios
  onRatioChange: (axis: 'col' | 'row', ratio: number) => void
}

const HANDLE_TEST_ID = 'split-resize-handle'

const VSplitDividers = ({
  containerRef,
  ratios,
  onRatioChange,
}: Omit<SplitDividersProps, 'layout'>): ReactElement => {
  const col = useSplitDivider({
    containerRef,
    axis: 'horizontal',
    cssVar: '--split-col',
    initialRatio: ratios.col,
    onRatioChange: (r) => onRatioChange('col', r),
  })

  return (
    <ResizeHandle
      orientation="vertical"
      testId={HANDLE_TEST_ID}
      ariaLabel="Resize panes"
      isDragging={col.isDragging}
      ariaValueNow={col.size}
      ariaValueMin={col.pixelMin}
      ariaValueMax={col.pixelMax}
      onMouseDown={col.handleMouseDown}
      onKeyDown={col.onKeyDown}
      className="h-full w-full"
      style={{ gridArea: 'vdiv' }}
    />
  )
}

const HSplitDividers = ({
  containerRef,
  ratios,
  onRatioChange,
}: Omit<SplitDividersProps, 'layout'>): ReactElement => {
  const row = useSplitDivider({
    containerRef,
    axis: 'vertical',
    cssVar: '--split-row',
    initialRatio: ratios.row,
    onRatioChange: (r) => onRatioChange('row', r),
  })

  return (
    <ResizeHandle
      orientation="horizontal"
      testId={HANDLE_TEST_ID}
      ariaLabel="Resize panes"
      isDragging={row.isDragging}
      ariaValueNow={row.size}
      ariaValueMin={row.pixelMin}
      ariaValueMax={row.pixelMax}
      onMouseDown={row.handleMouseDown}
      onKeyDown={row.onKeyDown}
      className="h-full w-full"
      style={{ gridArea: 'hdiv' }}
    />
  )
}

const ThreeRightDividers = ({
  containerRef,
  ratios,
  onRatioChange,
}: Omit<SplitDividersProps, 'layout'>): ReactElement => {
  const col = useSplitDivider({
    containerRef,
    axis: 'horizontal',
    cssVar: '--split-col',
    initialRatio: ratios.col,
    onRatioChange: (r) => onRatioChange('col', r),
  })
  const row = useSplitDivider({
    containerRef,
    axis: 'vertical',
    cssVar: '--split-row',
    initialRatio: ratios.row,
    onRatioChange: (r) => onRatioChange('row', r),
  })

  return (
    <Fragment>
      <ResizeHandle
        orientation="vertical"
        testId={HANDLE_TEST_ID}
        ariaLabel="Resize panes"
        isDragging={col.isDragging}
        ariaValueNow={col.size}
        ariaValueMin={col.pixelMin}
        ariaValueMax={col.pixelMax}
        onMouseDown={col.handleMouseDown}
        onKeyDown={col.onKeyDown}
        className="h-full w-full"
        style={{ gridArea: 'vdiv' }}
      />
      <ResizeHandle
        orientation="horizontal"
        testId={HANDLE_TEST_ID}
        ariaLabel="Resize panes"
        isDragging={row.isDragging}
        ariaValueNow={row.size}
        ariaValueMin={row.pixelMin}
        ariaValueMax={row.pixelMax}
        onMouseDown={row.handleMouseDown}
        onKeyDown={row.onKeyDown}
        className="h-full w-full"
        style={{ gridArea: 'hdiv' }}
      />
    </Fragment>
  )
}

const QuadDividers = ({
  containerRef,
  ratios,
  onRatioChange,
}: Omit<SplitDividersProps, 'layout'>): ReactElement => {
  const col = useSplitDivider({
    containerRef,
    axis: 'horizontal',
    cssVar: '--split-col',
    initialRatio: ratios.col,
    onRatioChange: (r) => onRatioChange('col', r),
  })
  const row = useSplitDivider({
    containerRef,
    axis: 'vertical',
    cssVar: '--split-row',
    initialRatio: ratios.row,
    onRatioChange: (r) => onRatioChange('row', r),
  })

  // One logical column divider rendered as two elements (segmented by the
  // full-width row bar); both share the `col` binding.
  const colHandle = (gridArea: 'vdiv0' | 'vdiv1'): ReactElement => (
    <ResizeHandle
      orientation="vertical"
      testId={HANDLE_TEST_ID}
      ariaLabel="Resize panes"
      isDragging={col.isDragging}
      ariaValueNow={col.size}
      ariaValueMin={col.pixelMin}
      ariaValueMax={col.pixelMax}
      onMouseDown={col.handleMouseDown}
      onKeyDown={col.onKeyDown}
      className="h-full w-full"
      style={{ gridArea }}
    />
  )

  return (
    <Fragment>
      {colHandle('vdiv0')}
      <ResizeHandle
        orientation="horizontal"
        testId={HANDLE_TEST_ID}
        ariaLabel="Resize panes"
        isDragging={row.isDragging}
        ariaValueNow={row.size}
        ariaValueMin={row.pixelMin}
        ariaValueMax={row.pixelMax}
        onMouseDown={row.handleMouseDown}
        onKeyDown={row.onKeyDown}
        className="h-full w-full"
        style={{ gridArea: 'hdiv' }}
      />
      {colHandle('vdiv1')}
    </Fragment>
  )
}

export const SplitDividers = ({
  layout,
  containerRef,
  ratios,
  onRatioChange,
}: SplitDividersProps): ReactElement | null => {
  const childProps = { containerRef, ratios, onRatioChange }
  switch (layout) {
    case 'single':
      return null
    case 'vsplit':
      return <VSplitDividers key="vsplit" {...childProps} />
    case 'hsplit':
      return <HSplitDividers key="hsplit" {...childProps} />
    case 'threeRight':
      return <ThreeRightDividers key="threeRight" {...childProps} />
    case 'quad':
      return <QuadDividers key="quad" {...childProps} />
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/terminal/components/SplitView/SplitDividers.test.tsx`
Expected: PASS (6 cases: counts 0/1/1/2/3 + the vsplit orientation check).

- [ ] **Step 5: Commit**

```bash
WT=/home/will/projects/vimeflow/.claude/worktrees/split-pane-resize
npx vitest run src/features/terminal/components/SplitView/SplitDividers.test.tsx
git -C "$WT" add src/features/terminal/components/SplitView/SplitDividers.tsx \
  src/features/terminal/components/SplitView/SplitDividers.test.tsx
git -C "$WT" commit -m "feat(split-view): per-layout SplitDividers components"
```

### Task 7: Wire `SplitDividers` into `SplitView`

Move padding to an outer `split-view-canvas` wrapper; the inner measured grid carries the `resolveGrid` template and hosts panes + the active-only dividers; `SplitView` owns remembered ratios.

**Files:**

- Modify: `src/features/terminal/components/SplitView/SplitView.tsx`
- Modify: `src/features/terminal/components/SplitView/SplitView.test.tsx`

- [ ] **Step 1: Add imports + ratio state**

In `SplitView.tsx`, add imports:

```tsx
import { useState } from 'react'
import { SplitDividers } from './SplitDividers'
import { resolveGrid, DEFAULT_RATIOS, type LayoutRatios } from './resolveGrid'
```

Inside the component, replace `const layout = LAYOUTS[session.layout]` usage for capacity with ratio state + resolved grid:

```tsx
const [ratios, setRatios] = useState<Partial<Record<LayoutId, LayoutRatios>>>(
  {}
)
const currentRatios = ratios[session.layout] ?? DEFAULT_RATIOS[session.layout]
const grid = resolveGrid(session.layout, currentRatios)

const handleRatioChange = useCallback(
  (axis: 'col' | 'row', value: number): void => {
    setRatios((prev) => {
      const base = prev[session.layout] ?? DEFAULT_RATIOS[session.layout]
      if (base[axis] === value) {
        return prev // bail — no-op update avoids a render loop
      }
      return { ...prev, [session.layout]: { ...base, [axis]: value } }
    })
  },
  [session.layout]
)
```

(`LayoutId` is already imported via `Session`; add it to the type import if not.)

- [ ] **Step 2: Restructure the render — wrapper + inner grid**

Replace the single outer `<div data-testid="split-view" … className="grid … gap-2 bg-surface p-2.5" style={{ gridTemplateColumns: layout.cols, … }}>` with a padded wrapper around the measured grid:

```tsx
return (
  <div
    data-testid="split-view-canvas"
    className="h-full w-full bg-surface p-2.5"
  >
    <div
      ref={outerDivRef}
      data-testid="split-view"
      data-session-id={session.id}
      data-layout={session.layout}
      tabIndex={-1}
      className="grid h-full w-full gap-0"
      style={{
        gridTemplateColumns: grid.cols,
        gridTemplateRows: grid.rows,
        gridTemplateAreas: grid.areas
          .map((row) => `"${row.join(' ')}"`)
          .join(' '),
      }}
    >
      {/* …existing AnimatePresence panes block, unchanged… */}
      {isActive ? (
        <SplitDividers
          layout={session.layout}
          containerRef={outerDivRef}
          ratios={currentRatios}
          onRatioChange={handleRatioChange}
        />
      ) : null}
    </div>
  </div>
)
```

Notes:

- `outerDivRef` is the existing ref; it now points at the padding-free inner grid, so `useElasticContainer` measures the content box `Wc`.
- `gap-2` → `gap-0`: the divider track now provides the 8px separation (`single` has nothing to separate, so it is byte-identical).
- The `<SplitDividers>` fragment renders handle elements as **direct grid children** of the inner grid — no wrapper div.
- `focusActivePane()` / `paneHandleRefs` and the panes `.map` are unchanged.

- [ ] **Step 3: Update + extend `SplitView.test.tsx`**

Run the suite first to see what the refactor breaks:

Run: `npx vitest run src/features/terminal/components/SplitView/SplitView.test.tsx`

Then:

- Any assertion that checked `bg-surface` / `p-2.5` on `split-view` → assert on `split-view-canvas` instead.
- Any assertion on `gridTemplateColumns`/`gridTemplateRows` literal `fr` strings → update to the `resolveGrid` output for that layout (e.g. `vsplit` cols = `var(--split-col, 0.5fr) 8px 0.5fr`). For `single` the template is unchanged (`minmax(0,1fr)`).
- Add these new tests:

```tsx
test('single layout renders no dividers', () => {
  renderSplitView({ layout: 'single', isActive: true })
  expect(screen.queryAllByTestId('split-resize-handle')).toHaveLength(0)
})

test('active vsplit renders a divider; inactive does not', () => {
  const { rerender } = renderSplitView({ layout: 'vsplit', isActive: true })
  expect(screen.getAllByTestId('split-resize-handle')).toHaveLength(1)
  rerender(/* same session, isActive: false */)
  expect(screen.queryAllByTestId('split-resize-handle')).toHaveLength(0)
})

// D4: a resized ratio survives cycling the layout away and back. The
// grid-template's `fr` fallback encodes the remembered ratio, so comparing the
// gridTemplateColumns string before/after the cycle proves persistence.
test('remembers the split ratio across a layout cycle', () => {
  const { rerender } = renderSplitView({ layout: 'vsplit', isActive: true })
  const grid = screen.getByTestId('split-view')
  const pristine = grid.style.gridTemplateColumns

  fireEvent.keyDown(screen.getByTestId('split-resize-handle'), {
    key: 'ArrowRight',
  })
  const resized = screen.getByTestId('split-view').style.gridTemplateColumns
  expect(resized).not.toBe(pristine) // ratio fallback changed

  rerender(/* same session, layout: 'single', isActive: true */)
  rerender(/* same session, layout: 'vsplit', isActive: true */)
  expect(screen.getByTestId('split-view').style.gridTemplateColumns).toBe(
    resized
  )
})

// D2: a resized ratio survives a tab switch (isActive false → true). SplitView
// stays mounted while hidden, so its ratio state persists.
test('remembers the split ratio across a tab switch', () => {
  const { rerender } = renderSplitView({ layout: 'vsplit', isActive: true })
  fireEvent.keyDown(screen.getByTestId('split-resize-handle'), {
    key: 'ArrowRight',
  })
  const resized = screen.getByTestId('split-view').style.gridTemplateColumns

  rerender(/* same session, isActive: false */)
  rerender(/* same session, isActive: true */)
  expect(screen.getByTestId('split-view').style.gridTemplateColumns).toBe(
    resized
  )
})
```

> Use the suite's existing `renderSplitView`/session-builder helper and its `getBoundingClientRect` + `ResizeObserver` setup. If the suite doesn't already mock a non-zero `getBoundingClientRect`, add the same mock block used in `useElasticContainer.test.ts` so the active-mount path doesn't throw.

- [ ] **Step 4: Run the full SplitView suite + type-check**

```bash
WT=/home/will/projects/vimeflow/.claude/worktrees/split-pane-resize
npx vitest run src/features/terminal/components/SplitView/
npm run type-check
```

Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
WT=/home/will/projects/vimeflow/.claude/worktrees/split-pane-resize
git -C "$WT" add src/features/terminal/components/SplitView/SplitView.tsx \
  src/features/terminal/components/SplitView/SplitView.test.tsx
git -C "$WT" commit -m "feat(split-view): drag-to-resize panes for non-single layouts"
```

### Task 8: Full verification pass

- [ ] **Step 1: Lint + format + full test run**

```bash
WT=/home/will/projects/vimeflow/.claude/worktrees/split-pane-resize
npm run lint
npm run format:check
npm run type-check
npm run test
```

Expected: all green. Fix any fallout in the touched files only.

- [ ] **Step 2: Manual smoke (optional but recommended)**

`npm run dev`, open a session, cycle layouts with `Ctrl/Cmd+\`, drag each divider; confirm: panes resize, 15–85% clamp holds, ratio persists across a layout cycle and a tab switch, resets on reload, and the dock still resizes (Phase 1 regression).

- [ ] **Step 3: No commit** — verification only.

---

## Self-Review

**Spec coverage:**

- D1 (ResizeHandle first) → Tasks 1–2. ✓
- D2 (remember-within-session, not across reload) → `SplitView` `ratios` state (Task 7); reset-on-reload is inherent (component state). ✓
- D3 (quad shared cross) → `QuadDividers` two hooks / three elements (Task 6). ✓
- D4 (keep ratio when cycling layouts) → `ratios` keyed by `LayoutId`, never cleared on layout change (Task 7). ✓
- Sizing math / `reservedPx` / content-box → Task 3 + Task 7 wrapper. ✓
- Hook-safety (fixed counts) → per-layout subcomponents (Task 6). ✓
- Bridge (no `onCommit`; `size` effect + var; keyboard/observer covered) → `useSplitDivider` (Task 5). ✓
- `SPLIT_ELASTIC_CONFIG`, `resolveGrid`, divider map → Task 4 / Task 6. ✓
- Active-only mounting (zero-dim guard) → `isActive` gate in Task 7. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code or an exact, discover-at-runtime test adjustment (Task 7 Step 3 names the precise edits).

**Type consistency:** `LayoutRatios { col, row }`, `resolveGrid(layoutId, ratios)`, `SPLIT_DIVIDER_PX`, `SPLIT_ELASTIC_CONFIG`, `effectiveDimension`, `useSplitDivider` args/return, `--split-col`/`--split-row`, `split-resize-handle` testid, grid areas (`vdiv`/`hdiv`/`vdiv0`/`vdiv1`) — all consistent across Tasks 3–7.

**One spec refinement (documented):** the committed template uses an **fr fallback** (`var(--split-col, ${col}fr) 8px ${1-col}fr`) rather than a px fallback. This lets an inactive session render correct proportions with no measurement, while the active drag overrides the leading track via the px var. Symmetry/identical-defaults math is unchanged (the trailing `fr` is the sole remaining `fr`, so it always absorbs the remainder).

<!-- codex-reviewed: 2026-05-26T07:24:18Z -->
