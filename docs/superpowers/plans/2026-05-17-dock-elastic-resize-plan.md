# Dock Elastic Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full drag-resize to all four DockPanel positions (vertical already partially done, horizontal missing) via a shared `useElasticContainer` hook with percent-based, live-updating bounds.

**Architecture:** A new `useElasticContainer` hook wraps the existing `useResizable` primitive, adding `ResizeObserver`-driven percent→pixel bound conversion and post-drag re-clamping. Two instances live in `WorkspaceView` (one per axis); `DockPanel` gains horizontal resize props and a new inner-edge handle. All bounds constants move to `panelConfig.ts`.

**Tech Stack:** React 19, TypeScript (ESM), Vitest + Testing Library, Tailwind CSS, `ResizeObserver` (browser API).

---

## File Map

| Action | File                                                            | Purpose                              |
| ------ | --------------------------------------------------------------- | ------------------------------------ |
| CREATE | `src/features/workspace/panelConfig.ts`                         | All size-tuning constants            |
| MODIFY | `src/hooks/useResizable.ts`                                     | Add `resetToSize` + expose `sizeRef` |
| MODIFY | `src/hooks/useResizable.test.ts`                                | Tests for new methods                |
| CREATE | `src/hooks/useElasticContainer.ts`                              | Percent-bound resize hook            |
| CREATE | `src/hooks/useElasticContainer.test.ts`                         | Hook unit tests                      |
| MODIFY | `src/features/workspace/components/DockPanel.tsx`               | New props + horizontal handle        |
| MODIFY | `src/features/workspace/components/DockPanel.test.tsx`          | Tests for horizontal handle          |
| MODIFY | `src/features/workspace/WorkspaceView.tsx`                      | Wire elastic containers              |
| MODIFY | `src/features/workspace/WorkspaceView.test.tsx`                 | Add useElasticContainer mock         |
| MODIFY | `src/features/workspace/WorkspaceView.integration.test.tsx`     | Add useElasticContainer mock         |
| MODIFY | `src/features/workspace/WorkspaceView.command-palette.test.tsx` | Add useElasticContainer mock         |
| MODIFY | `src/features/workspace/WorkspaceView.notifyInfo.test.tsx`      | Add useElasticContainer mock         |
| MODIFY | `src/features/workspace/WorkspaceView.subscription.test.tsx`    | Add useElasticContainer mock         |
| MODIFY | `src/features/workspace/WorkspaceView.verification.test.tsx`    | Add useElasticContainer mock         |
| MODIFY | `src/features/workspace/WorkspaceView.visual.test.tsx`          | Add useElasticContainer mock         |
| CREATE | `src/features/workspace/WorkspaceView.elastic.test.tsx`         | Issue #217 persistence proof         |

---

## Task 1: Create `panelConfig.ts`

**Files:**

- Create: `src/features/workspace/panelConfig.ts`

- [ ] **Step 1: Write the file**

```typescript
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
 * Terminal zone outer elastic config — reserved for future useElasticContainer
 * wiring of the whole terminal zone.
 */
export const TERMINAL_ZONE_ELASTIC_CONFIG = {
  minPercent: 0.1,
  maxPercent: 0.9,
  initialPercent: 0.5,
} as const

/**
 * Per-pane elastic config descriptor for TerminalZone's 1–4 pane splits.
 * Intentionally omits `containerRef` and `axis` — those are call-site concerns.
 * NOT directly spreadable into UseElasticContainerOptions.
 * Out of scope for this PR — defined here to avoid a future breaking change.
 */
export interface PaneElasticConfig {
  minPercent: number
  maxPercent: number
  /** undefined = compute as 1/paneCount at runtime. */
  initialPercent: number | undefined
}

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

- [ ] **Step 2: Verify type-check passes**

```bash
npx tsc -b --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/workspace/panelConfig.ts
git commit -m "feat(resize): add panelConfig.ts — single tuning surface for all panel bounds"
```

---

## Task 2: Extend `useResizable` with `resetToSize` and `sizeRef`

**Files:**

- Modify: `src/hooks/useResizable.ts`
- Modify: `src/hooks/useResizable.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/hooks/useResizable.test.ts` (inside the `describe('useResizable', ...)` block, before its closing `}`):

```typescript
describe('resetToSize', () => {
  test('sets size to clamped value', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 256, min: 100, max: 500 })
    )

    act(() => {
      result.current.resetToSize(300)
    })

    expect(result.current.size).toBe(300)
  })

  test('clamps to min when value is below min', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 256, min: 100, max: 500 })
    )

    act(() => {
      result.current.resetToSize(50)
    })

    expect(result.current.size).toBe(100)
  })

  test('clamps to max when value is above max', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 256, min: 100, max: 500 })
    )

    act(() => {
      result.current.resetToSize(600)
    })

    expect(result.current.size).toBe(500)
  })

  test('uses explicit bounds when provided, bypassing closure min/max', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 256, min: 100, max: 500 })
    )

    act(() => {
      result.current.resetToSize(800, 50, 900)
    })

    expect(result.current.size).toBe(800)
  })

  test('updates previewSize so adjustBy baseline is fresh after reset', async () => {
    const { result } = renderHook(() =>
      useResizable({
        initial: 256,
        min: 100,
        max: 500,
        updateMode: 'commit-on-end',
      })
    )

    act(() => {
      result.current.resetToSize(400)
    })

    act(() => {
      result.current.adjustBy(0)
    })

    await waitFor(() => {
      expect(result.current.size).toBe(400)
    })
  })
})

describe('sizeRef', () => {
  test('sizeRef.current matches size on initial render', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 256, min: 100, max: 500 })
    )

    expect(result.current.sizeRef.current).toBe(256)
  })

  test('sizeRef.current updates synchronously after resetToSize', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 256, min: 100, max: 500 })
    )

    act(() => {
      result.current.resetToSize(350)
    })

    expect(result.current.sizeRef.current).toBe(350)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/hooks/useResizable.test.ts 2>&1 | tail -20
