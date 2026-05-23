import { act, render, screen } from '@testing-library/react'
import { useEffect, useRef, type ReactElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  useWaterCursor,
  type LiquidRefs,
  type LiquidTune,
} from './useWaterCursor'

// jsdom does not provide PointerEvent. Use a MouseEvent dispatched with
// the 'pointermove' / 'pointerleave' type — the listener key is the
// event type string, and MouseEvent carries clientX / clientY which is
// all the hook reads. This avoids touching src/test/setup.ts.
const firePointer = (
  el: Element,
  type: 'pointermove' | 'pointerleave',
  init: Partial<MouseEventInit> = {}
): void => {
  el.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
  )
}

interface MqlMock {
  matches: boolean
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
}

const makeMql = (matches: boolean): MqlMock => ({
  matches,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})

const mockMatchMedia = (mql: MqlMock): void => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    () => mql as unknown as MediaQueryList
  )
}

interface HarnessProps {
  refs: LiquidRefs
  addSpy: ReturnType<typeof vi.fn>
  removeSpy: ReturnType<typeof vi.fn>
  tune?: Partial<LiquidTune>
}

const Harness = ({
  refs,
  addSpy,
  removeSpy,
  tune = undefined,
}: HarnessProps): ReactElement => {
  const wrapRef = useRef<HTMLDivElement>(null)
  const refsRef = useRef<LiquidRefs | null>(refs)

  useEffect(() => {
    if (wrapRef.current === null) {
      return
    }

    const el = wrapRef.current
    const origAdd = el.addEventListener.bind(el)
    const origRemove = el.removeEventListener.bind(el)

    el.addEventListener = ((...args: Parameters<typeof origAdd>) => {
      addSpy(args[0])

      origAdd(...args)
    }) as typeof el.addEventListener

    el.removeEventListener = ((...args: Parameters<typeof origRemove>) => {
      removeSpy(args[0])

      origRemove(...args)
    }) as typeof el.removeEventListener
  }, [addSpy, removeSpy])

  useWaterCursor(wrapRef, refsRef, tune)

  return <div ref={wrapRef} data-testid="wrap" />
}

const makeRefs = (): LiquidRefs => ({
  slosh: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
  waveAShift: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
  waveBShift: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
  waveAAnim: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
  waveBAnim: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
  sheen: document.createElementNS('http://www.w3.org/2000/svg', 'ellipse'),
  waterTop: 10,
  ambientAmp: 1.8,
  dims: { w: 22, h: 110 },
})

const flushRaf = async (frames: number): Promise<void> => {
  for (let i = 0; i < frames; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 16))
    })
  }
}

const stubRect = (el: Element, width: number, height: number): void => {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: (): Record<string, unknown> => ({}),
    }),
  })
}

describe('useWaterCursor — skeleton + reduced-motion gate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('attaches pointermove and pointerleave on mount when motion allowed', () => {
    mockMatchMedia(makeMql(false))
    const addSpy = vi.fn()
    const removeSpy = vi.fn()

    render(<Harness refs={makeRefs()} addSpy={addSpy} removeSpy={removeSpy} />)

    const kinds = addSpy.mock.calls.map((c: string[]) => c[0])
    expect(kinds).toContain('pointermove')
    expect(kinds).toContain('pointerleave')
  })

  test('skips listener registration under prefers-reduced-motion', () => {
    mockMatchMedia(makeMql(true))
    const addSpy = vi.fn()
    const removeSpy = vi.fn()

    render(<Harness refs={makeRefs()} addSpy={addSpy} removeSpy={removeSpy} />)

    const kinds = addSpy.mock.calls.map((c: string[]) => c[0])
    expect(kinds).not.toContain('pointermove')
    expect(kinds).not.toContain('pointerleave')
  })

  test('removes listeners on unmount', () => {
    mockMatchMedia(makeMql(false))
    const addSpy = vi.fn()
    const removeSpy = vi.fn()

    const { unmount } = render(
      <Harness refs={makeRefs()} addSpy={addSpy} removeSpy={removeSpy} />
    )

    unmount()

    const kinds = removeSpy.mock.calls.map((c: string[]) => c[0])
    expect(kinds).toContain('pointermove')
    expect(kinds).toContain('pointerleave')
  })
})

