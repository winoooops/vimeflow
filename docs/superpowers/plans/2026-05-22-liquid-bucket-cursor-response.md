# Liquid Bucket Cursor Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a cursor-responsive water effect on the agent-status feature's bucket fills (rail CTX/CACHE and expanded-panel CURRENT CONTEXT) via a shared `LiquidFill` SVG primitive + `useWaterCursor` hook, with structural reset, locked tuning defaults, and no global listeners.

**Architecture:** New `useWaterCursor` hook in `src/features/agent-status/hooks/` drives a critically-damped spring on 8 scalar signals and writes inline `transform` attributes directly to SVG refs on rAF. New `LiquidFill` component in `src/features/agent-status/components/` renders the SVG (glass cell, base rect below the wave trough, two phase-offset wave paths, sheen ellipse), nests pct-driven `translateY` groups around cursor-driven `scaleY/translateX/skewX` groups so the two concerns don't fight, and supports `mode="bar"` (fixed 22×110, used by `Bucket`) + `mode="fill"` (ResizeObserver-measured, used by `ContextBucket`). The existing `Bucket.tsx` SVG body is replaced by `<LiquidFill mode="bar" />`; `ContextBucket.tsx`'s flat-gradient fill div is replaced by `<LiquidFill mode="fill" className="h-full w-full" />` with a local `hexForColorClass` helper returning Tailwind hex literals. CSS keyframes rename `vf-bucket-*` → `vf-liquid-*`.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind v3 (frontend), Vitest + Testing Library + jsdom (tests). No backend changes.

**Spec:** [docs/superpowers/specs/2026-05-22-liquid-bucket-cursor-response-design.md](../specs/2026-05-22-liquid-bucket-cursor-response-design.md)

---

## Task 1: Rename `vf-bucket-*` CSS → `vf-liquid-*` (no behavior change)

The keyframes and class names move out of bucket-specific territory because `LiquidFill` will be used by `ContextBucket` too. Behavior is unchanged at this step — only names rotate, plus the new `[data-interactive="on"]` selector that the hook needs.

**Files:**

- Modify: `src/index.css:187-215`
- Modify: `src/features/agent-status/components/Bucket.tsx:176` (`className="vf-bucket-slosh"`)
- Modify: `src/features/agent-status/components/Bucket.tsx:188` (`className="vf-bucket-wave-a"`)
- Modify: `src/features/agent-status/components/Bucket.tsx:193` (`className="vf-bucket-wave-b"`)

- [ ] **Step 1: Rename keyframes + classes in `src/index.css`**

Replace lines 187-215 of `src/index.css` with:

```css
@keyframes vfLiquidSlosh {
  0%,
  100% {
    transform: translateX(0) rotate(0deg);
  }
  50% {
    transform: translateX(0.4px) rotate(0.6deg);
  }
}

@keyframes vfLiquidWaveA {
  from {
    transform: translateX(-50%);
  }
  to {
    transform: translateX(0);
  }
}

@keyframes vfLiquidWaveB {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

.vf-liquid-wave-a {
  animation: vfLiquidWaveA var(--vf-liquid-wave-a-dur, 3.4s) linear infinite;
}

.vf-liquid-wave-b {
  animation: vfLiquidWaveB var(--vf-liquid-wave-b-dur, 4.8s) linear infinite;
}

.vf-liquid-slosh {
  animation: vfLiquidSlosh 2.6s ease-in-out infinite;
}

.vf-liquid-slosh[data-interactive='on'] {
  animation: none;
}

@media (prefers-reduced-motion: reduce) {
  .vf-liquid-wave-a,
  .vf-liquid-wave-b,
  .vf-liquid-slosh {
    animation: none;
  }
}
```

- [ ] **Step 2: Rename the three class refs in `Bucket.tsx`**

In `src/features/agent-status/components/Bucket.tsx`, change:

- `className="vf-bucket-slosh"` → `className="vf-liquid-slosh"` (line 176)
- `<g className="vf-bucket-wave-a">` → `<g className="vf-liquid-wave-a">` (line 188)
- `<g className="vf-bucket-wave-b">` → `<g className="vf-liquid-wave-b">` (line 193)

- [ ] **Step 3: Run existing Bucket tests to verify no regression**

Run: `npx vitest run src/features/agent-status/components/Bucket.test.tsx`
Expected: PASS — the test file does not assert on class names, only on `data-testid` attributes, so the rename is invisible to it.

- [ ] **Step 4: Run lint + type-check**

