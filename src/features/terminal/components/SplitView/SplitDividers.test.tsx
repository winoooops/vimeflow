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
