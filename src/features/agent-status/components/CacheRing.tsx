import type { ReactElement } from 'react'
import { Tooltip } from '@/components/Tooltip'

export interface CacheRingProps {
  pct: number
  color: string
}

const SIZE = 30
const STROKE = 3.5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

// Collapsed-rail cache hit-rate gauge. Cache is a *ratio* (higher = better),
// so it reads as a donut ring — a deliberately different shape from the CTX
// liquid bar directly above it, which is a *level* (fuller = worse). The
// rounded percent sits in the middle; the "%" sign is dropped because the ring
// shape already signals "rate", and the meaning is carried by the tooltip.
// Exposed to assistive tech as role="meter"; the SVG is decorative.
export const CacheRing = ({ pct, color }: CacheRingProps): ReactElement => {
  const clamped = Math.max(0, Math.min(100, pct))
  const rounded = Math.round(clamped)
  const offset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE

  return (
    <Tooltip
      content={`Current cache rate: ${rounded}%`}
      placement="left"
      nativeOverlay
    >
      <div
        role="meter"
        aria-label="CACHE"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        className="relative"
        style={{ width: SIZE, height: SIZE }}
      >
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          aria-hidden="true"
          className="block"
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="color-mix(in srgb, var(--color-outline-variant) 45%, transparent)"
            strokeWidth={STROKE}
          />
          <circle
            data-testid="cache-ring-arc"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            style={{
              filter: `drop-shadow(0 0 3px color-mix(in srgb, ${color} 53%, transparent))`,
              transition: 'stroke-dashoffset 360ms ease',
            }}
          />
        </svg>

        <span className="absolute inset-0 grid place-items-center font-display text-[9.5px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-on-surface">
          {rounded}
        </span>
      </div>
    </Tooltip>
  )
}