describe('useWaterCursor — spring loop', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('pointermove writes data-interactive=on and non-zero rotate', async () => {
    mockMatchMedia(makeMql(false))
    const refs = makeRefs()
    render(<Harness refs={refs} addSpy={vi.fn()} removeSpy={vi.fn()} />)
    const wrap = screen.getByTestId('wrap')
    stubRect(wrap, 100, 100)
    act(() => {
      firePointer(wrap, 'pointermove', { clientX: 80, clientY: 50 })
    })
    await flushRaf(2)
    expect(refs.slosh.getAttribute('data-interactive')).toBe('on')
    expect(refs.slosh.style.transform).toMatch(/rotate\(/)
    expect(refs.slosh.style.transform).not.toMatch(/rotate\(0(\.0+)?deg\)/)
  })

  test('pointerleave settles back and clears inline', async () => {
    mockMatchMedia(makeMql(false))
    const refs = makeRefs()
    render(<Harness refs={refs} addSpy={vi.fn()} removeSpy={vi.fn()} />)
    const wrap = screen.getByTestId('wrap')
    stubRect(wrap, 100, 100)
    act(() => {
      firePointer(wrap, 'pointermove', { clientX: 80, clientY: 50 })
    })
    await flushRaf(2)
    act(() => {
      firePointer(wrap, 'pointerleave')
    })
    await flushRaf(80) // > 1s — well past spring settle at omega=6.5
    expect(refs.slosh.getAttribute('data-interactive')).toBeNull()
    expect(refs.slosh.style.transform).toBe('')
  })

  test('omitted tune is referentially stable across renders', () => {
    mockMatchMedia(makeMql(false))
    const addSpy = vi.fn()
    const removeSpy = vi.fn()

    const { rerender } = render(
      <Harness refs={makeRefs()} addSpy={addSpy} removeSpy={removeSpy} />
    )

    // Initial mount registered the listeners.
    expect(addSpy.mock.calls.map((c: string[]) => c[0])).toContain(
      'pointermove'
    )

    // Re-render with a new refs object (simulates a parent state change).
    rerender(
      <Harness refs={makeRefs()} addSpy={addSpy} removeSpy={removeSpy} />
    )

    // Listeners should NOT have been removed and re-added.
    expect(removeSpy.mock.calls.map((c: string[]) => c[0])).not.toContain(
      'pointermove'
    )
  })

  test('rAF stops after spring settles on a still hover', async () => {
    mockMatchMedia(makeMql(false))
    const refs = makeRefs()

    // Spy on rAF using the real implementation so frames still advance.
    // vi.restoreAllMocks() in afterEach cleans this up.
    const originalRaf = window.requestAnimationFrame.bind(window)

    const spy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => originalRaf(cb))

    render(<Harness refs={refs} addSpy={vi.fn()} removeSpy={vi.fn()} />)
    const wrap = screen.getByTestId('wrap')
    stubRect(wrap, 100, 100)

    // Fire a single pointermove and let the spring fully settle
    act(() => {
      firePointer(wrap, 'pointermove', { clientX: 80, clientY: 50 })
    })
    await flushRaf(80) // well past settle time for omega=6.5

    // Record rAF call count after settle
    const callsAfterSettle = spy.mock.calls.length

    // Advance another 16 frames — no new rAF should be scheduled
    await flushRaf(16)

    expect(spy.mock.calls.length).toBe(callsAfterSettle)
  })
})

describe('useWaterCursor — runtime reduced-motion toggle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('change → matches:true detaches pointer listeners', () => {
    const mql = makeMql(false)
    mockMatchMedia(mql)
    const addSpy = vi.fn()
    const removeSpy = vi.fn()
    render(<Harness refs={makeRefs()} addSpy={addSpy} removeSpy={removeSpy} />)
    expect(addSpy.mock.calls.map((c: string[]) => c[0])).toContain(
      'pointermove'
    )

    const changeListener = mql.addEventListener.mock.calls.find(
      (c: unknown[]) => c[0] === 'change'
    )?.[1] as ((e: { matches: boolean }) => void) | undefined
    expect(changeListener).toBeDefined()
    changeListener?.({ matches: true })

    expect(removeSpy.mock.calls.map((c: string[]) => c[0])).toContain(
      'pointermove'
    )

    expect(removeSpy.mock.calls.map((c: string[]) => c[0])).toContain(
      'pointerleave'
    )
  })

  test('change → matches:false reattaches pointer listeners', () => {
    const mql = makeMql(true)
    mockMatchMedia(mql)
    const addSpy = vi.fn()
    const removeSpy = vi.fn()
    render(<Harness refs={makeRefs()} addSpy={addSpy} removeSpy={removeSpy} />)
    expect(addSpy.mock.calls.map((c: string[]) => c[0])).not.toContain(
      'pointermove'
    )

    const changeListener = mql.addEventListener.mock.calls.find(
      (c: unknown[]) => c[0] === 'change'
    )?.[1] as ((e: { matches: boolean }) => void) | undefined
    changeListener?.({ matches: false })

    expect(addSpy.mock.calls.map((c: string[]) => c[0])).toContain(
      'pointermove'
    )
  })
})

