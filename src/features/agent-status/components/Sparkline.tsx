import { useId, type ReactElement } from 'react'

export interface SparklineProps {
  data: number[]
  color: string
}

export const Sparkline = ({ data, color }: SparklineProps): ReactElement => {
  const gradientId = useId()

  if (data.length === 0) {
    return (
      <div
        data-testid="token-cache-sparkline-empty"
        className="grid h-full w-full place-items-center text-[10px] text-outline-variant"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
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
  const last = pts[pts.length - 1]

  return (
    <svg
      data-testid="token-cache-sparkline"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="block h-full w-full"
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
      <circle cx={last[0]} cy={last[1]} r="1.8" fill={color} />
      <circle
        cx={last[0]}
        cy={last[1]}
        r="3.5"
        fill={color}
        fillOpacity="0.25"
      />
    </svg>
  )
}