```

Expected: FAIL — `result.current.resetToSize is not a function`.

- [ ] **Step 3: Implement `resetToSize` and expose `sizeRef` in `useResizable.ts`**

In `src/hooks/useResizable.ts`, update `UseResizableResult`:

```typescript
export interface UseResizableResult {
  size: number
  isDragging: boolean
  handleMouseDown: (e: React.MouseEvent) => void
  adjustBy: (delta: number) => void
  /**
   * Set size to an absolute pixel value, clamped to [min, max].
   * Pass explicitMin/explicitMax to bypass stale closure bounds
   * (required when called from a ResizeObserver callback alongside
   * a state update that hasn't re-rendered yet).
   */
  resetToSize: (px: number, explicitMin?: number, explicitMax?: number) => void
  /** Synchronous read of the last committed size; safe to read in callbacks. */
  sizeRef: React.MutableRefObject<number>
}
```

Add `MutableRefObject` to the React import at top of file:

```typescript
import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
  type MutableRefObject,
} from 'react'
```

Add `resetToSize` callback inside `useResizable` (after the `adjustBy` definition):

```typescript
const resetToSize = useCallback(
  (px: number, explicitMin?: number, explicitMax?: number): void => {
    const clampMin = explicitMin ?? min
    const clampMax = explicitMax ?? max
    cancelPendingSize()
    const nextSize = clampSize(px, clampMin, clampMax)
    commitSize(nextSize)
    // Unconditionally sync previewSize so adjustBy baseline is fresh
    // even in commit-on-end mode (where commitSize doesn't update previewSize).
    previewSize.current = nextSize
    if (isDraggingRef.current) {
      startPos.current = currentPos.current
      startSize.current = nextSize
    }
  },
  [min, max, cancelPendingSize, commitSize]
)
```

Update the return statement:

```typescript
return { size, isDragging, handleMouseDown, adjustBy, resetToSize, sizeRef }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/hooks/useResizable.test.ts 2>&1 | tail -10
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useResizable.ts src/hooks/useResizable.test.ts
git commit -m "feat(resize): add resetToSize + expose sizeRef on useResizable"
```

---

## Task 3: Create `useElasticContainer`

**Files:**

- Create: `src/hooks/useElasticContainer.ts`
- Create: `src/hooks/useElasticContainer.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/hooks/useElasticContainer.test.ts`:

```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useElasticContainer } from './useElasticContainer'

// Stub ResizeObserver globally — jsdom doesn't implement it.
let observerCallback: ResizeObserverCallback | null = null
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()
const mockUnobserve = vi.fn()

class MockResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    observerCallback = cb
  }
  observe = mockObserve
  disconnect = mockDisconnect
  unobserve = mockUnobserve
}

vi.stubGlobal('ResizeObserver', MockResizeObserver)

// Return realistic dimensions so the hook does not throw on null ref.
const CONTAINER_WIDTH = 1200
const CONTAINER_HEIGHT = 800

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: CONTAINER_WIDTH,
    height: CONTAINER_HEIGHT,
    top: 0,
    left: 0,
    right: CONTAINER_WIDTH,
    bottom: CONTAINER_HEIGHT,
    x: 0,
    y: 0,
    toJSON: () => undefined,
  } as DOMRect)
  observerCallback = null
  mockObserve.mockClear()
  mockDisconnect.mockClear()
  mockUnobserve.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const renderElastic = (
  overrides: Partial<{
    axis: 'horizontal' | 'vertical'
    minPercent: number
    maxPercent: number
    initialPercent: number
  }> = {}
) => {
  const containerEl = document.createElement('div')
  return renderHook(() => {
    const containerRef = useRef<HTMLDivElement>(containerEl)
    return useElasticContainer({
      containerRef,
      axis: 'horizontal',
      minPercent: 0.05,
      maxPercent: 0.8,
      initialPercent: 0.3,
      ...overrides,
    })
  })
}