Run: `npm run lint && npm run type-check`
Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/features/agent-status/components/Bucket.tsx
git commit -m "refactor(agent-status): rename vf-bucket-* CSS to vf-liquid-*"
```

---

## Task 2: Create `useWaterCursor` hook skeleton + reduced-motion gate

Failing test first. The skeleton attaches `pointermove` / `pointerleave` to `wrapRef.current` on mount, removes them on unmount, and is a no-op when `prefers-reduced-motion: reduce` matches.

**Files:**

- Create: `src/features/agent-status/hooks/useWaterCursor.ts`
- Create: `src/features/agent-status/hooks/useWaterCursor.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/features/agent-status/hooks/useWaterCursor.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { useEffect, useRef, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { useWaterCursor, type LiquidRefs } from './useWaterCursor'

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
    if (wrapRef.current === null) return
    const el = wrapRef.current
    const origAdd = el.addEventListener.bind(el)
    const origRemove = el.removeEventListener.bind(el)
    el.addEventListener = ((...args: Parameters<typeof origAdd>) => {
      addSpy(args[0])
      return origAdd(...args)
    }) as typeof el.addEventListener
    el.removeEventListener = ((...args: Parameters<typeof origRemove>) => {
      removeSpy(args[0])
      return origRemove(...args)
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
  sheen: document.createElementNS(
    'http://www.w3.org/2000/svg',
    'ellipse'
  ) as SVGEllipseElement,
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
    const kinds = addSpy.mock.calls.map((c) => c[0])
    expect(kinds).toContain('pointermove')
    expect(kinds).toContain('pointerleave')
  })

  test('skips listener registration under prefers-reduced-motion', () => {
    mockMatchMedia(makeMql(true))
    const addSpy = vi.fn()
    const removeSpy = vi.fn()
    render(<Harness refs={makeRefs()} addSpy={addSpy} removeSpy={removeSpy} />)
    const kinds = addSpy.mock.calls.map((c) => c[0])
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
    const kinds = removeSpy.mock.calls.map((c) => c[0])
    expect(kinds).toContain('pointermove')
    expect(kinds).toContain('pointerleave')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail (module not found)**

Run: `npx vitest run src/features/agent-status/hooks/useWaterCursor.test.tsx`
Expected: FAIL with "Failed to resolve import './useWaterCursor'".

- [ ] **Step 3: Implement the hook skeleton**

Create `src/features/agent-status/hooks/useWaterCursor.ts`:

```ts
import { useEffect, type RefObject } from 'react'

export interface LiquidRefs {
  slosh: SVGGElement
  waveAShift: SVGGElement
  waveBShift: SVGGElement
  waveAAnim: SVGGElement
  waveBAnim: SVGGElement
  sheen: SVGEllipseElement
  waterTop: number
  ambientAmp: number
  dims: { w: number; h: number }
}

export const LIQUID_DEFAULTS = {
  halo: 70,
  omega: 6.5,
  maxTilt: 1.6,
  ampMax: 1.5,
  maxShift: 1.0,
  maxLift: 1.0,
  meniscus: 2.3,
  speedup: 1.02,
} as const

export type LiquidTune = typeof LIQUID_DEFAULTS

export const useWaterCursor = (
  wrapRef: RefObject<HTMLElement | null>,
  refsRef: RefObject<LiquidRefs | null>,
  tune: Partial<LiquidTune> = {}
): void => {
  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null) return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (mql.matches) return

    const onMove = (_e: PointerEvent): void => {
      void _e
      void tune
      void refsRef
    }
    const onLeave = (): void => {}

    wrap.addEventListener('pointermove', onMove)
    wrap.addEventListener('pointerleave', onLeave)

    return (): void => {
      wrap.removeEventListener('pointermove', onMove)
      wrap.removeEventListener('pointerleave', onLeave)
    }
  }, [wrapRef, refsRef, tune])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/agent-status/hooks/useWaterCursor.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Run lint + type-check**

Run: `npm run lint && npm run type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/agent-status/hooks/useWaterCursor.ts src/features/agent-status/hooks/useWaterCursor.test.tsx
git commit -m "feat(agent-status): scaffold useWaterCursor hook with reduced-motion gate"
```

---

## Task 3: `useWaterCursor` — pointer-driven spring loop + clearInline

This task makes the hook actually drive the SVG. TDD: assert that a `pointermove` over the wrap leads to `data-interactive="on"` on `refs.slosh` and a non-zero inline `transform`, and that a `pointerleave` eventually clears those after the spring settles.

**Files:**

- Modify: `src/features/agent-status/hooks/useWaterCursor.ts`
- Modify: `src/features/agent-status/hooks/useWaterCursor.test.tsx`

- [ ] **Step 1: Append failing tests for the loop**

Add to the bottom of `src/features/agent-status/hooks/useWaterCursor.test.tsx`:

```tsx
import { act } from '@testing-library/react'

const flushRaf = async (frames: number): Promise<void> => {
  for (let i = 0; i < frames; i++) {
    await act(async () => {
      // Each tick advances rAF callbacks scheduled within React effects/timers.
      await new Promise((r) => setTimeout(r, 16))
    })
  }
}

describe('useWaterCursor — spring loop', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('pointermove writes data-interactive=on and non-zero rotate', async () => {
    mockMatchMedia(makeMql(false))
    const refs = makeRefs()
    const { getByTestId } = render(
      <Harness refs={refs} addSpy={vi.fn()} removeSpy={vi.fn()} />
    )
    const wrap = getByTestId('wrap')
    Object.defineProperty(wrap, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })
    await act(async () => {
      wrap.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 80,
          clientY: 50,
          bubbles: true,
        })
      )
    })
    await flushRaf(2)
    expect(refs.slosh.getAttribute('data-interactive')).toBe('on')
    expect(refs.slosh.style.transform).toMatch(/rotate\(/)
    expect(refs.slosh.style.transform).not.toMatch(/rotate\(0(\.0+)?deg\)/)
  })

  test('pointerleave settles back and clears inline', async () => {
    mockMatchMedia(makeMql(false))
    const refs = makeRefs()
    const { getByTestId } = render(
      <Harness refs={refs} addSpy={vi.fn()} removeSpy={vi.fn()} />
    )
    const wrap = getByTestId('wrap')
    Object.defineProperty(wrap, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })
    await act(async () => {
      wrap.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 80, clientY: 50 })
      )
    })
    await flushRaf(2)
    await act(async () => {
      wrap.dispatchEvent(new PointerEvent('pointerleave'))
    })
    await flushRaf(80) // > 1s — well past spring settle at omega=6.5
    expect(refs.slosh.getAttribute('data-interactive')).toBeNull()
    expect(refs.slosh.style.transform).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/agent-status/hooks/useWaterCursor.test.tsx -t "spring loop"`
Expected: FAIL — `data-interactive` is never set; `slosh.style.transform` stays empty.

- [ ] **Step 3: Replace the hook body with the full spring loop**

Replace the entire contents of `src/features/agent-status/hooks/useWaterCursor.ts` with:

```ts
import { useEffect, type RefObject } from 'react'

export interface LiquidRefs {
  slosh: SVGGElement
  waveAShift: SVGGElement
  waveBShift: SVGGElement
  waveAAnim: SVGGElement
  waveBAnim: SVGGElement
  sheen: SVGEllipseElement
  waterTop: number
  ambientAmp: number
  dims: { w: number; h: number }
}

export const LIQUID_DEFAULTS = {
  halo: 70,
  omega: 6.5,
  maxTilt: 1.6,
  ampMax: 1.5,
  maxShift: 1.0,
  maxLift: 1.0,
  meniscus: 2.3,
  speedup: 1.02,
} as const

export type LiquidTune = typeof LIQUID_DEFAULTS

type Signal =
  | 'tilt'
  | 'amp'
  | 'shiftX'
  | 'lift'
  | 'skew'
  | 'speedT'
  | 'sheenX'
  | 'sheenA'

type SignalState = Record<Signal, number>

const initialTarget = (): SignalState => ({
  tilt: 0,
  amp: 1,
  shiftX: 0,
  lift: 0,
  skew: 0,
  speedT: 0,
  sheenX: 0,
  sheenA: 0,
})

const initialVel = (): SignalState => ({
  tilt: 0,
  amp: 0,
  shiftX: 0,
  lift: 0,
  skew: 0,
  speedT: 0,
  sheenX: 0,
  sheenA: 0,
})