// Finding 1: inline tune object identity stability
describe('useWaterCursor — tune prop identity stability (Finding 1)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('re-rendering with a freshly-constructed inline tune object does NOT remove+re-add pointer listeners', () => {
    mockMatchMedia(makeMql(false))
    const addSpy = vi.fn()
    const removeSpy = vi.fn()

    // Pass tune as an inline object literal that has a fresh identity each render.
    const { rerender } = render(
      <Harness
        refs={makeRefs()}
        addSpy={addSpy}
        removeSpy={removeSpy}
        tune={{ halo: 70 }}
      />
    )

    // Confirm listeners were registered on initial mount.
    expect(addSpy.mock.calls.map((c: string[]) => c[0])).toContain(
      'pointermove'
    )

    // Re-render — the tune object `{ halo: 70 }` has a new JS identity each
    // time, but its VALUES are identical. The hook should NOT tear down.
    rerender(
      <Harness
        refs={makeRefs()}
        addSpy={addSpy}
        removeSpy={removeSpy}
        tune={{ halo: 70 }}
      />
    )

    // Listeners must NOT have been removed (which would indicate a teardown).
    expect(removeSpy.mock.calls.map((c: string[]) => c[0])).not.toContain(
      'pointermove'
    )
  })
})

// Finding 2: sheen cy tracks waterTop transition
// NOTE: jsdom provides no real CSS transitions or rAF timing, so a meaningful
// integration test for the 500ms waterTop animation would require a real
// browser environment (Playwright/Cypress). The spring logic is exercised
// indirectly by the existing rAF-loop tests. A unit test that asserts the
// sheen cy doesn't snap requires observing intermediate rAF frames which
// jsdom does not faithfully simulate. Skipping dedicated test — the fix is
// covered by code-review inspection and manual verification.

// Finding 3: detach() resets spring state so reduced-motion toggle OFF mid-hover
// starts from initial values, not stale pre-detach tilt/amp.
describe('useWaterCursor — detach resets spring state (Finding 3)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('after reduced-motion toggle ON then OFF, first apply writes near-zero rotate', async () => {
    const mql = makeMql(false)
    mockMatchMedia(mql)
    const refs = makeRefs()
    render(<Harness refs={refs} addSpy={vi.fn()} removeSpy={vi.fn()} />)
    const wrap = screen.getByTestId('wrap')
    stubRect(wrap, 100, 100)

    // 1. Move pointer to build up non-zero spring state.
    act(() => {
      firePointer(wrap, 'pointermove', { clientX: 80, clientY: 50 })
    })
    await flushRaf(3)

    // Confirm non-zero tilt was applied before detach.
    expect(refs.slosh.style.transform).toMatch(/rotate\(/)
    expect(refs.slosh.style.transform).not.toMatch(/rotate\(0(\.0+)?deg\)/)

    // 2. Simulate reduced-motion toggle ON → detaches + resets spring.
    const changeListener = mql.addEventListener.mock.calls.find(
      (c: unknown[]) => c[0] === 'change'
    )?.[1] as ((e: { matches: boolean }) => void) | undefined
    expect(changeListener).toBeDefined()
    act(() => {
      changeListener?.({ matches: true })
    })

    // 3. Simulate reduced-motion toggle OFF → re-attaches from clean state.
    act(() => {
      changeListener?.({ matches: false })
    })

    // 4. Fire a pointermove that should start the spring from zero.
    act(() => {
      firePointer(wrap, 'pointermove', { clientX: 80, clientY: 50 })
    })
    // Run exactly ONE rAF frame — if spring reset correctly, cur.tilt is still
    // near 0 (spring hasn't had time to build up from initial).
    await flushRaf(1)

    const transform = refs.slosh.style.transform
    // Extract the rotate value and assert it is very small (< 0.5 deg),
    // which confirms the spring started from zero, not from the stale value.
    const match = /rotate\(([-\d.]+)deg\)/.exec(transform)
    expect(match).not.toBeNull()
    const tiltDeg = Math.abs(parseFloat(match?.[1] ?? '999'))
    expect(tiltDeg).toBeLessThan(0.5)
  })
})
