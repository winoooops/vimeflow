import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import {
  useWaterCursor,
  type LiquidRefs,
  type LiquidTune,
} from '../hooks/useWaterCursor'

export interface LiquidFillProps {
  pct: number
  color: string
  mode: 'bar' | 'fill'
  ariaHidden?: boolean
  className?: string
  testId?: string
  tune?: Partial<LiquidTune>
  glow?: boolean
}

export const BAR_DIMS = { w: 22, h: 110 } as const

const TICK_LEVELS = [25, 50, 75] as const

const buildWavePath = (
  width: number,
  amp: number,
  totalH: number,
  phase: number
): string => {
  // 4 full cycles across the path width gives a spatial period of
  // width/4 = w/2 in user units (path width = w*2). This matches the
  // `translateX(-50%)` keyframe in src/index.css, which moves the wave
  // by w user units = exactly two periods, producing a seamless loop.
  // Changing cycles without changing the keyframe creates a visible
  // seam at every iteration.
  const cycles = 4
  // Scale segment count with width so each segment stays around 1.5 px wide.
  // Rail Bucket (width=44) → 48 segments (~0.9 px each); ContextBucket
  // (width=400 at a 200 px gauge) → ~267 segments (~1.5 px each). The cap
  // at 48 keeps small buckets smooth; the linear scaling keeps wide
  // gauges from looking polygonal.
  const segments = Math.max(48, Math.ceil(width / 1.5))
  const step = width / segments
  const phaseOffset = ((phase % 1) + 1) % 1

  const yAt = (x: number): number => {
    const t = (x / width + phaseOffset) * cycles

    return (amp * (1 - Math.cos(t * 2 * Math.PI))) / 2
  }

  let d = `M 0,${yAt(0).toFixed(4)}`
  for (let i = 1; i <= segments; i++) {
    const x = step * i
    d += ` L ${x.toFixed(4)},${yAt(x).toFixed(4)}`
  }
  d += ` L ${width.toFixed(4)},${totalH} L 0,${totalH} Z`

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

const applyBaseFloorClamp = (
  top: number,
  ambientAmp: number,
  h: number
): number => Math.min(top + ambientAmp + 0.5, h)

/**
 * Returns the y coordinate (in SVG user units) of the solid-fill body's
 * top edge for a given container size and percentage. Exported for
 * geometry assertions in consumer tests (e.g. ContextBucket.test.tsx).
 */
export const computeBaseFloor = (w: number, h: number, pct: number): number => {
  const clamped = Math.max(0, Math.min(100, pct))
  const liquidH = (h - 4) * (clamped / 100)
  const top = h - liquidH
  const ambientAmp = Math.min(1.8, w * 0.09)

  return applyBaseFloorClamp(top, ambientAmp, h)
}

const computeGeom = (w: number, h: number, pct: number): Geom => {
  const clamped = Math.max(0, Math.min(100, pct))
  const liquidH = (h - 4) * (clamped / 100)
  const top = h - liquidH
  const ambientAmp = Math.min(1.8, w * 0.09)
  const baseFloor = applyBaseFloorClamp(top, ambientAmp, h)
  // waveA at phase 0, waveB at phase 0.125. With cycles=4, the second
  // wave is shifted by 0.5 cycles (180°) relative to the first — the
  // maximum visible contrast that still preserves the seamless-loop
  // invariant (both paths have the same period).
  const wavePathA = buildWavePath(w * 2, ambientAmp, h, 0)
  const wavePathB = buildWavePath(w * 2, ambientAmp, h, 0.125)

  return { w, h, top, ambientAmp, baseFloor, wavePathA, wavePathB }
}

export const LiquidFill = ({
  pct,
  color,
  mode,
  ariaHidden = true,
  className = undefined,
  testId = undefined,
  tune = undefined,
  glow = false,
}: LiquidFillProps): ReactElement => {
  const reactId = useId().replace(/:/g, '')
  const fillId = `liquid-fill-${reactId}`
  const glassId = `liquid-glass-${reactId}`
  const sheenId = `liquid-sheen-${reactId}`
  const clipId = `liquid-clip-${reactId}`

  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(
    null
  )

  const { w, h } =
    mode === 'bar' ? BAR_DIMS : (measured ?? { w: BAR_DIMS.w, h: BAR_DIMS.h })
  const geom = useMemo(() => computeGeom(w, h, pct), [w, h, pct])

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const sloshRef = useRef<SVGGElement | null>(null)
  const waveAShiftRef = useRef<SVGGElement | null>(null)
  const waveBShiftRef = useRef<SVGGElement | null>(null)
  const waveAAnimRef = useRef<SVGGElement | null>(null)
  const waveBAnimRef = useRef<SVGGElement | null>(null)
  const sheenRef = useRef<SVGEllipseElement | null>(null)
  // Capture the initial sheen y. After mount, useWaterCursor owns the
  // cy attribute via setAttribute — React must NOT re-commit cy on
  // pct changes, or the sheen snaps to the new water level before
  // the spring can chase it.
  const initialSheenCyRef = useRef(geom.top)

  useEffect(() => {
    if (mode !== 'fill' || wrapRef.current === null) {
      return
    }

    const el = wrapRef.current

    const ro = new ResizeObserver((entries) => {
      if (entries.length === 0) {
        return
      }

      const { width, height } = entries[0].contentRect

      setMeasured({ w: Math.max(1, width), h: Math.max(1, height) })
    })

    ro.observe(el)

    return (): void => {
      ro.disconnect()
    }
  }, [mode])

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

    // Wake the cursor hook's rAF loop so currentWaterTop catches up to the
    // new waterTop — without this, a pct change after the hover spring has
    // settled would let the sheen snap to the new water level.
    wrapRef.current?.dispatchEvent(new Event('vfliquidwake'))
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
        width={mode === 'bar' ? w : (measured?.w ?? '100%')}
        height={mode === 'bar' ? h : (measured?.h ?? '100%')}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio={mode === 'bar' ? 'xMidYMid meet' : 'none'}
        aria-hidden={ariaHidden ? 'true' : undefined}
        style={{
          overflow: 'visible',
          display: 'block',
          visibility:
            mode === 'fill' && measured === null ? 'hidden' : undefined,
          ...(glow
            ? {
                filter: `drop-shadow(0 -4px 8px color-mix(in srgb, ${color} 25%, transparent))`,
              }
            : {}),
        }}
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
            {geom.top < geom.h && (
              <>
                <g
                  data-testid="liquid-water-y-base"
                  style={{
                    transform: `translateY(${geom.baseFloor}px)`,
                    transition: 'transform 500ms ease',
                  }}
                >
                  <rect
                    data-testid="liquid-base"
                    x={0}
                    y={0}
                    width={w}
                    height={Math.max(0, h - geom.baseFloor)}
                    fill={`url(#${fillId})`}
                  />
                </g>

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
                      <path
                        d={geom.wavePathA}
                        fill={color}
                        fillOpacity="0.55"
                      />
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
                  cy={initialSheenCyRef.current}
                  rx={Math.max(3, w * 0.27)}
                  ry="0.8"
                  fill={`url(#${sheenId})`}
                  fillOpacity="0"
                />
              </>
            )}
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