export const useWaterCursor = (
  wrapRef: RefObject<HTMLElement | null>,
  refsRef: RefObject<LiquidRefs | null>,
  tune: Partial<LiquidTune> = {}
): void => {
  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null) return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (mql.matches) return

    const T: LiquidTune = { ...LIQUID_DEFAULTS, ...tune }

    const target = initialTarget()
    let cur = initialTarget()
    let vel = initialVel()
    let rafId: number | null = null
    let lastT = performance.now()
    let active = false

    const onMove = (e: PointerEvent): void => {
      const refs = refsRef.current
      if (refs === null) return
      const r = wrap.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      const dist = Math.hypot(dx, dy)
      const linear = Math.max(0, 1 - dist / (T.halo + r.width / 2))
      const proximity = linear * linear * (3 - 2 * linear)
      const norm = Math.max(-1, Math.min(1, dx / (r.width / 2 + T.halo)))
      const aboveBelow = Math.max(-1, Math.min(1, dy / (r.height / 2 + T.halo)))
      target.tilt = norm * proximity * T.maxTilt
      target.amp = 1 + proximity * (T.ampMax - 1)
      target.shiftX = norm * proximity * T.maxShift
      target.lift = -aboveBelow * proximity * T.maxLift
      target.skew = norm * proximity * T.meniscus
      target.speedT = proximity
      target.sheenX = norm
      target.sheenA = proximity
      ensureLoop()
    }

    const onLeave = (): void => {
      target.tilt = 0
      target.amp = 1
      target.shiftX = 0
      target.lift = 0
      target.skew = 0
      target.speedT = 0
      target.sheenA = 0
      ensureLoop()
    }

    const apply = (): void => {
      const refs = refsRef.current
      if (refs === null) return
      if (!active) {
        refs.slosh.setAttribute('data-interactive', 'on')
        active = true
      }
      refs.slosh.style.transform = `rotate(${cur.tilt.toFixed(3)}deg)`
      refs.slosh.style.transformOrigin = `${refs.dims.w / 2}px ${refs.dims.h}px`

      const tx = `translateY(${cur.lift.toFixed(3)}px) scaleY(${cur.amp.toFixed(
        4
      )}) translateX(${cur.shiftX.toFixed(
        3
      )}px) skewX(${(-cur.skew).toFixed(3)}deg)`
      const txA = `translateY(${cur.lift.toFixed(
        3
      )}px) scaleY(${cur.amp.toFixed(4)}) translateX(${(
        cur.shiftX * 0.6
      ).toFixed(3)}px) skewX(${(-cur.skew).toFixed(3)}deg)`
      refs.waveAShift.style.transform = txA
      refs.waveBShift.style.transform = tx

      const speedFactor = 1 + cur.speedT * (T.speedup - 1)
      refs.waveAAnim.style.animationDuration =
        (3.4 / speedFactor).toFixed(3) + 's'
      refs.waveBAnim.style.animationDuration =
        (4.8 / speedFactor).toFixed(3) + 's'

      const w = refs.dims.w
      const sheenX = w / 2 + cur.sheenX * (w / 2 - 1)
      refs.sheen.setAttribute('cx', sheenX.toFixed(2))
      refs.sheen.setAttribute('cy', (refs.waterTop + cur.lift - 0.3).toFixed(2))
      refs.sheen.setAttribute('fill-opacity', (cur.sheenA * 0.55).toFixed(3))
    }

    const clearInline = (): void => {
      const refs = refsRef.current
      if (refs === null) return
      refs.slosh.removeAttribute('data-interactive')
      refs.slosh.style.transform = ''
      refs.slosh.style.transformOrigin = ''
      refs.waveAShift.style.transform = ''
      refs.waveBShift.style.transform = ''
      refs.waveAAnim.style.animationDuration = ''
      refs.waveBAnim.style.animationDuration = ''
      refs.sheen.setAttribute('fill-opacity', '0')
      active = false
    }

    function ensureLoop(): void {
      if (rafId !== null) return
      lastT = performance.now()
      const step = (t: number): void => {
        const dt = Math.min(0.05, (t - lastT) / 1000)
        lastT = t
        const w = T.omega
        const keys: Signal[] = [
          'tilt',
          'amp',
          'shiftX',
          'lift',
          'skew',
          'speedT',
          'sheenX',
          'sheenA',
        ]
        for (const k of keys) {
          const a = -2 * w * vel[k] - w * w * (cur[k] - target[k])
          vel[k] += a * dt
          cur[k] += vel[k] * dt
        }
        apply()

        const settled =
          Math.abs(cur.tilt - target.tilt) < 0.01 &&
          Math.abs(cur.amp - target.amp) < 0.005 &&
          Math.abs(cur.shiftX - target.shiftX) < 0.02 &&
          Math.abs(cur.lift - target.lift) < 0.02 &&
          Math.abs(cur.skew - target.skew) < 0.02 &&
          Math.abs(cur.speedT - target.speedT) < 0.01 &&
          Math.abs(cur.sheenA - target.sheenA) < 0.01 &&
          Math.abs(cur.sheenX - target.sheenX) < 0.01
        const atRest =
          target.tilt === 0 &&
          target.amp === 1 &&
          target.shiftX === 0 &&
          target.lift === 0 &&
          target.skew === 0 &&
          target.speedT === 0 &&
          target.sheenA === 0
        if (settled && atRest) {
          cur = initialTarget()
          vel = initialVel()
          clearInline()
          rafId = null
          return
        }
        rafId = requestAnimationFrame(step)
      }
      rafId = requestAnimationFrame(step)
    }

    wrap.addEventListener('pointermove', onMove)
    wrap.addEventListener('pointerleave', onLeave)

    return (): void => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = null
      wrap.removeEventListener('pointermove', onMove)
      wrap.removeEventListener('pointerleave', onLeave)
      clearInline()
    }
  }, [wrapRef, refsRef, tune])
}
```

- [ ] **Step 4: Run all `useWaterCursor` tests to verify they pass**

Run: `npx vitest run src/features/agent-status/hooks/useWaterCursor.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Run lint + type-check**

Run: `npm run lint && npm run type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/agent-status/hooks/useWaterCursor.ts src/features/agent-status/hooks/useWaterCursor.test.tsx
git commit -m "feat(agent-status): drive useWaterCursor with critically-damped spring"
```

---

## Task 4: `useWaterCursor` — live-toggle reduced-motion

`prefers-reduced-motion` flips while the app is running need to detach listeners on the spot. TDD: simulate a `change` event with `matches: true` and assert `pointermove` is no longer wired up; flip back to `false` and assert it is re-wired.

**Files:**

