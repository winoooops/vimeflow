import { useId, useState, type ReactElement } from 'react'

export interface SparklineProps {
  data: number[]
  color: string
}

// Nearest reading index for a cursor offset within a width-w scrub track.
export const nearestSparkIndex = (
  offsetX: number,
  width: number,
  length: number
): number => {
  if (length <= 1 || width <= 0) {
    return 0
  }
  const i = Math.round((offsetX / width) * (length - 1))

  return Math.max(0, Math.min(length - 1, i))
}

const JETBRAINS = "'JetBrains Mono', monospace"

export const Sparkline = ({ data, color }: SparklineProps): ReactElement => {
  const gradientId = useId()
  const [hover, setHover] = useState<number | null>(null)

  if (data.length === 0) {
    return (
      <div
        data-testid="token-cache-sparkline-empty"
        className="grid h-full w-full place-items-center text-[10px] text-outline-variant"
        style={{ fontFamily: JETBRAINS }}
      >
        no data yet
      </div>
    )
  }

  const w = 100
  const h = 36
  const max = Math.max(100, ...data)
  const min = Math.max(0, Math.min(...data) - 10)
  const span = Math.max(1, max - min)
  const step = data.length > 1 ? w / (data.length - 1) : w

  const pts = data.map((v, i) => {
    const x = i * step
    const y = h - ((v - min) / span) * (h - 6) - 3

    return [x, y] as const
  })

  const linePath = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')
  const fillPath = `${linePath} L${w},${h} L0,${h} Z`

  const activeIndex = hover ?? data.length - 1
  const [ax, ay] = pts[activeIndex]
  const chipAnchor = ax < 14 ? '0' : ax > 86 ? '-100%' : '-50%'

  return (
    <div className="relative h-full w-full">
      <svg
        data-testid="token-cache-sparkline"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="block h-full w-full cursor-crosshair"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setHover(
            nearestSparkIndex(e.clientX - rect.left, rect.width, data.length)
          )
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillPath} fill={`url(#${gradientId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {hover !== null ? (
          <line
            x1={ax}
            y1={0}
            x2={ax}
            y2={h}
            stroke={color}
            strokeWidth="1"
            strokeOpacity="0.45"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <circle cx={ax} cy={ay} r="3.5" fill={color} fillOpacity="0.25" />
        <circle cx={ax} cy={ay} r="1.8" fill={color} />
      </svg>
      {hover !== null ? (
        <div
          data-testid="token-cache-sparkline-value"
          className="pointer-events-none absolute -top-0.5 rounded px-1 text-[10px] font-semibold tabular-nums"
          style={{
            left: `${ax}%`,
            transform: `translateX(${chipAnchor})`,
            fontFamily: JETBRAINS,
            color,
            background:
              'color-mix(in srgb, var(--color-surface-container-lowest) 90%, transparent)',
            border: `1px solid ${color}40`,
          }}
        >
          {data[hover]}%
        </div>
      ) : null}
    </div>
  )
}
