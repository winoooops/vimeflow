import { useEffect, useId, useMemo, useRef, type ReactElement } from 'react'
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
}

const BAR_DIMS = { w: 22, h: 110 } as const

const TICK_LEVELS = [25, 50, 75] as const

const buildWavePath = (
  width: number,
  amp: number,
  totalH: number,
  phase: number
): string => {
  // 2 full cycles across the path's width — matches the prior segment count.
  const cycles = 2
  // 32 line segments give smooth waves at our render sizes (22–~240 px wide).
  const segments = 32
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
  className = undefined,
  testId = undefined,
  tune = undefined,
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