- Modify: `src/features/agent-status/hooks/useWaterCursor.ts`
- Modify: `src/features/agent-status/hooks/useWaterCursor.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `src/features/agent-status/hooks/useWaterCursor.test.tsx`:

```tsx
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
    expect(addSpy.mock.calls.map((c) => c[0])).toContain('pointermove')

    // Simulate OS-level Reduce Motion toggling ON.
    const changeListener = mql.addEventListener.mock.calls.find(
      (c) => c[0] === 'change'
    )?.[1] as ((e: { matches: boolean }) => void) | undefined
    expect(changeListener).toBeDefined()
    changeListener?.({ matches: true })

    expect(removeSpy.mock.calls.map((c) => c[0])).toContain('pointermove')
    expect(removeSpy.mock.calls.map((c) => c[0])).toContain('pointerleave')
  })

  test('change → matches:false reattaches pointer listeners', () => {
    const mql = makeMql(true)
    mockMatchMedia(mql)
    const addSpy = vi.fn()
    const removeSpy = vi.fn()
    render(<Harness refs={makeRefs()} addSpy={addSpy} removeSpy={removeSpy} />)
    expect(addSpy.mock.calls.map((c) => c[0])).not.toContain('pointermove')

    const changeListener = mql.addEventListener.mock.calls.find(
      (c) => c[0] === 'change'
    )?.[1] as ((e: { matches: boolean }) => void) | undefined
    changeListener?.({ matches: false })

    expect(addSpy.mock.calls.map((c) => c[0])).toContain('pointermove')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/agent-status/hooks/useWaterCursor.test.tsx -t "runtime reduced-motion"`
Expected: FAIL — `mql.addEventListener` is never called.

- [ ] **Step 3: Refactor the hook to subscribe to `mql.change`**

Replace the body of the `useEffect` callback in `src/features/agent-status/hooks/useWaterCursor.ts` with a structure that can attach/detach pointer listeners dynamically. Replace the `useEffect` block with:

```ts
useEffect(() => {
  const wrap = wrapRef.current
  if (wrap === null) return
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)')

  const T: LiquidTune = { ...LIQUID_DEFAULTS, ...tune }

  const target = initialTarget()
  let cur = initialTarget()
  let vel = initialVel()
  let rafId: number | null = null
  let lastT = performance.now()
  let active = false
  let attached = false

  const onMove = (e: PointerEvent): void => {
    const refs = refsRef.current
    if (refs === null) return
    const r = wrap.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const dx = e.clientX - cx
    const dy = e.clientY - cy
    const dist = Math.hypot(dx, dy)
    const linear = Math.max(0, 1 - dist / (T.halo + r.width / 2))
    const proximity = linear * linear * (3 - 2 * linear)
    const norm = Math.max(-1, Math.min(1, dx / (r.width / 2 + T.halo)))
    const aboveBelow = Math.max(-1, Math.min(1, dy / (r.height / 2 + T.halo)))
    target.tilt = norm * proximity * T.maxTilt
    target.amp = 1 + proximity * (T.ampMax - 1)
    target.shiftX = norm * proximity * T.maxShift
    target.lift = -aboveBelow * proximity * T.maxLift
    target.skew = norm * proximity * T.meniscus
    target.speedT = proximity
    target.sheenX = norm
    target.sheenA = proximity
    ensureLoop()
  }

  const onLeave = (): void => {
    target.tilt = 0
    target.amp = 1
    target.shiftX = 0
    target.lift = 0
    target.skew = 0
    target.speedT = 0
    target.sheenA = 0
    ensureLoop()
  }

  const apply = (): void => {
    const refs = refsRef.current
    if (refs === null) return
    if (!active) {
      refs.slosh.setAttribute('data-interactive', 'on')
      active = true
    }
    refs.slosh.style.transform = `rotate(${cur.tilt.toFixed(3)}deg)`
    refs.slosh.style.transformOrigin = `${refs.dims.w / 2}px ${refs.dims.h}px`
    const tx = `translateY(${cur.lift.toFixed(3)}px) scaleY(${cur.amp.toFixed(
      4
    )}) translateX(${cur.shiftX.toFixed(
      3
    )}px) skewX(${(-cur.skew).toFixed(3)}deg)`
    const txA = `translateY(${cur.lift.toFixed(
      3
    )}px) scaleY(${cur.amp.toFixed(4)}) translateX(${(cur.shiftX * 0.6).toFixed(
      3
    )}px) skewX(${(-cur.skew).toFixed(3)}deg)`
    refs.waveAShift.style.transform = txA
    refs.waveBShift.style.transform = tx
    const speedFactor = 1 + cur.speedT * (T.speedup - 1)
    refs.waveAAnim.style.animationDuration =
      (3.4 / speedFactor).toFixed(3) + 's'
    refs.waveBAnim.style.animationDuration =
      (4.8 / speedFactor).toFixed(3) + 's'
    const w = refs.dims.w
    const sheenX = w / 2 + cur.sheenX * (w / 2 - 1)
    refs.sheen.setAttribute('cx', sheenX.toFixed(2))
    refs.sheen.setAttribute('cy', (refs.waterTop + cur.lift - 0.3).toFixed(2))
    refs.sheen.setAttribute('fill-opacity', (cur.sheenA * 0.55).toFixed(3))
  }

  const clearInline = (): void => {
    const refs = refsRef.current
    if (refs === null) return
    refs.slosh.removeAttribute('data-interactive')
    refs.slosh.style.transform = ''
    refs.slosh.style.transformOrigin = ''
    refs.waveAShift.style.transform = ''
    refs.waveBShift.style.transform = ''
    refs.waveAAnim.style.animationDuration = ''
    refs.waveBAnim.style.animationDuration = ''
    refs.sheen.setAttribute('fill-opacity', '0')
    active = false
  }

  function ensureLoop(): void {
    if (rafId !== null) return
    lastT = performance.now()
    const step = (t: number): void => {
      const dt = Math.min(0.05, (t - lastT) / 1000)
      lastT = t
      const w = T.omega
      const keys: Signal[] = [
        'tilt',
        'amp',
        'shiftX',
        'lift',
        'skew',
        'speedT',
        'sheenX',
        'sheenA',
      ]
      for (const k of keys) {
        const a = -2 * w * vel[k] - w * w * (cur[k] - target[k])
        vel[k] += a * dt
        cur[k] += vel[k] * dt
      }
      apply()
      const settled =
        Math.abs(cur.tilt - target.tilt) < 0.01 &&
        Math.abs(cur.amp - target.amp) < 0.005 &&
        Math.abs(cur.shiftX - target.shiftX) < 0.02 &&
        Math.abs(cur.lift - target.lift) < 0.02 &&
        Math.abs(cur.skew - target.skew) < 0.02 &&
        Math.abs(cur.speedT - target.speedT) < 0.01 &&
        Math.abs(cur.sheenA - target.sheenA) < 0.01 &&
        Math.abs(cur.sheenX - target.sheenX) < 0.01
      const atRest =
        target.tilt === 0 &&
        target.amp === 1 &&
        target.shiftX === 0 &&
        target.lift === 0 &&
        target.skew === 0 &&
        target.speedT === 0 &&
        target.sheenA === 0
      if (settled && atRest) {
        cur = initialTarget()
        vel = initialVel()
        clearInline()
        rafId = null
        return
      }
      rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)
  }

  const attach = (): void => {
    if (attached) return
    wrap.addEventListener('pointermove', onMove)
    wrap.addEventListener('pointerleave', onLeave)
    attached = true
  }

  const detach = (): void => {
    if (!attached) return
    wrap.removeEventListener('pointermove', onMove)
    wrap.removeEventListener('pointerleave', onLeave)
    attached = false
    if (rafId !== null) cancelAnimationFrame(rafId)
    rafId = null
    clearInline()
  }

  const onMqlChange = (e: MediaQueryListEvent | { matches: boolean }): void => {
    if (e.matches) detach()
    else attach()
  }
  mql.addEventListener('change', onMqlChange as EventListener)

  if (!mql.matches) attach()

  return (): void => {
    mql.removeEventListener('change', onMqlChange as EventListener)
    detach()
  }
}, [wrapRef, refsRef, tune])
```

- [ ] **Step 4: Run all `useWaterCursor` tests to verify they pass**

Run: `npx vitest run src/features/agent-status/hooks/useWaterCursor.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Run lint + type-check**

Run: `npm run lint && npm run type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/agent-status/hooks/useWaterCursor.ts src/features/agent-status/hooks/useWaterCursor.test.tsx
git commit -m "feat(agent-status): live-toggle pointer listeners on reduced-motion change"
```

---

## Task 5: `LiquidFill` primitive — `mode="bar"` geometry (no hook attached yet)

Write the SVG renderer for the rail-bucket geometry (22×110, two phase-offset waves, base rect below the trough, nested transform groups, tick marks). The hook will be wired up in Task 6.

**Files:**

- Create: `src/features/agent-status/components/LiquidFill.tsx`
- Create: `src/features/agent-status/components/LiquidFill.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/features/agent-status/components/LiquidFill.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { LiquidFill } from './LiquidFill'

describe('LiquidFill — bar mode geometry', () => {
  test('renders SVG with viewBox "0 0 22 110"', () => {
    const { container } = render(
      <LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 22 110')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  test('base rect y equals top + ambientAmp + 0.5', () => {
    const { container } = render(
      <LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />
    )
    // pct=50 → liquidH=(110-4)*0.5=53 → top=57. ambientAmp = min(1.8, 22*0.09) = 1.8.
    // base.y expected = 57 + 1.8 + 0.5 = 59.3
    const baseRect = container.querySelector('rect[data-testid="liquid-base"]')
    expect(baseRect).not.toBeNull()
    expect(parseFloat(baseRect!.getAttribute('y') ?? '0')).toBeCloseTo(59.3, 1)
  })

  test('renders tick marks at 25/50/75', () => {
    const { container } = render(
      <LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />
    )
    expect(
      container.querySelector('[data-testid="liquid-tick-25"]')
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="liquid-tick-50"]')
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="liquid-tick-75"]')
    ).not.toBeNull()
  })

  test('renders two phase-offset wave paths in nested transform groups', () => {
    const { container } = render(
      <LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />
    )
    expect(
      container.querySelector(
        '[data-testid="liquid-water-y-a"] [data-testid="liquid-wave-shift-a"] path'
      )
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="liquid-water-y-b"] [data-testid="liquid-wave-shift-b"] path'
      )
    ).not.toBeNull()
  })

  test('outer div carries the caller testId and className', () => {
    const { container } = render(
      <LiquidFill
        mode="bar"
        pct={50}
        color="#cba6f7"
        testId="lf"
        className="some-class"
      />
    )
    const wrap = container.querySelector('[data-testid="lf"]')
    expect(wrap).not.toBeNull()
    expect(wrap?.className).toContain('some-class')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail (module not found)**

Run: `npx vitest run src/features/agent-status/components/LiquidFill.test.tsx`
Expected: FAIL with "Failed to resolve import './LiquidFill'".

- [ ] **Step 3: Implement `LiquidFill.tsx` for bar mode**

Create `src/features/agent-status/components/LiquidFill.tsx`:

```tsx
import { useId, useMemo, type ReactElement } from 'react'

import { LIQUID_DEFAULTS, type LiquidTune } from '../hooks/useWaterCursor'

export interface LiquidFillProps {
  pct: number
  color: string
  mode: 'bar' | 'fill'
  ariaHidden?: boolean
  className?: string
  testId?: string
  tune?: Partial<LiquidTune>
}

const BAR_DIMS = { w: 22, h: 110 } as const
const TICK_LEVELS = [25, 50, 75] as const

const buildWavePath = (
  width: number,
  amp: number,
  totalH: number,
  phase: number
): string => {
  const wavelength = width / 2
  const segments = Math.ceil((width / wavelength) * 4)
  const step = width / segments
  const phaseOffset = ((phase % 1) + 1) % 1
  const startY =
    phaseOffset < 0.5 ? amp * (phaseOffset * 2) : amp * (2 - phaseOffset * 2)
  let d = `M 0,${startY}`
  for (let i = 1; i <= segments; i++) {
    const x = step * i
    const cp1x = step * (i - 1) + step / 2
    const cp2x = step * i - step / 2
    const flipped = (i + Math.floor(phaseOffset * 2)) % 2 === 0
    const targetY = flipped ? amp : 0
    const sY = (i - 1 + Math.floor(phaseOffset * 2)) % 2 === 0 ? amp : 0
    d += ` C ${cp1x},${sY} ${cp2x},${targetY} ${x},${targetY}`
  }
  d += ` L ${width},${totalH} L 0,${totalH} Z`
  return d
}

interface Geom {
  w: number
  h: number
  top: number
  ambientAmp: number
  baseFloor: number
  wavePathA: string
  wavePathB: string
}

const computeGeom = (w: number, h: number, pct: number): Geom => {
  const clamped = Math.max(0, Math.min(100, pct))
  const liquidH = (h - 4) * (clamped / 100)
  const top = h - liquidH
  const ambientAmp = Math.min(1.8, w * 0.09)
  const baseFloor = top + ambientAmp + 0.5
  const wavePathA = buildWavePath(w * 2, ambientAmp, h, 0)
  const wavePathB = buildWavePath(w * 2, ambientAmp, h, 0.25)
  return { w, h, top, ambientAmp, baseFloor, wavePathA, wavePathB }
}

export const LiquidFill = ({
  pct,
  color,
  mode,
  ariaHidden = true,
  className,
  testId,
  tune: _tune,
}: LiquidFillProps): ReactElement => {
  void _tune // hook wiring comes in Task 6

  const reactId = useId().replace(/:/g, '')
  const fillId = `liquid-fill-${reactId}`
  const glassId = `liquid-glass-${reactId}`
  const sheenId = `liquid-sheen-${reactId}`
  const clipId = `liquid-clip-${reactId}`

  const { w, h } = mode === 'bar' ? BAR_DIMS : BAR_DIMS // fill measured later
  const geom = useMemo(() => computeGeom(w, h, pct), [w, h, pct])

  return (
    <div
      data-testid={testId}
      className={className}
      style={{ display: mode === 'bar' ? 'inline-block' : undefined }}
    >
      <svg
        width={mode === 'bar' ? w : '100%'}
        height={mode === 'bar' ? h : '100%'}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio={mode === 'bar' ? 'xMidYMid meet' : 'none'}
        aria-hidden={ariaHidden ? 'true' : undefined}
        style={{ overflow: 'visible', display: 'block' }}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.92" />
            <stop offset="100%" stopColor={color} stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id={glassId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(255,255,255,0.06)" />
            <stop offset="40%" stopColor="rgba(255,255,255,0.02)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.15)" />
          </linearGradient>
          <linearGradient id={sheenId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x="1" y="2" width={w - 2} height={h - 3} rx="3" ry="3" />
          </clipPath>
        </defs>

        <rect
          x="1"
          y="2"
          width={w - 2}
          height={h - 3}
          rx="3"
          ry="3"
          fill={`url(#${glassId})`}
        />

        <g clipPath={`url(#${clipId})`}>
          <g
            className="vf-liquid-slosh"
            data-testid="liquid-slosh"
            style={{
              transformOrigin: `${w / 2}px ${h}px`,
            }}
          >
            <rect
              data-testid="liquid-base"
              x={0}
              y={geom.baseFloor}
              width={w}
              height={Math.max(0, h - geom.baseFloor)}
              fill={`url(#${fillId})`}
            />

            <g
              data-testid="liquid-water-y-a"
              style={{
                transform: `translateY(${geom.top - geom.ambientAmp / 2}px)`,
                transition: 'transform 500ms ease',
              }}
            >
              <g data-testid="liquid-wave-shift-a">
                <g
                  className="vf-liquid-wave-a"
                  data-testid="liquid-wave-a-anim"
                >
                  <path d={geom.wavePathA} fill={color} fillOpacity="0.55" />
                </g>
              </g>
            </g>

            <g
              data-testid="liquid-water-y-b"
              style={{
                transform: `translateY(${geom.top}px)`,
                transition: 'transform 500ms ease',
              }}
            >
              <g data-testid="liquid-wave-shift-b">
                <g
                  className="vf-liquid-wave-b"
                  data-testid="liquid-wave-b-anim"
                >
                  <path
                    d={geom.wavePathB}
                    fill={`url(#${fillId})`}
                    fillOpacity="0.95"
                  />
                </g>
              </g>
            </g>

            <ellipse
              data-testid="liquid-sheen"
              cx={w / 2}
              cy={geom.top}
              rx={Math.max(3, w * 0.27)}
              ry="0.8"
              fill={`url(#${sheenId})`}
              fillOpacity="0"
            />
          </g>

          {TICK_LEVELS.map((t) => {
            const y = h - (h - 4) * (t / 100)
            return (
              <g key={t} data-testid={`liquid-tick-${t}`}>
                <line
                  x1="1"
                  x2="4"
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.18)"
                  strokeWidth="0.8"
                />
                <line
                  x1={w - 4}
                  x2={w - 1}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.18)"
                  strokeWidth="0.8"
                />
              </g>
            )
          })}
        </g>

        <rect
          x="1"
          y="2"
          width={w - 2}
          height={h - 3}
          rx="3"
          ry="3"
          fill="transparent"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="1"
        />
      </svg>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/agent-status/components/LiquidFill.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Run lint + type-check**

Run: `npm run lint && npm run type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/agent-status/components/LiquidFill.tsx src/features/agent-status/components/LiquidFill.test.tsx
git commit -m "feat(agent-status): LiquidFill bar-mode SVG geometry"
```

---

## Task 6: `LiquidFill` — attach `useWaterCursor` to the rendered SVG

Wire the hook into `LiquidFill` so cursor movement on the outer wrap drives the SVG refs. TDD: render LiquidFill, fire pointermove on the outer div, assert `data-interactive="on"` lands on the `liquid-slosh` group.

**Files:**

- Modify: `src/features/agent-status/components/LiquidFill.tsx`
- Modify: `src/features/agent-status/components/LiquidFill.test.tsx`

- [ ] **Step 1: Append failing test**

Append to `src/features/agent-status/components/LiquidFill.test.tsx`:

```tsx
import { act } from '@testing-library/react'

describe('LiquidFill — cursor hook integration', () => {
  test('pointermove on outer wrap sets data-interactive on slosh', async () => {
    const { container, getByTestId } = render(
      <LiquidFill mode="bar" pct={50} color="#cba6f7" testId="lf" />
    )
    const wrap = getByTestId('lf') as HTMLDivElement
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
        toJSON: () => ({}),
      }),
    })
    await act(async () => {
      wrap.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 11,
          clientY: 55,
          bubbles: true,
        })
      )
      await new Promise((r) => setTimeout(r, 32))
    })
    const slosh = container.querySelector('[data-testid="liquid-slosh"]')
    expect(slosh?.getAttribute('data-interactive')).toBe('on')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/agent-status/components/LiquidFill.test.tsx -t "cursor hook integration"`
Expected: FAIL — `data-interactive` is null.

- [ ] **Step 3: Wire the hook**

In `src/features/agent-status/components/LiquidFill.tsx`, replace the `import` block at the top and the function body to:

1. Import `useEffect`, `useRef` from React.
2. Import `useWaterCursor` (already imported `LIQUID_DEFAULTS`/`LiquidTune`).
3. Create refs for wrap, slosh, waveAShift, waveBShift, waveAAnim, waveBAnim, sheen.
4. Pack them into a `LiquidRefs` value via `useEffect` (so geometry updates with `pct`).
5. Call `useWaterCursor(wrapRef, refsRef, tune)`.

Patch `LiquidFill.tsx` — at the top of the file:

```tsx
import { useEffect, useId, useMemo, useRef, type ReactElement } from 'react'

import {
  LIQUID_DEFAULTS,
  useWaterCursor,
  type LiquidRefs,
  type LiquidTune,
} from '../hooks/useWaterCursor'
```

And replace the `LiquidFill` component body (from `export const LiquidFill = ...` to the closing `)` of the JSX) with:

```tsx
export const LiquidFill = ({
  pct,
  color,
  mode,
  ariaHidden = true,
  className,
  testId,
  tune,
}: LiquidFillProps): ReactElement => {
  const reactId = useId().replace(/:/g, '')
  const fillId = `liquid-fill-${reactId}`
  const glassId = `liquid-glass-${reactId}`
  const sheenId = `liquid-sheen-${reactId}`
  const clipId = `liquid-clip-${reactId}`

  const { w, h } = mode === 'bar' ? BAR_DIMS : BAR_DIMS
  const geom = useMemo(() => computeGeom(w, h, pct), [w, h, pct])

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const sloshRef = useRef<SVGGElement | null>(null)
  const waveAShiftRef = useRef<SVGGElement | null>(null)
  const waveBShiftRef = useRef<SVGGElement | null>(null)
  const waveAAnimRef = useRef<SVGGElement | null>(null)
  const waveBAnimRef = useRef<SVGGElement | null>(null)
  const sheenRef = useRef<SVGEllipseElement | null>(null)

  const refsRef = useRef<LiquidRefs | null>(null)
  useEffect(() => {
    if (
      sloshRef.current === null ||
      waveAShiftRef.current === null ||
      waveBShiftRef.current === null ||
      waveAAnimRef.current === null ||
      waveBAnimRef.current === null ||
      sheenRef.current === null
    ) {
      refsRef.current = null
      return
    }
    refsRef.current = {
      slosh: sloshRef.current,
      waveAShift: waveAShiftRef.current,
      waveBShift: waveBShiftRef.current,
      waveAAnim: waveAAnimRef.current,
      waveBAnim: waveBAnimRef.current,
      sheen: sheenRef.current,
      waterTop: geom.top,
      ambientAmp: geom.ambientAmp,
      dims: { w, h },
    }
  }, [geom.top, geom.ambientAmp, w, h])

  useWaterCursor(wrapRef, refsRef, tune)

  return (
    <div
      ref={wrapRef}
      data-testid={testId}
      className={className}
      style={{ display: mode === 'bar' ? 'inline-block' : undefined }}
    >
      <svg
        width={mode === 'bar' ? w : '100%'}
        height={mode === 'bar' ? h : '100%'}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio={mode === 'bar' ? 'xMidYMid meet' : 'none'}
        aria-hidden={ariaHidden ? 'true' : undefined}
        style={{ overflow: 'visible', display: 'block' }}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.92" />
            <stop offset="100%" stopColor={color} stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id={glassId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(255,255,255,0.06)" />
            <stop offset="40%" stopColor="rgba(255,255,255,0.02)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.15)" />
          </linearGradient>
          <linearGradient id={sheenId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x="1" y="2" width={w - 2} height={h - 3} rx="3" ry="3" />
          </clipPath>
        </defs>

        <rect
          x="1"
          y="2"
          width={w - 2}
          height={h - 3}
          rx="3"
          ry="3"
          fill={`url(#${glassId})`}
        />

        <g clipPath={`url(#${clipId})`}>
          <g
            ref={sloshRef}
            className="vf-liquid-slosh"
            data-testid="liquid-slosh"
            style={{ transformOrigin: `${w / 2}px ${h}px` }}
          >
            <rect
              data-testid="liquid-base"
              x={0}
              y={geom.baseFloor}
              width={w}
              height={Math.max(0, h - geom.baseFloor)}
              fill={`url(#${fillId})`}
            />

            <g
              data-testid="liquid-water-y-a"
              style={{
                transform: `translateY(${geom.top - geom.ambientAmp / 2}px)`,
                transition: 'transform 500ms ease',
              }}
            >
              <g ref={waveAShiftRef} data-testid="liquid-wave-shift-a">
                <g
                  ref={waveAAnimRef}
                  className="vf-liquid-wave-a"
                  data-testid="liquid-wave-a-anim"
                >
                  <path d={geom.wavePathA} fill={color} fillOpacity="0.55" />
                </g>
              </g>
            </g>

            <g
              data-testid="liquid-water-y-b"
              style={{
                transform: `translateY(${geom.top}px)`,
                transition: 'transform 500ms ease',
              }}
            >
              <g ref={waveBShiftRef} data-testid="liquid-wave-shift-b">
                <g
                  ref={waveBAnimRef}
                  className="vf-liquid-wave-b"
                  data-testid="liquid-wave-b-anim"
                >
                  <path
                    d={geom.wavePathB}
                    fill={`url(#${fillId})`}
                    fillOpacity="0.95"
                  />
                </g>
              </g>
            </g>

            <ellipse
              ref={sheenRef}
              data-testid="liquid-sheen"
              cx={w / 2}
              cy={geom.top}
              rx={Math.max(3, w * 0.27)}
              ry="0.8"
              fill={`url(#${sheenId})`}
              fillOpacity="0"
            />
          </g>

          {TICK_LEVELS.map((t) => {
            const y = h - (h - 4) * (t / 100)
            return (
              <g key={t} data-testid={`liquid-tick-${t}`}>
                <line
                  x1="1"
                  x2="4"
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.18)"
                  strokeWidth="0.8"
                />
                <line
                  x1={w - 4}
                  x2={w - 1}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.18)"
                  strokeWidth="0.8"
                />
              </g>
            )
          })}
        </g>

        <rect
          x="1"
          y="2"
          width={w - 2}
          height={h - 3}
          rx="3"
          ry="3"
          fill="transparent"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="1"
        />
      </svg>
    </div>
  )
}
```

Also remove the now-unused `LiquidTune` re-import — it's already used in the `LiquidFillProps` type.

- [ ] **Step 4: Run all `LiquidFill` tests to verify they pass**

Run: `npx vitest run src/features/agent-status/components/LiquidFill.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Run lint + type-check**

