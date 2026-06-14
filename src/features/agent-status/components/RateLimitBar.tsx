import type { ReactElement } from 'react'

// `kimi` recolors the fill to the kimi peach accent for the plan-usage gate;
// `primary` (default) keeps the Claude/Codex look unchanged.
export type RateLimitBarAccent = 'primary' | 'kimi'

export interface RateLimitBarProps {
  label: string
  percentage: number
  accent?: RateLimitBarAccent
}

const FILL_CLASS: Record<RateLimitBarAccent, string> = {
  primary: 'bg-primary-container',
  kimi: 'bg-[var(--color-agent-kimi-accent)]',
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
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.min(Math.max(Math.round(percentage), 0), 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-[3px] w-full overflow-hidden rounded-full bg-surface"
    >
      <div
        data-testid="rate-limit-bar-fill"
        className={`h-full rounded-full ${FILL_CLASS[accent]}`}
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />
    </div>
  </div>
)
