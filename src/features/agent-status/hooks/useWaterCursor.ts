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

export type LiquidTune = { [K in keyof typeof LIQUID_DEFAULTS]: number }

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

const EMPTY_TUNE: Partial<LiquidTune> = Object.freeze({}) as Partial<LiquidTune>

export const useWaterCursor = (
  wrapRef: RefObject<HTMLElement | null>,
  refsRef: RefObject<LiquidRefs | null>,
  tune: Partial<LiquidTune> = EMPTY_TUNE
): void => {
  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null) {
      return
    }
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')

    const T: LiquidTune = { ...LIQUID_DEFAULTS, ...tune }

    const target = initialTarget()
    let cur = initialTarget()
    let vel = initialVel()
    let rafId: number | null = null
    let lastT = performance.now()
    let active = false

    // Tracks the animated water-top position — springs toward refs.waterTop each
    // rAF frame so the sheen follows the 500ms CSS transition on pct changes
    // instead of snapping to the new level instantly.
    let currentWaterTop: number | null = null
    let velWaterTop = 0

    const onMove = (e: PointerEvent): void => {
      const refs = refsRef.current
      if (refs === null) {
        return
      }
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
      target.sheenX = 0
      ensureLoop()
    }

    // Triggered by LiquidFill when refs.waterTop changes. Restarts the rAF
    // loop so currentWaterTop can spring-chase the new target instead of
    // the React render snapping the sheen to the new level.
    const onWake = (): void => {
      ensureLoop()
    }

    const apply = (): void => {
      const refs = refsRef.current
      if (refs === null) {
        return
      }
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
      // Use the spring-animated currentWaterTop so the sheen tracks the 500ms
      // CSS transition on pct changes instead of snapping to the new level.
      const animatedTop = currentWaterTop ?? refs.waterTop
      refs.sheen.setAttribute('cy', (animatedTop + cur.lift - 0.3).toFixed(2))

      refs.sheen.setAttribute('fill-opacity', (cur.sheenA * 0.55).toFixed(3))
    }

    const clearInline = (): void => {
      // Reset closure state unconditionally — these aren't tied to refs.
      active = false
      // Re-sync so the next attach starts from the correct instantaneous waterTop.
      currentWaterTop = null
      velWaterTop = 0

      const refs = refsRef.current
      if (refs === null) {
        return
      }
      refs.slosh.removeAttribute('data-interactive')
      refs.slosh.style.transform = ''
      // transformOrigin is intentionally NOT cleared here. React owns that
      // inline style via JSX style={{ transformOrigin }} on the <g> element.
      // React's virtual-DOM diff compares virtual-DOM-to-virtual-DOM, so after
      // clearInline clears the inline style React never re-writes it on
      // subsequent renders — the SVG <g> falls back to its default origin (0 0)
      // and the ambient slosh keyframe rotates around the wrong pivot until the
      // next hover.
      refs.waveAShift.style.transform = ''
      refs.waveBShift.style.transform = ''
      refs.waveAAnim.style.animationDuration = ''
      refs.waveBAnim.style.animationDuration = ''
      refs.sheen.setAttribute('fill-opacity', '0')
    }

    function ensureLoop(): void {
      if (rafId !== null) {
        return
      }
      lastT = performance.now()

      const step = (t: number): void => {
        const dt = Math.max(0, Math.min(0.05, (t - lastT) / 1000))
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

        // Spring-animate currentWaterTop toward refs.waterTop using the same
        // critically-damped spring (omega w) so the sheen smoothly follows the
        // 500ms CSS transition on pct changes instead of snapping instantly.
        const refsNow = refsRef.current
        if (refsNow !== null) {
          currentWaterTop ??= refsNow.waterTop

          const aTop =
            -2 * w * velWaterTop - w * w * (currentWaterTop - refsNow.waterTop)
          velWaterTop += aTop * dt
          currentWaterTop += velWaterTop * dt
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
          Math.abs(cur.sheenX - target.sheenX) < 0.01 &&
          // Keep looping while waterTop is still chasing the CSS transition.
          // velWaterTop threshold prevents early termination mid-flight under
          // rapid pct changes (velocity ~12 px/s while position is within 0.02).
          (currentWaterTop === null ||
            refsRef.current === null ||
            (Math.abs(currentWaterTop - refsRef.current.waterTop) < 0.02 &&
              Math.abs(velWaterTop) < 0.1))

        const atRest =
          target.tilt === 0 &&
          target.amp === 1 &&
          target.shiftX === 0 &&
          target.lift === 0 &&
          target.skew === 0 &&
          target.speedT === 0 &&
          target.sheenA === 0 &&
          target.sheenX === 0
        if (settled) {
          if (atRest) {
            cur = initialTarget()
            vel = initialVel()
            clearInline()
          }
          rafId = null

          return
        }
        rafId = requestAnimationFrame(step)
      }
      rafId = requestAnimationFrame(step)
    }

    let attached = false

    const attach = (): void => {
      if (attached) {
        return
      }
      wrap.addEventListener('pointermove', onMove)
      wrap.addEventListener('pointerleave', onLeave)
      wrap.addEventListener('vfliquidwake', onWake)
      attached = true
    }

    const detach = (): void => {
      if (!attached) {
        return
      }
      wrap.removeEventListener('pointermove', onMove)
      wrap.removeEventListener('pointerleave', onLeave)
      wrap.removeEventListener('vfliquidwake', onWake)
      attached = false
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      rafId = null
      clearInline()
      // Reset spring state so the next attach starts from a clean slate.
      // Without this, a reduced-motion toggle OFF mid-hover would resume from
      // stale tilt/amp values and cause a visible 1-frame snap.
      cur = initialTarget()
      vel = initialVel()
      target.tilt = 0
      target.amp = 1
      target.shiftX = 0
      target.lift = 0
      target.skew = 0
      target.speedT = 0
      target.sheenX = 0
      target.sheenA = 0
    }

    const onMqlChange = (
      e: MediaQueryListEvent | { matches: boolean }
    ): void => {
      if (e.matches) {
        detach()
      } else {
        attach()
      }
    }
    mql.addEventListener('change', onMqlChange as EventListener)

    if (!mql.matches) {
      attach()
    }

    return (): void => {
      mql.removeEventListener('change', onMqlChange as EventListener)
      detach()
    }
    // Effect deps intentionally narrow: wrapRef and refsRef are stable
    // useRef objects (identity never changes); JSON.stringify(tune) covers
    // tune VALUE changes without churning on object identity. The effect
    // closure also reads refsRef.current internally — that's correct (it's
    // a ref, not a reactive value).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrapRef, refsRef, JSON.stringify(tune)])
}