Run: `npm run lint && npm run type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/agent-status/components/LiquidFill.tsx src/features/agent-status/components/LiquidFill.test.tsx
git commit -m "feat(agent-status): drive LiquidFill SVG with useWaterCursor"
```

---

## Task 7: `LiquidFill` — `mode="fill"` ResizeObserver sizing

Make `mode="fill"` measure its outer `<div>` and render the SVG at the measured size with `preserveAspectRatio="none"`. The wave path's `width` argument scales with measured CSS width × 2 so the wavelength looks proportionate in any container.

**Files:**

- Modify: `src/features/agent-status/components/LiquidFill.tsx`
- Modify: `src/features/agent-status/components/LiquidFill.test.tsx`

- [ ] **Step 1: Append failing tests**

Append to `src/features/agent-status/components/LiquidFill.test.tsx`:

```tsx
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

describe('LiquidFill — fill mode', () => {
  beforeEach(() => {
    MockResizeObserver.instances = []
    ;(
      globalThis as unknown as { ResizeObserver: typeof ResizeObserver }
    ).ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
  })

  test('renders SVG with measured width/height after ResizeObserver fires', async () => {
    const { container } = render(
      <LiquidFill
        mode="fill"
        pct={50}
        color="#cba6f7"
        testId="lf-fill"
        className="h-full w-full"
      />
    )
    await act(async () => {
      MockResizeObserver.instances[0]?.trigger({ width: 200, height: 72 })
    })
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 200 72')
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('none')
  })

  test('outer div carries the caller className', () => {
    const { getByTestId } = render(
      <LiquidFill
        mode="fill"
        pct={50}
        color="#cba6f7"
        testId="lf-fill"
        className="h-full w-full"
      />
    )
    expect((getByTestId('lf-fill') as HTMLElement).className).toContain(
      'h-full'
    )
    expect((getByTestId('lf-fill') as HTMLElement).className).toContain(
      'w-full'
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/agent-status/components/LiquidFill.test.tsx -t "fill mode"`
Expected: FAIL — viewBox stays at `0 0 22 110` because the component currently ignores mode for sizing.

