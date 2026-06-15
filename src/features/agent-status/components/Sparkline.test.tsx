import { afterEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Sparkline, nearestSparkIndex } from './Sparkline'

describe('nearestSparkIndex', () => {
  test('maps offset 0 to the first index', () => {
    expect(nearestSparkIndex(0, 100, 4)).toBe(0)
  })

  test('maps full width to the last index', () => {
    expect(nearestSparkIndex(100, 100, 4)).toBe(3)
  })

  test('rounds to the nearest reading', () => {
    expect(nearestSparkIndex(50, 100, 5)).toBe(2)
  })

  test('clamps out-of-range offsets', () => {
    expect(nearestSparkIndex(-20, 100, 4)).toBe(0)
    expect(nearestSparkIndex(200, 100, 4)).toBe(3)
  })

  test('returns 0 for degenerate inputs', () => {
    expect(nearestSparkIndex(40, 0, 4)).toBe(0)
    expect(nearestSparkIndex(40, 100, 1)).toBe(0)
  })
})

describe('Sparkline', () => {
  afterEach(() => vi.restoreAllMocks())

  test('renders "no data yet" when empty', () => {
    render(<Sparkline data={[]} color="var(--color-success-muted)" />)
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  test('renders an svg with a line path when given data', () => {
    render(
      <Sparkline data={[42, 51, 49, 75]} color="var(--color-success-muted)" />
    )
    const svg = screen.getByTestId('token-cache-sparkline')
    // eslint-disable-next-line testing-library/no-node-access
    expect(svg.querySelectorAll('path')).toHaveLength(2)
  })

  test('strokes with the provided tone color', () => {
    render(<Sparkline data={[10, 90]} color="var(--color-tertiary)" />)
    const svg = screen.getByTestId('token-cache-sparkline')
    // eslint-disable-next-line testing-library/no-node-access
    const line = svg.querySelectorAll('path')[1]
    expect(line.getAttribute('stroke')).toBe('var(--color-tertiary)')
  })

  test('surfaces the hovered reading and clears it on leave', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 100,
      bottom: 36,
      width: 100,
      height: 36,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    render(
      <Sparkline data={[42, 51, 49, 75]} color="var(--color-success-muted)" />
    )
    const svg = screen.getByTestId('token-cache-sparkline')

    expect(screen.queryByTestId('token-cache-sparkline-value')).toBeNull()

    fireEvent.mouseMove(svg, { clientX: 100 })
    expect(screen.getByTestId('token-cache-sparkline-value')).toHaveTextContent(
      '75%'
    )

    fireEvent.mouseMove(svg, { clientX: 0 })
    expect(screen.getByTestId('token-cache-sparkline-value')).toHaveTextContent(
      '42%'
    )

    fireEvent.mouseLeave(svg)
    expect(screen.queryByTestId('token-cache-sparkline-value')).toBeNull()
  })
})
