import { render, screen } from '@testing-library/react'
import { useEffect, useRef, type ReactElement } from 'react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type Mock,
} from 'vitest'
import { useReservoirFlow, type ReservoirFlowRefs } from './useReservoirFlow'

// jsdom lacks PointerEvent; dispatch a typed MouseEvent — the hook only keys
// off the event type.
const fire = (el: Element, type: 'pointerenter' | 'pointerleave'): void => {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true }))
}

interface MockMql {
  matches: boolean
  addEventListener: Mock<(type: string, cb: EventListener) => void>
  removeEventListener: Mock<(type: string, cb: EventListener) => void>
  fire: () => void
}

const makeMql = (matches: boolean): MockMql => {
  const listeners: EventListener[] = []

  return {
    matches,
    addEventListener: vi.fn((_: string, cb: EventListener) => {
      listeners.push(cb)
    }),
    removeEventListener: vi.fn(),
    fire: (): void => {
      listeners.forEach((cb) => {
        cb(new Event('change'))
      })
    },
  }
}

const makeRefs = (): ReservoirFlowRefs => ({
  front: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
  back: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
})

const txOffset = (el: SVGGElement): number => {
  const m = /translate\((-?\d+(?:\.\d+)?) 0\)/.exec(
    el.getAttribute('transform') ?? ''
  )

  return m === null ? 0 : parseFloat(m[1])
}

// Manual rAF clock so frames step deterministically.
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
}: {
  refs: ReservoirFlowRefs | null
}): ReactElement => {
  const hoverRef = useRef<HTMLDivElement>(null)
  const refsRef = useRef<ReservoirFlowRefs | null>(refs)
  // Keep current in sync so a rerender can drop the refs to null mid-hover
  // (the tank emptying while the pointer is still over it).
  useEffect(() => {
    refsRef.current = refs
  }, [refs])
  useReservoirFlow(hoverRef, refsRef)

  return <div ref={hoverRef} data-testid="hover" />
}

describe('useReservoirFlow', () => {
  test('eases an extra leftward drift in while the pointer is over the tank', () => {
    const refs = makeRefs()
    render(<Harness refs={refs} />)

    fire(screen.getByTestId('hover'), 'pointerenter')
    for (let i = 0; i < 20; i++) {
      frame()
    }
    const after20 = txOffset(refs.front)
    expect(after20).toBeLessThan(0)

    for (let i = 0; i < 10; i++) {
      frame()
    }
    expect(txOffset(refs.front)).toBeLessThan(after20)
  })

  test('eases back to rest and stops the loop after the pointer leaves', () => {
    const refs = makeRefs()
    render(<Harness refs={refs} />)

    fire(screen.getByTestId('hover'), 'pointerenter')
    for (let i = 0; i < 10; i++) {
      frame()
    }
    fire(screen.getByTestId('hover'), 'pointerleave')
    for (let i = 0; i < 200; i++) {
      frame()
    }

    expect(pending).toBeNull()
    const frozen = refs.front.getAttribute('transform')
    frame()
    expect(refs.front.getAttribute('transform')).toBe(frozen)
  })

  test('does nothing under prefers-reduced-motion', () => {
    mql.matches = true
    const refs = makeRefs()
    render(<Harness refs={refs} />)

    fire(screen.getByTestId('hover'), 'pointerenter')

    expect(pending).toBeNull()
    frame()
    expect(refs.front.getAttribute('transform')).toBeNull()
    expect(refs.back.getAttribute('transform')).toBeNull()
  })

  test('stops the loop when the water refs disappear mid-hover', () => {
    const { rerender } = render(<Harness refs={makeRefs()} />)

    fire(screen.getByTestId('hover'), 'pointerenter')
    for (let i = 0; i < 5; i++) {
      frame()
    }
    expect(pending).not.toBeNull()

    rerender(<Harness refs={null} />)
    frame()

    expect(pending).toBeNull()
  })

  test('stops the loop and clears transforms when reduced-motion is enabled mid-hover', () => {
    const refs = makeRefs()
    render(<Harness refs={refs} />)

    fire(screen.getByTestId('hover'), 'pointerenter')
    for (let i = 0; i < 10; i++) {
      frame()
    }
    expect(pending).not.toBeNull()
    expect(refs.front.getAttribute('transform')).not.toBeNull()

    mql.matches = true
    mql.fire()

    expect(pending).toBeNull()
    expect(refs.front.getAttribute('transform')).toBeNull()
    expect(refs.back.getAttribute('transform')).toBeNull()
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
    expect(removed).toContain('pointerleave')
    expect(mql.removeEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    )
  })
})