- [ ] **Step 3: Add ResizeObserver-driven dims**

In `src/features/agent-status/components/LiquidFill.tsx`, add `useState` to the React import and a `useEffect` that creates a `ResizeObserver` when `mode === 'fill'`. Replace the `const { w, h } = mode === 'bar' ? BAR_DIMS : BAR_DIMS` line with:

```tsx
const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null)

useEffect(() => {
  if (mode !== 'fill' || wrapRef.current === null) return
  const el = wrapRef.current
  const ro = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect
    if (rect === undefined) return
    setMeasured({ w: Math.max(1, rect.width), h: Math.max(1, rect.height) })
  })
  ro.observe(el)
  return (): void => {
    ro.disconnect()
  }
}, [mode])

const { w, h } =
  mode === 'bar' ? BAR_DIMS : (measured ?? { w: BAR_DIMS.w, h: BAR_DIMS.h })
```

Make sure to update the import:

```tsx
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
```

Also update `computeGeom`'s wave-path call to scale wavelength with width — it already uses `w * 2`, so a wider gauge produces longer waves automatically. No further changes needed there.

- [ ] **Step 4: Run all `LiquidFill` tests to verify they pass**

Run: `npx vitest run src/features/agent-status/components/LiquidFill.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Run lint + type-check**

Run: `npm run lint && npm run type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/agent-status/components/LiquidFill.tsx src/features/agent-status/components/LiquidFill.test.tsx
git commit -m "feat(agent-status): LiquidFill fill-mode via ResizeObserver"
```

---

## Task 8: Refactor `Bucket.tsx` to delegate SVG to `LiquidFill`

Replace the inline SVG block with a `<LiquidFill mode="bar" />` while preserving the public API (`pct`, `color`, `label`, `title`) and the label + percentage chrome around it.

**Files:**

- Modify: `src/features/agent-status/components/Bucket.tsx`

- [ ] **Step 1: Confirm the existing tests cover the public contract**

Run: `npx vitest run src/features/agent-status/components/Bucket.test.tsx`
Expected: PASS — these are the regression net for the refactor.

- [ ] **Step 2: Replace the file**

Overwrite `src/features/agent-status/components/Bucket.tsx` with:

```tsx
import { type ReactElement } from 'react'

