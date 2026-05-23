import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
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

  test('liquid-water-y-base wrapper translateY equals top + ambientAmp + 0.5', () => {
    const { container } = render(
      <LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />
    )

    // pct=50 → liquidH=(110-4)*0.5=53 → top=57. ambientAmp = min(1.8, 22*0.09) = 1.8.
    // baseFloor expected = 57 + 1.8 + 0.5 = 59.3
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG attributes are not reachable via a11y queries
    const wrapperEl = container.querySelector('[data-testid="liquid-water-y-base"]')
    expect(wrapperEl).not.toBeNull()
    const wrapper = wrapperEl as HTMLElement
    expect(wrapper.style.transition).toBe('transform 500ms ease')
    const match = /translateY\((.+?)px\)/.exec(wrapper.style.transform)
    const ty = parseFloat(match?.[1] ?? '0')
    expect(ty).toBeCloseTo(59.3, 1)

    // base rect itself must have y=0 (positioning is on the wrapper)
    const baseRect = screen.getByTestId('liquid-base')
    expect(baseRect.getAttribute('y')).toBe('0')
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

  test('wave path segment density scales with width so wide containers stay smooth', () => {
    const { container } = render(
      <LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG path attributes are not reachable via a11y queries
    const aPath = container.querySelector(
      '[data-testid="liquid-water-y-a"] path'
    )
    const d = aPath?.getAttribute('d') ?? ''
    // Count the L commands in the polyline — should be at least 48 plus
    // the closing path (2 more L). At width = 22 * 2 = 44, max(48, 30) = 48.
    const lineCount = (d.match(/ L /g) ?? []).length

    expect(lineCount).toBeGreaterThanOrEqual(48)
  })

  test('wave path period equals width/4 (locks cycles=4 for seamless keyframe loop)', () => {
    const { container } = render(
      <LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />
    )
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG path attributes are not reachable via a11y queries
    const a = container.querySelector('[data-testid="liquid-water-y-a"] path')
    const d = a?.getAttribute('d') ?? ''

    const points = Array.from(d.matchAll(/L (-?\d+\.\d+),(-?\d+\.\d+)/g)).map(
      (m) => [parseFloat(m[1]), parseFloat(m[2])] as [number, number]
    )
    // Path width = 22 * 2 = 44. With cycles=4 the spatial period is
    // width/4 = 11. The seamless-loop invariant is y(x) ≡ y(x + period).
    // Comparing at +width/4 = 11 fails if cycles ever regresses to 2
    // (period 22 → 11 is half a period).
    const width = 44
    const period = width / 4
    const tol = 0.01
    const samples = points.filter(([x]) => x > 0 && x < width - period - 2)
    expect(samples.length).toBeGreaterThan(0)
    let comparedAny = false
    for (const [x, y] of samples) {
      const partner = points.find(([px]) => Math.abs(px - (x + period)) < 0.5)
      if (partner !== undefined) {
        comparedAny = true
        expect(Math.abs(partner[1] - y)).toBeLessThan(tol)
      }
    }
    expect(comparedAny).toBe(true)
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

type ROCallback = (entries: { contentRect: DOMRectReadOnly }[]) => void
class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  cb: ROCallback
  constructor(cb: ROCallback) {
    this.cb = cb
    MockResizeObserver.instances.push(this)
  }
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  trigger(rect: { width: number; height: number }): void {
    this.cb([
      {
        contentRect: {
          ...rect,
          top: 0,
          left: 0,
          right: rect.width,
          bottom: rect.height,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRectReadOnly,
      },
    ])
  }
}

describe('LiquidFill — sheen cy stability', () => {
  test('cy attribute is not re-committed by React when pct changes', () => {
    const { container, rerender } = render(
      <LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />
    )
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG attributes are not reachable via a11y queries
    const sheen = container.querySelector('[data-testid="liquid-sheen"]')
    expect(sheen).not.toBeNull()
    const initialCy = sheen?.getAttribute('cy')

    // Simulate the hook taking over: write a different cy via setAttribute.
    sheen?.setAttribute('cy', '99.99')

    // Re-render with a different pct (water rose).
    rerender(<LiquidFill mode="bar" pct={80} color="#cba6f7" testId="lf" />)

    // The cy we wrote via setAttribute must NOT be overwritten by React's
    // commit. If React re-committed cy=geom.top, this would be a snapped
    // value matching the new pct's top — not 99.99.
    const cyAfterRerender = sheen?.getAttribute('cy')
    expect(cyAfterRerender).toBe('99.99')
    // The initial cy at mount must reflect the initial pct geometry.
    expect(initialCy).not.toBeNull()
    expect(parseFloat(initialCy ?? '0')).toBeGreaterThan(0)
  })
})

// Round-3 Finding 3: baseFloor is clamped to h at near-zero pct values.
describe('LiquidFill — baseFloor clamp at near-full pct (Round-3 F3)', () => {
  test('liquid-water-y-base wrapper translateY does not exceed h=110 at pct=1', () => {
    const { container } = render(
      <LiquidFill mode="bar" pct={1} color="#cba6f7" testId="lf-f3" />
    )

    // At pct=1 (w=22, h=110):
    // liquidH = (110-4)*(1/100) = 1.06; top = 108.94
    // ambientAmp = min(1.8, 22*0.09) = 1.8
    // baseFloor (unclamped) = 108.94 + 1.8 + 0.5 = 111.24 — exceeds h=110
    // After clamp: baseFloor = min(111.24, 110) = 110
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG attributes are not reachable via a11y queries
    const wrapperEl = container.querySelector('[data-testid="liquid-water-y-base"]')
    expect(wrapperEl).not.toBeNull()
    const wrapper = wrapperEl as HTMLElement
    const match = /translateY\((.+?)px\)/.exec(wrapper.style.transform)
    const ty = parseFloat(match?.[1] ?? '0')
    expect(ty).toBeLessThanOrEqual(110)
  })
})

// Round-3 Finding 4: settled check includes velWaterTop velocity threshold.
// The fix is a one-liner with low direct test-surface value in jsdom (rAF
// timing is not faithful enough to reliably observe mid-flight velocity).
// TODO: add a browser-environment (Playwright/Cypress) integration test that
// fires rapid pct changes and asserts the sheen cy doesn't snap mid-transition.

describe('LiquidFill — fill mode', () => {
  beforeEach(() => {
    MockResizeObserver.instances = []
    const g = globalThis as unknown as { ResizeObserver: typeof ResizeObserver }

    g.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
  })

  test('renders SVG with measured width/height attributes after ResizeObserver fires', () => {
    const { container } = render(
      <LiquidFill
        mode="fill"
        pct={50}
        color="#cba6f7"
        testId="lf-fill"
        className="h-full w-full"
      />
    )
    act(() => {
      MockResizeObserver.instances[0]?.trigger({ width: 200, height: 72 })
    })
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG attributes are not reachable via a11y queries
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 200 72')
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('none')
    // Spec §5: mode="fill" sets the SVG width/height attributes from the
    // ResizeObserver measurement (not a percentage placeholder).
    expect(svg?.getAttribute('width')).toBe('200')
    expect(svg?.getAttribute('height')).toBe('72')
  })

  test('outer div carries the caller className', () => {
    render(
      <LiquidFill
        mode="fill"
        pct={50}
        color="#cba6f7"
        testId="lf-fill"
        className="h-full w-full"
      />
    )
    expect(screen.getByTestId('lf-fill').className).toContain('h-full')
    expect(screen.getByTestId('lf-fill').className).toContain('w-full')
  })

  // Round-4 F3: hide SVG before first ResizeObserver callback
  test('SVG is visibility:hidden before ResizeObserver fires and clears after', () => {
    const { container } = render(
      <LiquidFill
        mode="fill"
        pct={50}
        color="#cba6f7"
        testId="lf-fill-vis"
        className="h-full w-full"
      />
    )
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG attributes are not reachable via a11y queries
    const svg = container.querySelector('svg') as SVGElement
    expect(svg.style.visibility).toBe('hidden')

    act(() => {
      MockResizeObserver.instances[0]?.trigger({ width: 200, height: 72 })
    })
    expect(svg.style.visibility).toBe('')
  })
})

// Round-4 F2: glow prop applies drop-shadow filter to SVG
describe('LiquidFill — glow prop', () => {
  test('SVG has drop-shadow filter when glow=true', () => {
    const { container } = render(
      <LiquidFill mode="bar" pct={50} color="#cba6f7" glow testId="lf-glow" />
    )
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG attributes are not reachable via a11y queries
    const svg = container.querySelector('svg') as SVGElement
    expect(svg.style.filter).toMatch(/drop-shadow\(.*#cba6f7/)
  })

  test('SVG has no filter when glow is omitted', () => {
    const { container } = render(
      <LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf-no-glow" />
    )
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG attributes are not reachable via a11y queries
    const svg = container.querySelector('svg') as SVGElement
    expect(svg.style.filter).toBe('')
  })
})
