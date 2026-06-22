import { useEffect, type RefObject } from 'react'

export interface ReservoirSurfaceRefs {
  /** The filled water body (surface down to a flat floor). */
  fill: SVGPathElement
  /** The bright crest line tracing the surface. */
  meniscus: SVGPathElement
}

export interface ReservoirGeom {
  /** Waterline y (user units) for the current fill. */
  level: number
  /** Tank height (user units) — the fill always closes flat to this floor. */
  height: number
}

/**
 * Hover "swell" flavor — how the water rises toward the cursor. Three are
 * available; `soft-mound` is the default. A future user setting will let people
 * pick among them (see Linear VIM-128); today the `WaterTank` `swell` prop just
 * defaults and nothing wires it.
 */
export type SwellVariant = 'soft-mound' | 'trailing' | 'wide-lift'

interface SwellPreset {
  /** Gaussian half-width of the mound (user units). */
  width: number
  /** Peak rise under the cursor at full hover (user units). */
  peakAmp: number
  /** Per-second easing of the mound's horizontal follow (higher = snappier). */
  followEase: number
  /** Per-second easing of the rise/fall. */
  ampEase: number
}

export const SWELL_PRESETS: Record<SwellVariant, SwellPreset> = {
  // A single soft mound that follows the cursor closely (default).
  'soft-mound': { width: 30, peakAmp: 8, followEase: 12, ampEase: 6 },
  // The mound lags behind the cursor, giving a sense of mass / inertia.
  trailing: { width: 30, peakAmp: 8, followEase: 4.5, ampEase: 6 },
  // A broad, low rise instead of a focused peak — the calmest.
  'wide-lift': { width: 64, peakAmp: 5, followEase: 9, ampEase: 5 },
}

export const resolveSwellVariant = (value: string): SwellVariant =>
  value in SWELL_PRESETS ? (value as SwellVariant) : 'soft-mound'

const TANK_WIDTH = 248
const TAU = Math.PI * 2
// Two surface components summed into one waterline: fast front ripples + a
// broad slow swell. Both wavelengths divide the width so the endpoints stay
// equal (no seam) regardless of phase.
const WL_FRONT = TANK_WIDTH / 2
const WL_BACK = TANK_WIDTH
const AMP_FRONT = 5
const AMP_BACK = 7
const STEP = 4
// Base drift: phase advances ~0.7 rad/s — a calm, always-on flow.
const BASE_RATE = 0.7
const LEVEL_EASE_PER_SECOND = 4

/**
 * Builds the surface path. A Gaussian mound of height `swellAmp` centred at
 * `swellX` (width `swellWidth`) lifts the waterline toward the cursor while the
 * fill still closes flat to the floor (`height`). Exported so the component can
 * paint a resting first frame.
 */
export const buildReservoirSurface = (
  level: number,
  height: number,
  phase: number,
  swellAmp: number,
  swellX: number,
  swellWidth: number
): { fill: string; crest: string } => {
  let crest = ''
  for (let x = 0; x <= TANK_WIDTH; x += STEP) {
    const mound = swellAmp * Math.exp(-Math.pow((x - swellX) / swellWidth, 2))

    const y =
      level +
      Math.sin((x / WL_FRONT) * TAU + phase) * AMP_FRONT +
      Math.sin((x / WL_BACK) * TAU + phase * 0.7 + 0.9) * AMP_BACK -
      mound
    crest += `${x === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(2)} `
  }

  return {
    crest: crest.trim(),
    fill: `${crest.trim()} L ${TANK_WIDTH} ${height} L 0 ${height} Z`,
  }
}

/**
 * Drives the reservoir's water: a calm always-on drift, plus a swell that rises
 * toward the cursor while the pointer is over `hoverRef` (shape per `variant`).
 * Redraws the surface each frame so the floor stays flat. The rAF loop runs only
 * while `active`, and is a no-op under `prefers-reduced-motion` (the component
 * paints a static resting surface).
 */
export const useReservoirFlow = (
  hoverRef: RefObject<Element | null>,
  refsRef: RefObject<ReservoirSurfaceRefs | null>,
  geomRef: RefObject<ReservoirGeom | null>,
  active: boolean,
  variant: SwellVariant = 'soft-mound'
): void => {
  useEffect(() => {
    if (!active) {
      return
    }
    const hoverEl = hoverRef.current
    if (hoverEl === null) {
      return
    }
    const preset = SWELL_PRESETS[variant]
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')

    let phase = 0
    let amp = 0
    let targetAmp = 0
    let swellX = TANK_WIDTH / 2
    let cursorX = TANK_WIDTH / 2
    let curLevel = geomRef.current?.level ?? 0
    let rafId: number | null = null
    let lastT = 0

    const step = (t: number): void => {
      const refs = refsRef.current
      const geom = geomRef.current
      if (refs === null || geom === null) {
        rafId = null

        return
      }
      const dt = Math.max(0, Math.min(0.05, (t - lastT) / 1000))
      lastT = t
      amp += (targetAmp - amp) * Math.min(1, dt * preset.ampEase)
      swellX += (cursorX - swellX) * Math.min(1, dt * preset.followEase)
      curLevel +=
        (geom.level - curLevel) * Math.min(1, dt * LEVEL_EASE_PER_SECOND)
      phase += BASE_RATE * dt

      const { fill, crest } = buildReservoirSurface(
        curLevel,
        geom.height,
        phase,
        amp,
        swellX,
        preset.width
      )
      refs.fill.setAttribute('d', fill)
      refs.meniscus.setAttribute('d', crest)

      rafId = requestAnimationFrame(step)
    }

    const start = (): void => {
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
      if (mql.matches) {
        return
      }
      targetAmp = preset.peakAmp
    }

    const onLeave = (): void => {
      targetAmp = 0
    }

    const onMove = (e: Event): void => {
      const r = hoverEl.getBoundingClientRect()
      const x = ((e as MouseEvent).clientX - r.left) / r.width
      cursorX = Math.max(0, Math.min(TANK_WIDTH, x * TANK_WIDTH))
    }

    const onMqlChange = (): void => {
      if (mql.matches) {
        stop()
        // Reset swell state to rest and paint the static resting surface
        // immediately. React no longer owns the `d` attributes, so the same
        // imperative owner must restore them when animation is disabled live.
        amp = 0
        targetAmp = 0
        swellX = TANK_WIDTH / 2
        cursorX = TANK_WIDTH / 2
        phase = 0
        const refs = refsRef.current
        const geom = geomRef.current
        if (refs !== null && geom !== null) {
          const { fill, crest } = buildReservoirSurface(
            geom.level,
            geom.height,
            0,
            0,
            TANK_WIDTH / 2,
            preset.width
          )
          refs.fill.setAttribute('d', fill)
          refs.meniscus.setAttribute('d', crest)
        }
      } else {
        start()
      }
    }

    hoverEl.addEventListener('pointerenter', onEnter)
    hoverEl.addEventListener('pointerleave', onLeave)
    hoverEl.addEventListener('pointermove', onMove)
    mql.addEventListener('change', onMqlChange)
    if (!mql.matches) {
      start()
    }

    return (): void => {
      hoverEl.removeEventListener('pointerenter', onEnter)
      hoverEl.removeEventListener('pointerleave', onLeave)
      hoverEl.removeEventListener('pointermove', onMove)
      mql.removeEventListener('change', onMqlChange)
      stop()
    }
  }, [hoverRef, refsRef, geomRef, active, variant])
}
