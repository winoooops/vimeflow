import type { ReactElement } from 'react'

export interface BucketProps {
  pct: number
  color: string
  label: string
  uid: string
  title?: string
}

interface Dims {
  w: number
  h: number
}

const DIMS: Dims = { w: 22, h: 110 }
const TICK_LEVELS = [25, 50, 75] as const

export const Bucket = ({
  pct,
  color,
  label,
  uid,
  title = '',
}: BucketProps): ReactElement => {
  const clamped = Math.max(0, Math.min(100, pct))
  const fillId = `bucket-fill-${uid}`
  const glassId = `bucket-glass-${uid}`
  const clipId = `bucket-clip-${uid}`
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

      <svg
        width={DIMS.w}
        height={DIMS.h}
        viewBox={`0 0 ${DIMS.w} ${DIMS.h}`}
        className="block"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.85" />
            <stop offset="100%" stopColor={color} stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id={glassId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(255,255,255,0.06)" />
            <stop offset="40%" stopColor="rgba(255,255,255,0.02)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.15)" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect
              x="1"
              y="2"
              width={DIMS.w - 2}
              height={DIMS.h - 3}
              rx="3"
              ry="3"
            />
          </clipPath>
        </defs>

        <rect
          x="1"
          y="2"
          width={DIMS.w - 2}
          height={DIMS.h - 3}
          rx="3"
          ry="3"
          fill={`url(#${glassId})`}
        />

        <g clipPath={`url(#${clipId})`}>
          <BucketLiquid
            dims={DIMS}
            pct={clamped}
            color={color}
            fillUrl={`url(#${fillId})`}
          />
          {TICK_LEVELS.map((t) => {
            const y = DIMS.h - (DIMS.h - 4) * (t / 100)

            return (
              <g key={t} data-testid={`bucket-tick-${t}`}>
                <line
                  x1="1"
                  x2="4"
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.18)"
                  strokeWidth="0.8"
                />
                <line
                  x1={DIMS.w - 4}
                  x2={DIMS.w - 1}
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
          width={DIMS.w - 2}
          height={DIMS.h - 3}
          rx="3"
          ry="3"
          fill="transparent"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="1"
        />
      </svg>

      <span
        data-testid={`bucket-${labelKey}-label`}
        className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.18em] text-on-surface-muted"
      >
        {label}
      </span>
    </div>
  )
}

interface BucketLiquidProps {
  dims: Dims
  pct: number
  color: string
  fillUrl: string
}

const BucketLiquid = ({
  dims,
  pct,
  color,
  fillUrl,
}: BucketLiquidProps): ReactElement | null => {
  if (pct <= 0) {
    return null
  }

  const liquidH = (dims.h - 4) * (pct / 100)
  const top = dims.h - liquidH
  const amp = Math.min(1.8, dims.w * 0.09)
  const wavePath = buildWavePath(dims.w * 2, amp, dims.h)

  return (
    <g
      className="vf-bucket-slosh"
      data-testid="bucket-liquid"
      style={{ transformOrigin: `${dims.w / 2}px ${dims.h}px` }}
    >
      <rect
        x={0}
        y={top + amp}
        width={dims.w}
        height={dims.h - (top + amp)}
        fill={fillUrl}
      />
      <g style={{ transform: `translateY(${top - amp / 2}px)` }}>
        <g className="vf-bucket-wave-a">
          <path d={wavePath} fill={color} fillOpacity="0.55" />
        </g>
      </g>
      <g style={{ transform: `translateY(${top}px)` }}>
        <g className="vf-bucket-wave-b">
          <path d={wavePath} fill={fillUrl} fillOpacity="0.95" />
        </g>
      </g>
      <line
        x1="2"
        x2={dims.w - 2}
        y1={top + 0.5}
        y2={top + 0.5}
        stroke={color}
        strokeWidth="1.1"
        strokeOpacity="0.85"
      />
    </g>
  )
}

const buildWavePath = (width: number, amp: number, totalH: number): string => {
  const wavelength = width / 2
  const segments = Math.ceil((width / wavelength) * 4)
  const step = width / segments
  let d = `M 0,${amp}`

  for (let i = 1; i <= segments; i++) {
    const x = step * i
    const cp1x = step * (i - 1) + step / 2
    const cp2x = step * i - step / 2
    const targetY = i % 2 === 0 ? amp : 0
    const startY = (i - 1) % 2 === 0 ? amp : 0

    d += ` C ${cp1x},${startY} ${cp2x},${targetY} ${x},${targetY}`
  }
  d += ` L ${width},${totalH} L 0,${totalH} Z`

  return d
}
