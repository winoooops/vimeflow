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

export const useWaterCursor = (
  wrapRef: RefObject<HTMLElement | null>,
  refsRef: RefObject<LiquidRefs | null>,
  tune: Partial<LiquidTune> = {}
): void => {
  useEffect(() => {
    const wrap = wrapRef.current

    if (wrap === null) {
      return
    }

    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')

    if (mql.matches) {
      return
    }

    const onMove = (_e: PointerEvent): void => {
      void _e
      void tune
      void refsRef
    }

    // placeholder — full spring loop added in Task 3
    const onLeave = (_e: PointerEvent): void => {
      void _e
    }

    wrap.addEventListener('pointermove', onMove)
    wrap.addEventListener('pointerleave', onLeave)

    return (): void => {
      wrap.removeEventListener('pointermove', onMove)
      wrap.removeEventListener('pointerleave', onLeave)
    }
  }, [wrapRef, refsRef, tune])
}
