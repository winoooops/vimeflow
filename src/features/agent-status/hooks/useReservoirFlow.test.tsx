import { render, screen } from '@testing-library/react'
import { useEffect, useRef, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  useReservoirFlow,
  buildReservoirSurface,
  SWELL_PRESETS,
  type ReservoirSurfaceRefs,
  type ReservoirGeom,
} from './useReservoirFlow'

const SVG_NS = 'http://www.w3.org/2000/svg'
const INACTIVE = false // jsx-boolean-value wants false props omitted; alias it

const fireEnter = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true }))
}

const fireMove = (el: Element, clientX: number): void => {
  el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX }))
}

const makeMql = (
  matches: boolean
): {
  matches: boolean
  addEventListener: () => void
  removeEventListener: () => void
} => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })

const makeRefs = (): ReservoirSurfaceRefs => ({
  fill: document.createElementNS(SVG_NS, 'path'),
  meniscus: document.createElementNS(SVG_NS, 'path'),
})

// Make the hover element report a 248-wide box so clientX maps to user units.
const mockBox = (el: Element): void => {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 248,
    height: 104,
    right: 248,
    bottom: 104,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

const yAt = (crest: string, x: number): number => {
  const m = new RegExp(`[ML] ${x}\\.0 (-?\\d+(?:\\.\\d+)?)`).exec(crest)

  return m === null ? NaN : parseFloat(m[1])
}

let now = 0
let pending: FrameRequestCallback | null = null

const frame = (dtMs = 16): void => {
  now += dtMs
  const cb = pending
  pending = null
  if (cb !== null) {
    cb(now)
  }
}

const runFrames = (n: number): void => {
  for (let i = 0; i < n; i++) {
    frame()
  }
}

let mql: ReturnType<typeof makeMql>

beforeEach(() => {
  now = 0
  pending = null
  mql = makeMql(false)
  vi.spyOn(window, 'matchMedia').mockReturnValue(
    mql as unknown as MediaQueryList
  )

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    pending = cb

    return 1
  })

  vi.stubGlobal('cancelAnimationFrame', (): void => {
    pending = null
  })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const Harness = ({
  refs,
  active = true,
}: {
  refs: ReservoirSurfaceRefs | null
  active?: boolean
}): ReactElement => {
  const hoverRef = useRef<HTMLDivElement>(null)
  const refsRef = useRef<ReservoirSurfaceRefs | null>(refs)
  const geomRef = useRef<ReservoirGeom | null>({ level: 62, height: 104 })
  useEffect(() => {
    refsRef.current = refs
  }, [refs])
  useReservoirFlow(hoverRef, refsRef, geomRef, active)

  return <div ref={hoverRef} data-testid="hover" />
}

describe('buildReservoirSurface', () => {
  test('closes the fill flat to the floor', () => {
    const { fill } = buildReservoirSurface(50, 104, 1.2, 8, 124, 30)

    expect(fill.endsWith('L 248 104 L 0 104 Z')).toBe(true)
  })

  test('raises a mound under the swell centre', () => {
    const { crest } = buildReservoirSurface(50, 104, 0, 8, 124, 30)

    // surface at the mound centre sits higher (smaller y) than far away
    expect(yAt(crest, 124)).toBeLessThan(yAt(crest, 0))
  })
})

describe('SWELL_PRESETS', () => {
  test('exposes the three selectable flavors', () => {
    expect(Object.keys(SWELL_PRESETS)).toEqual([
      'soft-mound',
      'trailing',
      'wide-lift',
    ])
  })
})

describe('useReservoirFlow', () => {
  test('drifts the surface over time', () => {
    const refs = makeRefs()
    render(<Harness refs={refs} />)

    runFrames(6)
    const first = refs.fill.getAttribute('d')
    runFrames(20)

    expect(first).not.toBeNull()
    expect(refs.fill.getAttribute('d')).not.toBe(first)
  })

  test('raises the surface under the cursor on hover', () => {
    // Baseline (no hover) and the hover run share the same mocked clock, so the
    // ambient phase is identical and only the swell differs.
    const base = makeRefs()
    const view = render(<Harness refs={base} />)
    runFrames(40)
    const baseY = yAt(base.meniscus.getAttribute('d') ?? '', 124)
    view.unmount()

    now = 0
    pending = null
    const hov = makeRefs()
    render(<Harness refs={hov} />)
    const hover = screen.getByTestId('hover')
    mockBox(hover)
    fireEnter(hover)
    fireMove(hover, 124)
    runFrames(40)

    expect(yAt(hov.meniscus.getAttribute('d') ?? '', 124)).toBeLessThan(baseY)
  })

  test('does nothing under prefers-reduced-motion', () => {
    mql.matches = true
    const refs = makeRefs()
    render(<Harness refs={refs} />)

    expect(pending).toBeNull()
    frame()
    expect(refs.fill.getAttribute('d')).toBeNull()
  })

  test('stops the loop when the tank goes inactive (context unknown)', () => {
    const { rerender } = render(<Harness refs={makeRefs()} active />)
    runFrames(5)
    expect(pending).not.toBeNull()

    rerender(<Harness refs={makeRefs()} active={INACTIVE} />)

    expect(pending).toBeNull()
  })

  test('removes its listeners on unmount', () => {
    const { unmount } = render(<Harness refs={makeRefs()} />)

    const removeSpy = vi.spyOn(
      screen.getByTestId('hover'),
      'removeEventListener'
    )

    unmount()

    const removed = removeSpy.mock.calls.map((c) => c[0])
    expect(removed).toContain('pointerenter')
    expect(removed).toContain('pointermove')
  })
})
