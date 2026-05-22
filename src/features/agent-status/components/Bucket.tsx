import { type ReactElement } from 'react'
import { LiquidFill } from './LiquidFill'

export interface BucketProps {
  pct: number
  color: string
  label: string
  title?: string
}

export const Bucket = ({
  pct,
  color,
  label,
  title = '',
}: BucketProps): ReactElement => {
  const clamped = Math.max(0, Math.min(100, pct))
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

      <LiquidFill
        mode="bar"
        pct={clamped}
        color={color}
        testId={`bucket-${labelKey}-svg`}
      />

      <span
        data-testid={`bucket-${labelKey}-label`}
        className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.18em] text-on-surface-muted"
      >
        {label}
      </span>
    </div>
  )
}