describe('useElasticContainer', () => {
  test('initializes size from initialPercent × container dimension', () => {
    // 0.3 × 1200 = 360
    const { result } = renderElastic({
      axis: 'horizontal',
      initialPercent: 0.3,
    })
    expect(result.current.size).toBe(360)
  })

  test('initializes pixelMin and pixelMax from percent config', () => {
    // minPercent 0.05 × 1200 → ceil(60) = 60
    // maxPercent 0.80 × 1200 → floor(960) = 960
    const { result } = renderElastic({
      axis: 'horizontal',
      minPercent: 0.05,
      maxPercent: 0.8,
    })
    expect(result.current.pixelMin).toBe(60)
    expect(result.current.pixelMax).toBe(960)
  })

  test('uses vertical dimension when axis is vertical', () => {
    // 0.3 × 800 = 240
    const { result } = renderElastic({ axis: 'vertical', initialPercent: 0.3 })
    expect(result.current.size).toBe(240)
  })

  test('defaults initialPercent to midpoint when not provided', () => {
    // midpoint = (0.05 + 0.80) / 2 = 0.425; 0.425 × 1200 = 510
    const { result } = renderElastic({
      axis: 'horizontal',
      minPercent: 0.05,
      maxPercent: 0.8,
      initialPercent: undefined as unknown as number,
    })
    expect(result.current.size).toBe(510)
  })

  test('throws when containerRef.current is null', () => {
    expect(() => {
      renderHook(() => {
        const containerRef = useRef<HTMLDivElement>(null)
        return useElasticContainer({
          containerRef,
          axis: 'horizontal',
          minPercent: 0.05,
          maxPercent: 0.8,
        })
      })
    }).toThrow()
  })

  test('throws when minPercent >= maxPercent in dev', () => {
    expect(() => {
      renderElastic({ minPercent: 0.8, maxPercent: 0.05 })
    }).toThrow()
  })

  test('ResizeObserver re-clamp updates pixelMin/pixelMax on container resize', () => {
    const { result } = renderElastic({
      axis: 'horizontal',
      minPercent: 0.05,
      maxPercent: 0.8,
    })

    // Simulate container resize to 800px wide
    act(() => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 800,
        height: CONTAINER_HEIGHT,
        top: 0,
        left: 0,
        right: 800,
        bottom: CONTAINER_HEIGHT,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      } as DOMRect)
      observerCallback?.(
        [
          {
            contentRect: { width: 800, height: CONTAINER_HEIGHT },
          } as ResizeObserverEntry,
        ],
        {} as ResizeObserver
      )
    })

    // ceil(800 * 0.05) = 40, floor(800 * 0.80) = 640
    expect(result.current.pixelMin).toBe(40)
    expect(result.current.pixelMax).toBe(640)
  })

  test('ResizeObserver clamps size when container shrinks below current size', () => {
    const { result } = renderElastic({
      axis: 'horizontal',
      minPercent: 0.05,
      maxPercent: 0.8,
      initialPercent: 0.7,
    })
    // Initial: 0.7 × 1200 = 840px

    act(() => {
      observerCallback?.(
        [
          {
            contentRect: { width: 400, height: CONTAINER_HEIGHT },
          } as ResizeObserverEntry,
        ],
        {} as ResizeObserver
      )
    })

    // max = floor(400 * 0.8) = 320; size must be ≤ 320
    expect(result.current.size).toBeLessThanOrEqual(320)
  })

  test('disconnects ResizeObserver on unmount', () => {
    const { unmount } = renderElastic()
    unmount()
    expect(mockDisconnect).toHaveBeenCalled()
  })

  test('returns handleMouseDown, adjustBy, isDragging, sizeRef', () => {
    const { result } = renderElastic()
    expect(typeof result.current.handleMouseDown).toBe('function')
    expect(typeof result.current.adjustBy).toBe('function')
    expect(typeof result.current.isDragging).toBe('boolean')
    expect(typeof result.current.sizeRef.current).toBe('number')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/hooks/useElasticContainer.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useElasticContainer.ts`**

Create `src/hooks/useElasticContainer.ts`:

```typescript
import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  type RefObject,
  type MutableRefObject,
} from 'react'
import {
  useResizable,
  clampSize,
  type UseResizableResult,
} from './useResizable'

export interface UseElasticContainerOptions {
  /**
   * Ref to the parent available-area element (NOT the resizable panel itself).
   * Pre-condition: must be non-null when the first useLayoutEffect fires.
   * Mount-time constant — the ResizeObserver is attached once and never reconnected.
   */
  containerRef: RefObject<Element | null>
  /**
   * Which dimension to observe. Maps to useResizable direction.
   * Mount-time constant — changing after mount results in undefined behavior.
   */
  axis: 'horizontal' | 'vertical'
  /** Fraction of available dimension for minimum size. 0 < min < max ≤ 1. Mount-time constant. */
  minPercent: number
  /** Fraction of available dimension for maximum size. Mount-time constant. */
  maxPercent: number
  /** Initial size as fraction of dimension. Defaults to (min+max)/2. Mount-time constant. */
  initialPercent?: number
  invert?: boolean
  updateMode?: 'live' | 'commit-on-end'
  onDragPreview?: (size: number) => void
}

export interface UseElasticContainerResult extends UseResizableResult {
  pixelMin: number
  pixelMax: number
}

export const useElasticContainer = ({
  containerRef,
  axis,
  minPercent,
  maxPercent,
  initialPercent,
  invert = false,
  updateMode = 'live',
  onDragPreview = undefined,
}: UseElasticContainerOptions): UseElasticContainerResult => {
  // Snapshot mount-time percent options into refs so the init effect
  // always reads the original values even if props change.
  const minPercentRef = useRef(minPercent)
  const maxPercentRef = useRef(maxPercent)
  const initialPercentRef = useRef(initialPercent)

  const [pixelMin, setPixelMin] = useState(0)
  const [pixelMax, setPixelMax] = useState(Number.MAX_SAFE_INTEGER)

  // Internal refs for synchronous reads in callbacks.
  const pixelMinRef = useRef(0)
  const pixelMaxRef = useRef(Number.MAX_SAFE_INTEGER)
  const pendingReclampRef = useRef(false)

  const resizable = useResizable({
    initial: 0,
    min: pixelMin,
    max: pixelMax,
    direction: axis,
    invert,
    updateMode,
    onDragPreview,
  })

  const { resetToSize, sizeRef, isDragging } = resizable

  // Keep isDraggingRef in sync for synchronous reads in ResizeObserver callbacks.
  const isDraggingRef = useRef(false)
  useLayoutEffect(() => {
    isDraggingRef.current = isDragging
  }, [isDragging])

  // Post-drag re-clamp: if a ResizeObserver fired during drag, apply the
  // deferred clamp now that the drag has ended.
  useEffect(() => {
    if (isDragging || !pendingReclampRef.current) {
      return
    }
    pendingReclampRef.current = false
    resetToSize(sizeRef.current, pixelMinRef.current, pixelMaxRef.current)
  }, [isDragging, resetToSize, sizeRef])

  const computeBounds = useCallback(
    (dimension: number): { newMin: number; newMax: number } => {
      const mn = minPercentRef.current
      const mx = maxPercentRef.current

      if (mn <= 0 || mx > 1 || mn >= mx) {
        if (import.meta.env.DEV) {
          throw new Error(
            `useElasticContainer: invalid percent bounds minPercent=${mn} maxPercent=${mx}`
          )
        }
      }

      let newMin = Math.ceil(dimension * mn)
      let newMax = Math.floor(dimension * mx)

      if (newMin >= newMax) {
        if (import.meta.env.DEV) {
          throw new Error(
            `useElasticContainer: degenerate container — pixelMin(${newMin}) >= pixelMax(${newMax})`
          )
        }
        newMax = newMin
      }

      return { newMin, newMax }
    },
    []
  )

  // Mount-only initialization.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) {
      throw new Error(
        'useElasticContainer: containerRef.current is null at mount'
      )
    }

    const rect = el.getBoundingClientRect()
    const dimension = axis === 'horizontal' ? rect.width : rect.height
    const { newMin, newMax } = computeBounds(dimension)

    const effectiveInitial =
      initialPercentRef.current ??
      (minPercentRef.current + maxPercentRef.current) / 2
    const newInitial = clampSize(dimension * effectiveInitial, newMin, newMax)

    pixelMinRef.current = newMin
    pixelMaxRef.current = newMax
    setPixelMin(newMin)
    setPixelMax(newMax)
    resetToSize(newInitial, newMin, newMax)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const dim =
        axis === 'horizontal'
          ? entry.contentRect.width
          : entry.contentRect.height

      const { newMin: rMin, newMax: rMax } = computeBounds(dim)

      pixelMinRef.current = rMin
      pixelMaxRef.current = rMax
      setPixelMin(rMin)
      setPixelMax(rMax)

      if (isDraggingRef.current) {
        pendingReclampRef.current = true
        return
      }
      resetToSize(sizeRef.current, rMin, rMax)
    })

    observer.observe(el)

    return (): void => {
      observer.disconnect()
    }
    // Empty deps: axis, percent refs, and containerRef are all mount-time constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    ...resizable,
    pixelMin,
    pixelMax,
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/hooks/useElasticContainer.test.ts 2>&1 | tail -15
```

Expected: all PASS.

- [ ] **Step 5: Run full type-check**

```bash
npx tsc -b --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useElasticContainer.ts src/hooks/useElasticContainer.test.ts
git commit -m "feat(resize): add useElasticContainer — percent-bound ResizeObserver hook"
```

---

## Task 4: Update `DockPanel` — new props + horizontal resize handle

**Files:**

- Modify: `src/features/workspace/components/DockPanel.tsx`
- Modify: `src/features/workspace/components/DockPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