import { LiquidFill } from './LiquidFill'

export interface BucketProps {
  pct: number
  color: string
  label: string
  title?: string
}

export const Bucket = ({
  pct,
  color,
  label,
  title = '',
}: BucketProps): ReactElement => {
  const clamped = Math.max(0, Math.min(100, pct))
  const labelKey = label.toLowerCase()

  return (
    <div
      data-testid={`bucket-${labelKey}`}
      title={title}
      className="flex flex-col items-center gap-1"
    >
      <div
        data-testid={`bucket-${labelKey}-pct`}
        className="font-display text-[14px] font-semibold leading-none tabular-nums tracking-tight text-on-surface"
      >
        {Math.round(clamped)}
        <span
          data-testid={`bucket-${labelKey}-pct-glyph`}
          className="ml-px text-[12px]"
          style={{ color }}
        >
          %
        </span>
      </div>

      <LiquidFill
        mode="bar"
        pct={clamped}
        color={color}
        testId={`bucket-${labelKey}-svg`}
      />

      <span
        data-testid={`bucket-${labelKey}-label`}
        className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.18em] text-on-surface-muted"
      >
        {label}
      </span>
    </div>
  )
}
```

- [ ] **Step 3: Update existing test assertions that target old SVG-internal test ids**

Open `src/features/agent-status/components/Bucket.test.tsx` and rename any reference:

- `bucket-tick-25` / `bucket-tick-50` / `bucket-tick-75` → `liquid-tick-25` / `liquid-tick-50` / `liquid-tick-75`
- `bucket-liquid` → `liquid-slosh` (or remove the assertion if the test is just checking liquid presence — `getByTestId('liquid-base')` is the cleaner replacement)

If a test asserts on an old test id with no direct equivalent, replace it with an equivalent assertion that hits the new test id, or delete the test if it duplicates a `LiquidFill.test.tsx` regression.

- [ ] **Step 4: Run `Bucket.test.tsx`, `LiquidFill.test.tsx`, and `useWaterCursor.test.tsx`**

Run: `npx vitest run src/features/agent-status/components/Bucket.test.tsx src/features/agent-status/components/LiquidFill.test.tsx src/features/agent-status/hooks/useWaterCursor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run `AgentStatusRail.test.tsx` to confirm no regression**

