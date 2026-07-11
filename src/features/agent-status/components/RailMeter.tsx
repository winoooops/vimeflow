import { type ReactElement } from 'react'
import { Tooltip } from '@/components/Tooltip'
import { LiquidFill } from './LiquidFill'

export interface RailMeterProps {
  pct: number
  color: string
  label: string
  tooltip?: string
}

// Collapsed-rail gauge: a compact vertical liquid meter (CONTEXT / CACHE).
// Exposed to assistive tech as role="meter" with the label as its name; the
// `LiquidFill` SVG is decorative presentation of the same value.
export const RailMeter = ({
  pct,
  color,
  label,
  tooltip = '',
}: RailMeterProps): ReactElement => {
  const clamped = Math.max(0, Math.min(100, pct))

  return (
    <Tooltip content={tooltip} placement="left" nativeOverlay>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        className="flex flex-col items-center gap-1"
      >
        <div className="font-display text-[14px] font-semibold leading-none tabular-nums tracking-tight text-on-surface">
          {Math.round(clamped)}
          <span className="ml-px text-[12px]" style={{ color }}>
            %
          </span>
        </div>

        <LiquidFill mode="bar" pct={clamped} color={color} />

        <span className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.18em] text-on-surface-muted">
          {label}
        </span>
      </div>
    </Tooltip>
  )
}