Add to `src/features/workspace/components/DockPanel.test.tsx`.

First update `renderDockPanel` to include new required props. Find the `props` object inside `renderDockPanel` and extend it:

```typescript
const renderDockPanel = (
  overrides: Partial<DockPanelTestProps> = {}
): ReturnType<typeof render> => {
  const props: DockPanelTestProps = {
    position: 'bottom',
    tab: 'editor',
    onTabChange: vi.fn(),
    onPositionChange: vi.fn(),
    onClose: vi.fn(),
    verticalSize: 400,
    onVerticalResizeMouseDown: vi.fn(),
    isVerticalResizing: false,
    onVerticalSizeAdjust: vi.fn(),
    verticalPixelMin: 40,
    verticalPixelMax: 640,
    horizontalSize: 360,
    onHorizontalResizeMouseDown: vi.fn(),
    isHorizontalResizing: false,
    onHorizontalSizeAdjust: vi.fn(),
    horizontalPixelMin: 40,
    horizontalPixelMax: 640,
    selectedFilePath: null,
    content: '',
    ...overrides,
  } as DockPanelTestProps

  return render(<DockPanel {...props} />)
}
```

Then add these new tests (append inside the `describe('DockPanel', ...)` block):

```typescript
test('renders horizontal resize handle for left dock', () => {
  renderDockPanel({ position: 'left' })
  const handle = screen.getByTestId('resize-handle')
  expect(handle).toBeInTheDocument()
  expect(handle).toHaveAttribute('aria-orientation', 'vertical')
})

test('renders horizontal resize handle for right dock', () => {
  renderDockPanel({ position: 'right' })
  const handle = screen.getByTestId('resize-handle')
  expect(handle).toBeInTheDocument()
  expect(handle).toHaveAttribute('aria-orientation', 'vertical')
})

test('horizontal resize handle is on right edge for left dock', () => {
  renderDockPanel({ position: 'left' })
  const handle = screen.getByTestId('resize-handle')
  expect(handle.className).toMatch(/right-0/)
})

test('horizontal resize handle is on left edge for right dock', () => {
  renderDockPanel({ position: 'right' })
  const handle = screen.getByTestId('resize-handle')
  expect(handle.className).toMatch(/left-0/)
})

test('side dock uses controlled width from horizontalSize prop', () => {
  renderDockPanel({ position: 'left', horizontalSize: 480 })
  expect(screen.getByTestId('dock-panel')).toHaveStyle({ width: '480px' })
})

test('side dock does not use flex basis', () => {
  renderDockPanel({ position: 'right', horizontalSize: 360 })
  const panel = screen.getByTestId('dock-panel')
  expect(panel).not.toHaveStyle({ flex: '0 0 40%' })
})

test('horizontal handle mousedown calls onHorizontalResizeMouseDown', () => {
  const onHorizontalResizeMouseDown = vi.fn()
  renderDockPanel({ position: 'left', onHorizontalResizeMouseDown })
  fireEvent.mouseDown(screen.getByTestId('resize-handle'))
  expect(onHorizontalResizeMouseDown).toHaveBeenCalled()
})

test('left dock ArrowRight grows horizontal size', async () => {
  const user = userEvent.setup()
  const onHorizontalSizeAdjust = vi.fn()
  renderDockPanel({ position: 'left', onHorizontalSizeAdjust })
  screen.getByTestId('resize-handle').focus()
  await user.keyboard('{ArrowRight}')
  expect(onHorizontalSizeAdjust).toHaveBeenCalledWith(20)
})

test('left dock ArrowLeft shrinks horizontal size', async () => {
  const user = userEvent.setup()
  const onHorizontalSizeAdjust = vi.fn()
  renderDockPanel({ position: 'left', onHorizontalSizeAdjust })
  screen.getByTestId('resize-handle').focus()
  await user.keyboard('{ArrowLeft}')
  expect(onHorizontalSizeAdjust).toHaveBeenCalledWith(-20)
})

test('right dock ArrowLeft grows horizontal size (invert)', async () => {
  const user = userEvent.setup()
  const onHorizontalSizeAdjust = vi.fn()
  renderDockPanel({ position: 'right', onHorizontalSizeAdjust })
  screen.getByTestId('resize-handle').focus()
  await user.keyboard('{ArrowLeft}')
  expect(onHorizontalSizeAdjust).toHaveBeenCalledWith(20)
})

test('vertical handle aria-valuemin/max come from verticalPixelMin/Max props', () => {
  renderDockPanel({
    position: 'bottom',
    verticalPixelMin: 75,
    verticalPixelMax: 900,
  })
  const handle = screen.getByTestId('resize-handle')
  expect(handle).toHaveAttribute('aria-valuemin', '75')
  expect(handle).toHaveAttribute('aria-valuemax', '900')
})

test('horizontal handle aria-valuemin/max come from horizontalPixelMin/Max props', () => {
  renderDockPanel({
    position: 'left',
    horizontalPixelMin: 60,
    horizontalPixelMax: 960,
  })
  const handle = screen.getByTestId('resize-handle')
  expect(handle).toHaveAttribute('aria-valuemin', '60')
  expect(handle).toHaveAttribute('aria-valuemax', '960')
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/features/workspace/components/DockPanel.test.tsx 2>&1 | tail -20
```

