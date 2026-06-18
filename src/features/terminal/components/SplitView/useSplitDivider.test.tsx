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
  onRatioChange: (ratios: readonly number[]) => void
}): React.ReactElement => {
  const divider = useSplitDivider({
    containerRef,
    axis: 'horizontal',
    trackAxis: 'cols',
    trackIndex: 0,
    initialRatios: [1, 1],
    onRatioChange,
  })

  return <div data-testid="handle" tabIndex={0} onKeyDown={divider.onKeyDown} />
}

const Harness = ({
  active = false,
  onRatioChange,
}: {
  active?: boolean
  onRatioChange: (ratios: readonly number[]) => void
}): React.ReactElement => {
  const ref = useRef<HTMLDivElement>(document.createElement('div'))

  return (
    <div ref={ref} data-testid="container" style={{ width: 1200, height: 800 }}>
      {active ? (
        <DividerChild containerRef={ref} onRatioChange={onRatioChange} />
      ) : null}
    </div>
  )
}

describe('useSplitDivider', () => {
  test('keyboard resize mirrors updated track weights up and writes both fr vars', () => {
    const onRatioChange = vi.fn()
    render(<Harness active onRatioChange={onRatioChange} />)
    fireEvent.keyDown(screen.getByTestId('handle'), { key: 'ArrowRight' })
    const calls = onRatioChange.mock.calls
    const ratios = calls[calls.length - 1]?.[0] as readonly number[]
    expect(ratios[0]).toBeGreaterThan(ratios[1])
    const container = screen.getByTestId('container')
    expect(container.style.getPropertyValue('--split-cols-0')).toMatch(/fr$/)
    expect(container.style.getPropertyValue('--split-cols-1')).toMatch(/fr$/)
  })

  test('removes the CSS var on unmount (container stays mounted)', () => {
    const { rerender } = render(<Harness active onRatioChange={vi.fn()} />)
    const container = screen.getByTestId('container')
    expect(container.style.getPropertyValue('--split-cols-0')).toMatch(/fr$/)
    rerender(<Harness onRatioChange={vi.fn()} />)
    expect(container.style.getPropertyValue('--split-cols-0')).toBe('')
  })
})
