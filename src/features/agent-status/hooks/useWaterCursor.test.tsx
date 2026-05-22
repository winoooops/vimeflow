// @ts-expect-error — act is unused here; Task 3 appends tests that call it
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { act, render } from '@testing-library/react'
import { useEffect, useRef, type ReactElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useWaterCursor, type LiquidRefs } from './useWaterCursor'

// jsdom does not provide PointerEvent. Use a MouseEvent dispatched with
// the 'pointermove' / 'pointerleave' type — the listener key is the
// event type string, and MouseEvent carries clientX / clientY which is
// all the hook reads. This avoids touching src/test/setup.ts.
// @ts-expect-error — firePointer is unused here; Task 3 appends tests that call it
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