Expected: many FAIL — missing props and horizontal handle not implemented.

- [ ] **Step 3: Rewrite `DockPanel.tsx`**

Replace the entire file content:

```typescript
import type { KeyboardEvent, MouseEvent, ReactElement } from 'react'
import { CodeEditor } from '../../editor/components/CodeEditor'
import { DiffPanelContent } from '../../diff/components/DiffPanelContent'
import { DockSwitcher, type DockPosition } from './DockSwitcher'
import { DockTab } from './DockTab'
import type { SelectedDiffFile } from '../../diff/types'
import type { UseGitStatusReturn } from '../../diff/hooks/useGitStatus'
import {
  KEYBOARD_STEP_PX,
  KEYBOARD_STEP_SHIFT_PX,
} from '../panelConfig'

type TabType = 'editor' | 'diff'

type SelectedDiffControl =
  | { selectedDiffFile?: undefined; onSelectedDiffFileChange?: undefined }
  | {
      selectedDiffFile: SelectedDiffFile | null
      onSelectedDiffFileChange: (file: SelectedDiffFile | null) => void
    }

interface DockPanelBaseProps {
  position: DockPosition
  tab: TabType
  onTabChange: (next: TabType) => void
  onPositionChange: (next: DockPosition) => void
  onClose: () => void
  /** Controlled height for top/bottom docks. */
  verticalSize: number
  onVerticalResizeMouseDown: (event: MouseEvent) => void
  isVerticalResizing: boolean
  onVerticalSizeAdjust: (delta: number) => void
  /** Live pixel bounds from useElasticContainer (for ARIA + keyboard Home/End). */
  verticalPixelMin: number
  verticalPixelMax: number
  /** Controlled width for left/right docks. */
  horizontalSize: number
  onHorizontalResizeMouseDown: (event: MouseEvent) => void
  isHorizontalResizing: boolean
  onHorizontalSizeAdjust: (delta: number) => void
  horizontalPixelMin: number
  horizontalPixelMax: number

  selectedFilePath: string | null
  content: string
  onContentChange?: (content: string) => void
  onSave?: () => void
  isDirty?: boolean
  isLoading?: boolean
  cwd?: string
  gitStatus?: UseGitStatusReturn
}

type DockPanelProps = DockPanelBaseProps & SelectedDiffControl

const DockPanel = ({
  position,
  tab,
  onTabChange,
  onPositionChange,
  onClose,
  verticalSize,
  onVerticalResizeMouseDown,
  isVerticalResizing,
  onVerticalSizeAdjust,
  verticalPixelMin,
  verticalPixelMax,
  horizontalSize,
  onHorizontalResizeMouseDown,
  isHorizontalResizing,
  onHorizontalSizeAdjust,
  horizontalPixelMin,
  horizontalPixelMax,
  selectedFilePath,
  content,
  onContentChange = undefined,
  onSave = undefined,
  isDirty = false,
  isLoading = false,
  cwd = '.',
  gitStatus = undefined,
  selectedDiffFile,
  onSelectedDiffFileChange,
}: DockPanelProps): ReactElement => {
  const isVerticalDock = position === 'top' || position === 'bottom'

  const containerStyle = isVerticalDock
    ? { height: `${verticalSize}px` }
    : { width: `${horizontalSize}px` }

  const borderClass =
    position === 'top'
      ? 'border-b border-[rgba(74,68,79,0.3)]'
      : position === 'bottom'
        ? 'border-t border-[rgba(74,68,79,0.3)]'
        : position === 'left'
          ? 'border-r border-[rgba(74,68,79,0.3)]'
          : 'border-l border-[rgba(74,68,79,0.3)]'

  const collapseIconName =
    position === 'top'
      ? 'expand_less'
      : position === 'bottom'
        ? 'expand_more'
        : position === 'left'
          ? 'chevron_left'
          : 'chevron_right'

  const sectionAriaLabel = tab === 'editor' ? 'Code editor' : 'Diff viewer'

  const handleVerticalKeyDown = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? KEYBOARD_STEP_SHIFT_PX : KEYBOARD_STEP_PX
    const growKey = position === 'top' ? 'ArrowDown' : 'ArrowUp'
    const shrinkKey = position === 'top' ? 'ArrowUp' : 'ArrowDown'

    if (e.key === growKey) {
      e.preventDefault()
      onVerticalSizeAdjust(step)
    } else if (e.key === shrinkKey) {
      e.preventDefault()
      onVerticalSizeAdjust(-step)
    } else if (e.key === 'Home') {
      e.preventDefault()
      onVerticalSizeAdjust(verticalPixelMin - verticalSize)
    } else if (e.key === 'End') {
      e.preventDefault()
      onVerticalSizeAdjust(verticalPixelMax - verticalSize)
    }
  }

  const handleHorizontalKeyDown = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? KEYBOARD_STEP_SHIFT_PX : KEYBOARD_STEP_PX
    // Left dock grows rightward (ArrowRight = grow), right dock grows leftward (ArrowLeft = grow).
    const growKey = position === 'left' ? 'ArrowRight' : 'ArrowLeft'
    const shrinkKey = position === 'left' ? 'ArrowLeft' : 'ArrowRight'

    if (e.key === growKey) {
      e.preventDefault()
      onHorizontalSizeAdjust(step)
    } else if (e.key === shrinkKey) {
      e.preventDefault()
      onHorizontalSizeAdjust(-step)
    } else if (e.key === 'Home') {
      e.preventDefault()
      onHorizontalSizeAdjust(horizontalPixelMin - horizontalSize)
    } else if (e.key === 'End') {
      e.preventDefault()
      onHorizontalSizeAdjust(horizontalPixelMax - horizontalSize)
    }
  }

  return (
    <section
      data-testid="dock-panel"
      data-position={position}
      aria-label={sectionAriaLabel}
      style={containerStyle}
      className={`relative z-30 flex shrink-0 flex-col bg-[#121221] ${borderClass}`}
    >
      {isVerticalDock ? (
        <div
          data-testid="resize-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize panel"
          aria-valuenow={verticalSize}
          aria-valuemin={verticalPixelMin}
          aria-valuemax={verticalPixelMax}
          tabIndex={0}
          onMouseDown={onVerticalResizeMouseDown}
          onKeyDown={handleVerticalKeyDown}
          className={`absolute ${position === 'top' ? 'bottom-0' : 'top-0'} left-0 right-0 h-1 cursor-ns-resize transition-colors hover:bg-primary/20 focus:bg-primary/40 focus:outline-none ${
            isVerticalResizing ? 'bg-primary/30' : ''
          }`}
        />
      ) : (
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
          onKeyDown={handleHorizontalKeyDown}
          className={`absolute ${position === 'right' ? 'left-0' : 'right-0'} top-0 bottom-0 w-1 cursor-col-resize transition-colors hover:bg-primary/20 focus:bg-primary/40 focus:outline-none ${
            isHorizontalResizing ? 'bg-primary/30' : ''
          }`}
        />
      )}

      <DockTab
        tab={tab}
        onTabChange={onTabChange}
        selectedFilePath={selectedFilePath}
        collapseIconName={collapseIconName}
        onClose={onClose}
      >
        <DockSwitcher position={position} onPick={onPositionChange} />
      </DockTab>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {tab === 'editor' && (
          <div
            data-testid="editor-panel"
            className="flex min-h-0 flex-1 overflow-hidden"
          >
            <CodeEditor
              filePath={selectedFilePath}
              content={content}
              onContentChange={onContentChange}
              onSave={onSave}
              isDirty={isDirty}
              isLoading={isLoading}
            />
          </div>
        )}

        {tab === 'diff' && (
          <div
            data-testid="diff-panel"
            className="flex min-h-0 flex-1 overflow-hidden"
          >
            {selectedDiffFile !== undefined ? (
              <DiffPanelContent
                cwd={cwd}
                gitStatus={gitStatus}
                selectedFile={selectedDiffFile}
                onSelectedFileChange={onSelectedDiffFileChange}
              />
            ) : (
              <DiffPanelContent cwd={cwd} gitStatus={gitStatus} />
            )}
          </div>
        )}
      </div>
    </section>
  )
}

