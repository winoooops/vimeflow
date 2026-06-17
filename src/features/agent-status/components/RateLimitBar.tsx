import type { ReactElement } from 'react'
import { ProgressBar, type ProgressBarTone } from '@/components/ProgressBar'

// `kimi` recolors the fill to the kimi peach accent for the plan-usage gate;
// `primary` (default) keeps the Claude/Codex look unchanged.
export type RateLimitBarAccent = 'primary' | 'kimi'

export interface RateLimitBarProps {
  label: string
  percentage: number
  accent?: RateLimitBarAccent
}

const FILL_TONE: Record<RateLimitBarAccent, ProgressBarTone> = {
  primary: 'primary',
  kimi: 'kimi',
}

// Label + percentage + a thin progress bar. Shared by the agent-status budget
// metrics and the sidebar AgentStatusCard so the 5-hour / weekly usage bars
// look identical in both surfaces.
export const RateLimitBar = ({
  label,
  percentage,
  accent = 'primary',
}: RateLimitBarProps): ReactElement => (
  <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-on-surface-muted">
        {label}
      </span>
      <span className="font-mono text-[10px] font-semibold text-on-surface">
        {Math.round(percentage)}%
      </span>
    </div>
    <ProgressBar
      label={label}
      value={percentage}
      tone={FILL_TONE[accent]}
      height="thin"
      fillTestId="rate-limit-bar-fill"
      className="h-[3px] w-full overflow-hidden rounded-full bg-surface"
    />
  </div>
)
