import type { ReactElement } from 'react'

export interface RateLimitBarProps {
  label: string
  percentage: number
}

// Label + percentage + a thin progress bar. Shared by the agent-status budget
// metrics and the sidebar AgentStatusCard so the 5-hour / weekly usage bars
// look identical in both surfaces.
export const RateLimitBar = ({
  label,
  percentage,
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
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-surface">
      <div
        data-testid="rate-limit-bar-fill"
        className="h-full rounded-full bg-primary-container"
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />
    </div>
  </div>
)