export default DockPanel
```

- [ ] **Step 4: Run DockPanel tests**

```bash
npx vitest run src/features/workspace/components/DockPanel.test.tsx 2>&1 | tail -20
```

Expected: all PASS. Fix any failures before continuing.

- [ ] **Step 5: Run type-check**

```bash
npx tsc -b --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/components/DockPanel.tsx src/features/workspace/components/DockPanel.test.tsx
git commit -m "feat(dock): add horizontal resize handle + percent-bound ARIA props"
```

---

## Task 5: Wire `useElasticContainer` into `WorkspaceView`

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/WorkspaceView.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.integration.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.command-palette.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.notifyInfo.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.subscription.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.verification.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.visual.test.tsx`

- [ ] **Step 1: Add `useElasticContainer` mock to all existing WorkspaceView test files**

Add this module-level mock to the top of each of the 7 test files listed above (after existing `vi.mock(...)` calls, before any `describe`):

```typescript
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

Note: `WorkspaceView.command-palette.test.tsx`, `WorkspaceView.notifyInfo.test.tsx`, etc. use paths relative to their location. If the test file is in `src/features/workspace/`, the mock path is `'../../hooks/useElasticContainer'`.

- [ ] **Step 2: Confirm all existing WorkspaceView tests still pass**

```bash
npx vitest run src/features/workspace/WorkspaceView.test.tsx src/features/workspace/WorkspaceView.integration.test.tsx src/features/workspace/WorkspaceView.command-palette.test.tsx src/features/workspace/WorkspaceView.notifyInfo.test.tsx src/features/workspace/WorkspaceView.subscription.test.tsx src/features/workspace/WorkspaceView.verification.test.tsx src/features/workspace/WorkspaceView.visual.test.tsx 2>&1 | tail -20
```

Expected: all PASS (before the WorkspaceView changes — mocks prevent the jsdom zero-dimension throw).

- [ ] **Step 3: Update `WorkspaceView.tsx`**

**3a. Add import for `useElasticContainer` and `DOCK_ELASTIC_CONFIG`:**

Find the imports section and add:

```typescript
import { useElasticContainer } from '../../hooks/useElasticContainer'
import { DOCK_ELASTIC_CONFIG } from './panelConfig'
```

Remove the old import of `clampSize` if it was only used for vertical dock (check — it's also used for sidebar, so keep it).

**3b. Add `dockCanvasRef` just before the `dockPosition` state:**

```typescript
// Ref to the dock-canvas-wrapper div; used by useElasticContainer to measure
// the available area for percent-based bounds.
const dockCanvasRef = useRef<HTMLDivElement>(null)
```

**3c. Replace the `verticalDockResize = useResizable(...)` block (lines ~361-369 in the original) with two elastic instances:**

Remove:

```typescript
// Vertical dock height is lifted so the value survives DockPanel unmounts.
const verticalDockResize = useResizable({
  initial: 400,
  min: 150,
  max: 640,
  direction: 'vertical',
  // Bottom dock grows when dragging up from its top edge; top dock grows
  // when dragging down from its bottom edge.
  invert: dockPosition === 'bottom',
})
```

Add:

```typescript
// Two separate elastic instances — one per axis — so each size survives
// dock position switches and DockPanel unmounts independently.
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

