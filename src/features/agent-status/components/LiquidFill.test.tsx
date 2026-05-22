import { act, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { LiquidFill } from './LiquidFill'

// jsdom does not provide PointerEvent — see useWaterCursor.test.tsx
// for the same shim.
const firePointer = (
  el: Element,
  type: 'pointermove' | 'pointerleave',
  init: Partial<MouseEventInit> = {}
): void => {
  el.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
  )
}

describe('LiquidFill — bar mode geometry', () => {
  test('renders SVG with viewBox "0 0 22 110"', () => {
    const { container } = render(
      <LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />
    )
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG attributes are not reachable via a11y queries
    const svg = container.querySelector('svg')

    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 22 110')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  test('base rect y equals top + ambientAmp + 0.5', () => {
    render(<LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />)

    // pct=50 → liquidH=(110-4)*0.5=53 → top=57. ambientAmp = min(1.8, 22*0.09) = 1.8.
    // base.y expected = 57 + 1.8 + 0.5 = 59.3
    const baseRect = screen.getByTestId('liquid-base')

    expect(parseFloat(baseRect.getAttribute('y') ?? '0')).toBeCloseTo(59.3, 1)
  })

  test('renders tick marks at 25/50/75', () => {
    render(<LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />)

    expect(screen.getByTestId('liquid-tick-25')).toBeInTheDocument()
    expect(screen.getByTestId('liquid-tick-50')).toBeInTheDocument()
    expect(screen.getByTestId('liquid-tick-75')).toBeInTheDocument()
  })

  test('renders two phase-offset wave paths in nested transform groups', () => {
    render(<LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />)

    const selA = '[data-testid="liquid-wave-shift-a"] path'
    const selB = '[data-testid="liquid-wave-shift-b"] path'

    const waveYA = screen.getByTestId('liquid-water-y-a')
    // eslint-disable-next-line testing-library/no-node-access -- verifying nested SVG structure
    const shiftA = waveYA.querySelector(selA)

    const waveYB = screen.getByTestId('liquid-water-y-b')
    // eslint-disable-next-line testing-library/no-node-access -- verifying nested SVG structure
    const shiftB = waveYB.querySelector(selB)

    expect(shiftA).not.toBeNull()
    expect(shiftB).not.toBeNull()
  })

  test('outer div carries the caller testId and className', () => {
    render(
      <LiquidFill
        mode="bar"
        pct={50}
        color="#cba6f7"
        testId="lf"
        className="some-class"
      />
    )
    const wrap = screen.getByTestId('lf')

    expect(wrap).toBeInTheDocument()
    expect(wrap.className).toContain('some-class')
  })

  test('wave-A and wave-B paths are actually phase-offset (different d strings)', () => {
    const { container } = render(
      <LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG path attributes are not reachable via a11y queries
    const a = container.querySelector('[data-testid="liquid-water-y-a"] path')

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG path attributes are not reachable via a11y queries
    const b = container.querySelector('[data-testid="liquid-water-y-b"] path')
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    // Different phase => different path data. Strip leading "M 0,..." since
    // both share x=0; compare the bulk of the path.
    const ad = (a?.getAttribute('d') ?? '').slice(20)
    const bd = (b?.getAttribute('d') ?? '').slice(20)
    expect(ad).not.toBe(bd)
    // Both paths must reach the bottom and close — defensive sanity.
    expect(ad).toMatch(/L \d/)
    expect(bd).toMatch(/L \d/)
  })
})

describe('LiquidFill — cursor hook integration', () => {
  test('pointermove on outer wrap sets data-interactive on slosh', async () => {
    render(<LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />)
    const wrap = screen.getByTestId('lf')
    Object.defineProperty(wrap, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        right: 22,
        bottom: 110,
        width: 22,
        height: 110,
        x: 0,
        y: 0,
        toJSON: (): Record<string, never> => ({}),
      }),
    })

    await act(async () => {
      firePointer(wrap, 'pointermove', { clientX: 11, clientY: 55 })
      await new Promise((resolve) => setTimeout(resolve, 32))
    })
    const slosh = screen.getByTestId('liquid-slosh')
    expect(slosh.getAttribute('data-interactive')).toBe('on')
  })
})
