// cspell:ignore subcomponents
import { render, screen } from '@testing-library/react'
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import { useRef } from 'react'
import { SplitDividers } from './SplitDividers'
import { DEFAULT_RATIOS } from './resolveGrid'
import type { LayoutId } from '../../../sessions/types'

const CONTAINER_WIDTH = 1200
const CONTAINER_HEIGHT = 800

class MockResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}

vi.stubGlobal('ResizeObserver', MockResizeObserver)

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
    toJSON: (): undefined => undefined,
  } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const Harness = ({ layout }: { layout: LayoutId }): React.ReactElement => {
  const ref = useRef<HTMLDivElement>(document.createElement('div'))

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
    ['grid3x2', 5],
  ] as const)('%s renders %i handle element(s)', (layout, count) => {
    render(<Harness layout={layout} />)
    expect(screen.queryAllByTestId('split-resize-handle')).toHaveLength(count)
  })

  test('segmented column boundaries share one controller (grid3x2 mounts 3 controllers)', () => {
    // Regression for Claude HIGH / Codex P2: quad and grid3x2 used to mount a
    // separate useSplitDivider instance for each visual segment of a shared
    // column boundary. The duplicated commit effects fought each other and
    // caused an infinite update loop on drag. Grouping specs by logical
    // boundary means grid3x2 now creates exactly three controllers:
    // cols-0, cols-1, and rows-0 — even though it renders five handles.
    const onRatioChange = vi.fn()
    const observerInstances: MockResizeObserver[] = []

    class CountingResizeObserver extends MockResizeObserver {
      constructor() {
        super()
        observerInstances.push(this)
      }
    }

    vi.stubGlobal('ResizeObserver', CountingResizeObserver)

    const GridHarness = (): React.ReactElement => {
      const ref = useRef<HTMLDivElement>(document.createElement('div'))

      return (
        <div
          ref={ref}
          style={{ width: CONTAINER_WIDTH, height: CONTAINER_HEIGHT }}
        >
          <SplitDividers
            layout="grid3x2"
            containerRef={ref}
            ratios={DEFAULT_RATIOS.grid3x2}
            onRatioChange={onRatioChange}
          />
        </div>
      )
    }

    render(<GridHarness />)
    expect(observerInstances).toHaveLength(3)
    expect(onRatioChange).not.toHaveBeenCalled()

    vi.stubGlobal('ResizeObserver', MockResizeObserver)
  })

  test('vsplit handle is a vertical separator (col-resize)', () => {
    render(<Harness layout="vsplit" />)
    expect(screen.getByTestId('split-resize-handle')).toHaveAttribute(
      'aria-orientation',
      'vertical'
    )
  })

  test('parent re-render does not overwrite an in-progress drag preview', () => {
    // Regression: SplitDividers' per-layout subcomponents previously curried
    // the shared `onRatioChange(axis, ratio)` prop through inline arrows
    // (`(r) => onRatioChange('col', r)`). The inline ref changed on every
    // render, which is in the dep array of useSplitDivider's commit-size
    // effect; that effect mirrors `size / effectiveDimension` back into the
    // CSS var. In `commit-on-end` mode `size` is the LAST committed value
    // throughout the drag, so any parent re-render mid-drag (a session prop
    // tick from terminal output, an agent status heartbeat) re-fired the
    // effect and stomped the live `onDragPreview` write — visibly the
    // divider snapped back toward the pre-drag position then caught up on
    // the next mousemove RAF. Memoizing the curry with useCallback keeps
    // the dep stable so the effect stays quiet mid-drag.
    const onRatioChange = vi.fn()

    const ReRenderHarness = ({
      token,
    }: {
      token: number
    }): React.ReactElement => {
      const ref = useRef<HTMLDivElement>(document.createElement('div'))

      return (
        <div
          ref={ref}
          data-testid="container"
          data-token={token}
          style={{ width: CONTAINER_WIDTH, height: CONTAINER_HEIGHT }}
        >
          <SplitDividers
            layout="vsplit"
            containerRef={ref}
            ratios={DEFAULT_RATIOS.vsplit}
            onRatioChange={onRatioChange}
          />
        </div>
      )
    }
    const { rerender } = render(<ReRenderHarness token={1} />)
    const container = screen.getByTestId('container')

    // Mount writes the default ratio (0.5fr / 0.5fr) via the commit-size effect.
    expect(container.style.getPropertyValue('--split-cols-0')).toBe('1fr')
    expect(container.style.getPropertyValue('--split-cols-1')).toBe('1fr')

    // Simulate an in-progress drag: `onDragPreview` → `writeRatio(0.8)` has
    // written the live ratio straight into the CSS var, bypassing React state.
    container.style.setProperty('--split-cols-0', '1.6fr')
    container.style.setProperty('--split-cols-1', '0.4fr')

    // Parent re-renders (mirrors SplitView re-rendering from a session prop
    // change while the user is still dragging). `onRatioChange` identity is
    // stable across the rerender.
    rerender(<ReRenderHarness token={2} />)

    // Without the useCallback fix the inline arrow in VSplitDividers would
    // have churned the effect dep and snapped these back to 0.5fr / 0.5fr.
    expect(container.style.getPropertyValue('--split-cols-0')).toBe('1.6fr')
    expect(container.style.getPropertyValue('--split-cols-1')).toBe('0.4fr')
  })
})