**3d. Update `terminalFitDeferred` (line ~579 in original):**

Change:

```typescript
const terminalFitDeferred = isDragging || verticalDockResize.isDragging
```

To:

```typescript
const terminalFitDeferred =
  isDragging ||
  verticalDockElastic.isDragging ||
  horizontalDockElastic.isDragging
```

**3e. Update the `<DockPanel>` call site (lines ~582-604 in original):**

Replace:

```tsx
      verticalSize={verticalDockResize.size}
      onVerticalResizeMouseDown={verticalDockResize.handleMouseDown}
      isVerticalResizing={verticalDockResize.isDragging}
      onVerticalSizeAdjust={verticalDockResize.adjustBy}
```

With:

```tsx
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
```

**3f. Add `ref={dockCanvasRef}` to the `dock-canvas-wrapper` div (line ~700 in original):**

Change:

```tsx
        <div
          data-testid="dock-canvas-wrapper"
          className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
          style={{ flexDirection: dockCanvasFlexDirection }}
        >
```

To:

```tsx
        <div
          ref={dockCanvasRef}
          data-testid="dock-canvas-wrapper"
          className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
          style={{ flexDirection: dockCanvasFlexDirection }}
        >
```

**3g. Remove the now-unused `useResizable` import if `verticalDockResize` was the only call-site for the dock. Keep it for the sidebar resize — check:**

Grep the file: `useResizable` is also called for the sidebar (`const { size: sidebarWidth, ... } = useResizable(...)`). Keep the import.

- [ ] **Step 4: Run type-check**

```bash
npx tsc -b --noEmit 2>&1 | head -30
```

Expected: no errors. Fix any prop-shape mismatches before continuing.

- [ ] **Step 5: Run all WorkspaceView tests**

```bash
npx vitest run src/features/workspace/WorkspaceView.test.tsx src/features/workspace/WorkspaceView.integration.test.tsx src/features/workspace/WorkspaceView.command-palette.test.tsx src/features/workspace/WorkspaceView.notifyInfo.test.tsx src/features/workspace/WorkspaceView.subscription.test.tsx src/features/workspace/WorkspaceView.verification.test.tsx src/features/workspace/WorkspaceView.visual.test.tsx 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/WorkspaceView.tsx \
  src/features/workspace/WorkspaceView.test.tsx \
  src/features/workspace/WorkspaceView.integration.test.tsx \
  src/features/workspace/WorkspaceView.command-palette.test.tsx \
  src/features/workspace/WorkspaceView.notifyInfo.test.tsx \
  src/features/workspace/WorkspaceView.subscription.test.tsx \
  src/features/workspace/WorkspaceView.verification.test.tsx \
  src/features/workspace/WorkspaceView.visual.test.tsx
git commit -m "feat(workspace): wire useElasticContainer — replace vertical useResizable, add horizontal"
```

---

## Task 6: Issue #217 — Size persistence integration test

**Files:**

- Create: `src/features/workspace/WorkspaceView.elastic.test.tsx`

- [ ] **Step 1: Write the test file**

Create `src/features/workspace/WorkspaceView.elastic.test.tsx`:

```typescript
/**
 * WorkspaceView elastic resize integration tests.
 * Uses REAL useElasticContainer (not mocked) to prove that resize state
 * lives in WorkspaceView, not inside DockPanel.
 * Stubs ResizeObserver and getBoundingClientRect so jsdom works.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceView } from './WorkspaceView'

// --- Shared mocks (same as other WorkspaceView test files) ---

vi.mock('../terminal/components/TerminalPane', () => ({
  TerminalPane: vi.fn(() => (
    <div data-testid="terminal-pane-mock">Mocked TerminalPane</div>
  )),
}))

vi.mock('../agent-status/hooks/useAgentStatus', () => ({
  useAgentStatus: vi.fn(() => ({
    isActive: false,
    agentType: null,
    modelId: null,
    modelDisplayName: null,
    version: null,
    sessionId: null,
    agentSessionId: null,
    contextWindow: null,
    cost: null,
    rateLimits: null,
    numTurns: 0,
    toolCalls: { total: 0, byType: {}, active: null },
    recentToolCalls: [],
    testRun: null,
  })),
}))

vi.mock('../terminal/services/terminalService', () => ({
  createTerminalService: vi.fn(() => ({
    spawn: vi.fn().mockResolvedValue({ sessionId: 'sess-1', pid: 1, cwd: '~' }),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onData: vi.fn((): (() => void) => (): void => {}),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onExit: vi.fn((): (() => void) => (): void => {}),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onError: vi.fn((): (() => void) => (): void => {}),
    listSessions: vi.fn().mockResolvedValue({
      activeSessionId: 'sess-1',
      sessions: [
        {
          id: 'sess-1',
          cwd: '~',
          status: {
            kind: 'Alive',
            pid: 1234,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    }),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    reorderSessions: vi.fn().mockResolvedValue(undefined),
    updateSessionCwd: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../editor/hooks/useCodeMirror', () => ({
  useCodeMirror: vi.fn(() => ({
    editorView: null,
    updateContent: vi.fn(),
  })),
}))

vi.mock('../editor/hooks/useVimMode', () => ({
  useVimMode: vi.fn(() => 'NORMAL'),
}))

vi.mock('../editor/services/languageService', () => ({
  getLanguageExtension: vi.fn(() => []),
}))

vi.mock('../diff/hooks/useGitStatus', () => ({
  useGitStatus: vi.fn(() => ({
    files: [],
    filesCwd: '.',
    loading: false,
    error: null,
    refresh: vi.fn(),
    idle: false,
  })),
}))

vi.mock('../diff/hooks/useFileDiff', () => ({
  useFileDiff: vi.fn(() => ({ diff: null, loading: false, error: null })),
}))

// --- DOM stubs for useElasticContainer ---

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
      unobserve = vi.fn()
    }
  )

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

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('WorkspaceView elastic resize — size persistence (issue #217)', () => {
  test('vertical size survives dock close and reopen', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    await waitFor(() => {
      expect(screen.getByTestId('dock-panel')).toBeInTheDocument()
    })

    // Simulate a resize: mousedown on handle, move 100px up (grows bottom dock),
    // then mouseup.
    const handle = screen.getByTestId('resize-handle')
    const initialHeight = parseInt(
      (screen.getByTestId('dock-panel') as HTMLElement).style.height,
      10
    )

    fireEvent.mouseDown(handle, { clientY: 500 })
    fireEvent.mouseMove(document, { clientY: 400 }) // +100px up = grow bottom dock
    fireEvent.mouseUp(document)

    await waitFor(() => {
      const newHeight = parseInt(
        (screen.getByTestId('dock-panel') as HTMLElement).style.height,
        10
      )
      expect(newHeight).toBeGreaterThan(initialHeight)
    })

    const heightAfterResize = parseInt(
      (screen.getByTestId('dock-panel') as HTMLElement).style.height,
      10
    )

    // Close the dock (DockPanel unmounts).
    await user.click(screen.getByRole('button', { name: /collapse panel/i }))
    expect(screen.queryByTestId('dock-panel')).not.toBeInTheDocument()

    // Reopen (DockPanel remounts from fresh).
    await user.click(screen.getByRole('button', { name: /open panel/i }))

    await waitFor(() => {
      expect(screen.getByTestId('dock-panel')).toBeInTheDocument()
    })

    // Height must match the resized value, not the default initial value.
    const heightAfterReopen = parseInt(
      (screen.getByTestId('dock-panel') as HTMLElement).style.height,
      10
    )
    expect(heightAfterReopen).toBe(heightAfterResize)
  })

  test('vertical and horizontal sizes are independent across position switches', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    await waitFor(() => {
      expect(screen.getByTestId('dock-panel')).toBeInTheDocument()
    })

    const initialVerticalHeight = parseInt(
      (screen.getByTestId('dock-panel') as HTMLElement).style.height,
      10
    )

    // Switch to right dock.
    await user.click(screen.getByRole('button', { name: /dock: right/i }))

    await waitFor(() => {
      expect(screen.getByTestId('dock-panel')).toHaveAttribute('data-position', 'right')
    })

    const initialHorizontalWidth = parseInt(
      (screen.getByTestId('dock-panel') as HTMLElement).style.width,
      10
    )

    // Switch back to bottom.
    await user.click(screen.getByRole('button', { name: /dock: bottom/i }))

    await waitFor(() => {
      expect(screen.getByTestId('dock-panel')).toHaveAttribute('data-position', 'bottom')
    })

    // Vertical size must not have been reset by the position switch.
    const heightAfterSwitch = parseInt(
      (screen.getByTestId('dock-panel') as HTMLElement).style.height,
      10
    )
    expect(heightAfterSwitch).toBe(initialVerticalHeight)

    // Switch to left dock — horizontal size should match the right-dock size
    // (same horizontal elastic instance).
    await user.click(screen.getByRole('button', { name: /dock: left/i }))

    await waitFor(() => {
      expect(screen.getByTestId('dock-panel')).toHaveAttribute('data-position', 'left')
    })

    const widthOnLeft = parseInt(
      (screen.getByTestId('dock-panel') as HTMLElement).style.width,
      10
    )
    expect(widthOnLeft).toBe(initialHorizontalWidth)
  })
})
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run src/features/workspace/WorkspaceView.elastic.test.tsx 2>&1 | tail -20
```

Expected: all PASS. If the collapse/reopen button names differ, check the actual ARIA labels with `screen.debug()` and adjust.

- [ ] **Step 3: Run full test suite**

```bash
npm run test 2>&1 | tail -30
```

Expected: all PASS.

- [ ] **Step 4: Run lint**

```bash
npm run lint 2>&1 | head -30
```

Expected: no errors. Fix any ESLint issues before committing.

- [ ] **Step 5: Commit**

```bash
git add src/features/workspace/WorkspaceView.elastic.test.tsx
git commit -m "test(workspace): prove vertical size persists across dock close/reopen (issue #217)"
```

---

## Self-Review

### Spec coverage check

| Spec requirement                                                  | Covered by                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| Horizontal resize handle on left/right docks                      | Task 4 (DockPanel), Task 5 (WorkspaceView)             |
| Drag handle on inner edge (right of left, left of right)          | Task 4 — `position === 'right' ? 'left-0' : 'right-0'` |
| Keyboard resize (ArrowLeft/Right) for horizontal                  | Task 4 — `handleHorizontalKeyDown`                     |
| Percent-based bounds (5%–80%)                                     | Task 1 (panelConfig), Task 3 (useElasticContainer)     |
| `panelConfig.ts` as single tuning surface                         | Task 1                                                 |
| `useElasticContainer` shared hook                                 | Task 3                                                 |
| `resetToSize` + `sizeRef` on `useResizable`                       | Task 2                                                 |
| Size survives dock close/reopen (issue #217)                      | Task 6                                                 |
| Re-clamp on container resize (ResizeObserver)                     | Task 3                                                 |
| Post-drag re-clamp                                                | Task 3                                                 |
| ARIA `aria-valuemin`/`aria-valuemax` from live pixel bounds       | Task 4                                                 |
| Terminal fit deferral includes horizontal drag                    | Task 5, step 3d                                        |
| All existing WorkspaceView tests still pass                       | Task 5, step 5                                         |
| `panelConfig.ts` — terminal configs defined (out of scope wiring) | Task 1                                                 |

### No placeholders found ✓

All steps include actual code, exact commands, and expected output.

### Type consistency check

- `verticalPixelMin` / `verticalPixelMax` — defined in Task 4 props, used in Task 4 handle, passed from Task 5
- `horizontalPixelMin` / `horizontalPixelMax` — same pattern
- `useElasticContainer` returns `UseElasticContainerResult extends UseResizableResult` — all fields consumed in Task 5
- `DOCK_ELASTIC_CONFIG` spread in Task 5 — matches `UseElasticContainerOptions` fields (minPercent, maxPercent, initialPercent)
- `KEYBOARD_STEP_PX` / `KEYBOARD_STEP_SHIFT_PX` — defined Task 1, imported Task 4
