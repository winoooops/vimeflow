import { act, render, screen } from '@testing-library/react'
import { useEffect, useRef, type ReactElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useWaterCursor, type LiquidRefs } from './useWaterCursor'

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
}

const Harness = ({ refs, addSpy, removeSpy }: HarnessProps): ReactElement => {
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

  useWaterCursor(wrapRef, refsRef)

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
})