Run: `npx vitest run src/features/agent-status/components/AgentStatusRail.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run lint + type-check**

Run: `npm run lint && npm run type-check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/agent-status/components/Bucket.tsx src/features/agent-status/components/Bucket.test.tsx
git commit -m "refactor(agent-status): Bucket delegates SVG to LiquidFill"
```

---

## Task 9: Refactor `ContextBucket.tsx` to use `LiquidFill` + `hexForColorClass`

Replace the flat-gradient fill `<div>` with `<LiquidFill mode="fill" />`. Add a local `hexForColorClass` helper that returns the matching hex literal from `tailwind.config.js`. Card chrome, scale, progress bar, percentage display, and color thresholds are untouched.

**Files:**

- Modify: `src/features/agent-status/components/ContextBucket.tsx`
- Modify: `src/features/agent-status/components/ContextBucket.test.tsx`

- [ ] **Step 1: Confirm baseline tests**

Run: `npx vitest run src/features/agent-status/components/ContextBucket.test.tsx`
Expected: PASS.

- [ ] **Step 2: Apply the refactor**

In `src/features/agent-status/components/ContextBucket.tsx`:

a) Add the `LiquidFill` import at the top of the file, alongside the existing imports:

```tsx
import { LiquidFill } from './LiquidFill'
```

b) Below the existing `getColorClass` definition (after line 68), add:

```tsx
const hexForColorClass = (pct: number | null): string => {
  if (pct !== null && pct >= 90) return '#ffb4ab' // tailwind.config.js:25 — error
  if (pct !== null && pct >= 80) return '#ff94a5' // tailwind.config.js:21 — tertiary
  return '#cba6f7' // tailwind.config.js:10 — primary-container
}
```

c) Replace lines 117-130 (the `<div data-testid="bucket-fill" ...>` block) with:

```tsx
<LiquidFill
  mode="fill"
  pct={effectivePct}
  color={hexForColorClass(pct)}
  className="h-full w-full"
  testId="bucket-fill"
/>
```

- [ ] **Step 3: Update `ContextBucket.test.tsx`**

Open `src/features/agent-status/components/ContextBucket.test.tsx` and confirm the existing `bucket-fill` testid query continues to work — it now points to the LiquidFill outer `<div>` rather than the old gradient div, but the assertion target is the same.

If any existing test reads `.style.height` or `.style.background` to assert on the gradient, replace it with an assertion against the rendered `LiquidFill`'s `data-testid="liquid-base"` element's `y` attribute (which scales with `pct`).

Add a new test for the hex helper inside the same file:

```tsx
test('LiquidFill receives the correct hex for each threshold', () => {
  const { rerender, container } = render(
    <ContextBucket
      usedPercentage={50}
      contextWindowSize={200000}
      totalInputTokens={50000}
      totalOutputTokens={5000}
    />
  )
  // primary-container at <80
  let stops = container.querySelectorAll('linearGradient stop')
  expect(stops[0]?.getAttribute('stop-color')).toBe('#cba6f7')

  rerender(
    <ContextBucket
      usedPercentage={85}
      contextWindowSize={200000}
      totalInputTokens={170000}
      totalOutputTokens={5000}
    />
  )
  stops = container.querySelectorAll('linearGradient stop')
  expect(stops[0]?.getAttribute('stop-color')).toBe('#ff94a5')

  rerender(
    <ContextBucket
      usedPercentage={95}
      contextWindowSize={200000}
      totalInputTokens={185000}
      totalOutputTokens={5000}
    />
  )
  stops = container.querySelectorAll('linearGradient stop')
  expect(stops[0]?.getAttribute('stop-color')).toBe('#ffb4ab')
})
```

- [ ] **Step 4: Run `ContextBucket.test.tsx`**

Run: `npx vitest run src/features/agent-status/components/ContextBucket.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full agent-status suite**

Run: `npx vitest run src/features/agent-status`
Expected: PASS.

- [ ] **Step 6: Run lint + type-check**

Run: `npm run lint && npm run type-check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/agent-status/components/ContextBucket.tsx src/features/agent-status/components/ContextBucket.test.tsx
git commit -m "refactor(agent-status): ContextBucket uses LiquidFill with hex color tokens"
```

---

## Task 10: Whole-suite verification + manual smoke

Run every check the pre-push hook will run, then walk the manual smoke list from spec §9.

**Files:** none modified

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: PASS, no failing tests across the repo.

- [ ] **Step 2: Lint and type-check**

Run: `npm run lint && npm run type-check && npm run format:check`
Expected: PASS.

- [ ] **Step 3: Boot the app and inspect each scenario**

Run: `npm run dev` (in a separate terminal).

For each of the following, observe the actual visual behavior and confirm:

- **Rail collapsed, CTX bucket:** cursor approaches → water tilts, lifts, skews, waves quicken. Cursor leaves → spring relaxes ~600 ms back to ambient slosh.
- **Rail collapsed, CACHE bucket:** same, independently of CTX.
- **Expanded panel, CURRENT CONTEXT gauge:** cursor approaches → same behavior in a wide rectangular tank. Wave wavelength scales proportionally.
- **Collapse ↔ expand toggling:** open Chrome DevTools, inspect both `Bucket` (rail) and `ContextBucket` (panel) trees. After each toggle, no `[data-interactive="on"]` should appear on detached nodes; no inline `transform` should linger on freshly mounted ones.
- **Panel closed:** the `ContextBucket` unmounts. Devtools Memory tab shows no pending rAF handles owned by removed nodes.
- **OS Reduce Motion toggled ON mid-session (no reload):** within one frame, waves and slosh stop; cursor stops driving the water; the fill is static.
- **OS Reduce Motion toggled OFF mid-session:** ambient slosh resumes; pointer movement again drives the water.

- [ ] **Step 4: If all smoke checks pass, no commit is needed.**

If a smoke check fails, open a new sub-task to address it, fix, retest, and commit before opening the PR.

---

## Self-review checklist

This list is for the writer of the plan to walk after committing. The plan executor does not need to re-run it.

1. **Spec coverage**
   - §1 Summary — Tasks 1-10 collectively cover every claim in the summary.
   - §2 Scope — every "in scope" item maps to at least one task; nothing "out of scope" appears.
   - §3 Tuning constants — frozen in `LIQUID_DEFAULTS` (Task 2, Step 3).
   - §4 Hook (trigger zone, lifecycle, reduced-motion live-toggle) — Tasks 2, 3, 4.
   - §5 LiquidFill (geometry, nested transform groups, sizing, sheen) — Tasks 5, 6, 7.
   - §6.1 Bucket consumer — Task 8.
   - §6.2 ContextBucket consumer + hexForColorClass — Task 9.
   - §7 CSS rename — Task 1.
   - §8 Testing — every consumer/hook test bullet has a task that lands the test.
   - §9 Manual verification — Task 10.
   - §10 Risks — addressed in §10 of the spec; the plan does not introduce new ones.
   - §11 File-level diff plan — Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9 produce the exact files in the diff plan.

2. **Placeholder scan** — none. Every code step shows the actual code.

3. **Type consistency** — `LiquidRefs`, `LiquidFillProps`, `BucketProps` are defined once and reused. `Signal` union appears only inside the hook implementation. `LIQUID_DEFAULTS` is the single source of truth for tuning.
