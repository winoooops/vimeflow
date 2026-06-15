import { useEffect, type RefObject } from 'react'

export interface ReservoirFlowRefs {
  front: SVGGElement
  back: SVGGElement
}

// Seamless wrap distance: the wave paths tile every tank width (the front 124u
// and back 248u wavelengths both divide it), so a boost offset taken modulo
// this is an invisible phase shift — the loop can freeze at any offset without
// a visible jump.
const WRAP = 248
// Extra drift (user units / second) added at full hover intensity, on top of
// the always-on CSS base drift. Tuned for a clear, obvious quickening on hover
// (~2.2x the base 6s/9s drift), eased in and out. Front ripples gain more than
// the broad back swell, preserving the parallax.
const FRONT_BOOST = WRAP / 5
const BACK_BOOST = WRAP / 7
// Per-second easing of the hover intensity (0..1) so the speed ramps in and
// out smoothly instead of stepping — the calm, natural feel of the old spring.
const EASE_PER_SECOND = 5
// Below this intensity, once the pointer has left, the boost is considered at
// rest and the rAF loop stops (offsets freeze at an invisible phase).
const REST_EPSILON = 0.002

/**
 * Eases a small extra water drift in while the pointer is over `hoverRef` and
 * back out when it leaves, by translating the boost groups in `refsRef`. The
 * always-on calm drift lives in CSS; this only adds the hover quickening, so
 * the rAF loop runs solely during a hover and its ease-out. No-op (and never
 * schedules rAF) under `prefers-reduced-motion`.
 */
export const useReservoirFlow = (
  hoverRef: RefObject<Element | null>,
  refsRef: RefObject<ReservoirFlowRefs | null>
): void => {
  useEffect(() => {
    const hoverEl = hoverRef.current
    if (hoverEl === null) {
      return
    }
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')

    let frontOffset = 0
    let backOffset = 0
    let intensity = 0
    let targetIntensity = 0
    let rafId: number | null = null
    let lastT = 0

    // Drive the boost via the SVG `transform` attribute (unambiguously user
    // units) rather than CSS px, so the offset stays in the tank's coordinate
    // space and wraps cleanly at one tank width.
    const place = (el: SVGGElement, offset: number): void => {
      el.setAttribute('transform', `translate(${(-offset).toFixed(2)} 0)`)
    }

    const step = (t: number): void => {
      const refs = refsRef.current
      if (refs === null) {
        // The water was removed (e.g. the context reset to unknown) while the
        // loop was running — stop instead of scheduling no-op frames forever.
        intensity = 0
        rafId = null

        return
      }
      const dt = Math.max(0, Math.min(0.05, (t - lastT) / 1000))
      lastT = t
      intensity +=
        (targetIntensity - intensity) * Math.min(1, dt * EASE_PER_SECOND)
      frontOffset = (frontOffset + FRONT_BOOST * intensity * dt) % WRAP
      backOffset = (backOffset + BACK_BOOST * intensity * dt) % WRAP
      place(refs.front, frontOffset)
      place(refs.back, backOffset)

      if (targetIntensity === 0 && intensity < REST_EPSILON) {
        rafId = null

        return
      }
      rafId = requestAnimationFrame(step)
    }

    const ensureLoop = (): void => {
      if (rafId !== null) {
        return
      }
      lastT = performance.now()
      rafId = requestAnimationFrame(step)
    }

    const stop = (): void => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    }

    const onEnter = (): void => {
      // Skip under reduced-motion, and when there is no water to drift (empty
      // tank) so a hover doesn't spin the loop for nothing.
      if (mql.matches || refsRef.current === null) {
        return
      }
      targetIntensity = 1
      ensureLoop()
    }

    const onLeave = (): void => {
      targetIntensity = 0
      ensureLoop()
    }

    const onMqlChange = (): void => {
      if (!mql.matches) {
        return
      }
      targetIntensity = 0
      intensity = 0
      stop()
      const refs = refsRef.current
      if (refs !== null) {
        refs.front.removeAttribute('transform')
        refs.back.removeAttribute('transform')
      }
    }

    hoverEl.addEventListener('pointerenter', onEnter)
    hoverEl.addEventListener('pointerleave', onLeave)
    mql.addEventListener('change', onMqlChange)

    return (): void => {
      hoverEl.removeEventListener('pointerenter', onEnter)
      hoverEl.removeEventListener('pointerleave', onLeave)
      mql.removeEventListener('change', onMqlChange)
      stop()
    }
  }, [hoverRef, refsRef])
}
