import type { ReactElement } from 'react'
import type { CostState, RateLimitsState } from '../types'
import { formatTokens } from '../utils/format'

export interface BudgetMetricsProps {
  cost: CostState | null
  rateLimits: RateLimitsState | null
  totalInputTokens: number
  totalOutputTokens: number
}

export const formatCost = (usd: number | null): string =>
  usd === null ? '—' : `$${usd.toFixed(2)}`

export const formatApiTime = (ms: number): string =>
  `${(ms / 1000).toFixed(1)}s`

const MetricCell = ({
  label,
  value,
  valueClassName = 'text-on-surface',
}: {
  label: string
  value: string
  valueClassName?: string
}): ReactElement => (
  <div className="flex flex-col gap-1 rounded-lg bg-surface-container px-2.5 py-2">
    <span className="text-[8px] font-bold uppercase tracking-[0.08em] text-outline">
      {label}
    </span>
    <span className={`font-mono text-sm font-semibold ${valueClassName}`}>
      {value}
    </span>
  </div>
)

const RateLimitBar = ({
  label,
  percentage,
}: {
  label: string
  percentage: number
}): ReactElement => (
  <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between">
      <span className="text-[8px] font-bold uppercase tracking-[0.08em] text-outline">
        {label}
      </span>
      <span className="font-mono text-[10px] font-semibold text-on-surface">
        {Math.round(percentage)}%
      </span>
    </div>
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-surface">
      <div
        className="h-full rounded-full bg-primary-container"
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />
    </div>
  </div>
)

const SubscriberVariant = ({
  cost,
  rateLimits,
  totalInputTokens,
  totalOutputTokens,
}: {
  cost: CostState | null
  rateLimits: RateLimitsState
  totalInputTokens: number
  totalOutputTokens: number
}): ReactElement => (
  <div className="flex flex-col gap-2">
    <RateLimitBar
      label="5h Limit"
      percentage={rateLimits.fiveHour.usedPercentage}
    />
    {rateLimits.sevenDay ? (
      <RateLimitBar
        label="7d Limit"
        percentage={rateLimits.sevenDay.usedPercentage}
      />
    ) : null}
    <div className="grid grid-cols-2 gap-2">
      <MetricCell
        label="API Time"
        value={formatApiTime(cost?.totalApiDurationMs ?? 0)}
      />
      <MetricCell
        label="Tokens"
        value={formatTokens(totalInputTokens + totalOutputTokens)}
      />
    </div>
  </div>
)

const ApiKeyVariant = ({
  cost,
  totalInputTokens,
  totalOutputTokens,
}: {
  cost: CostState
  totalInputTokens: number
  totalOutputTokens: number
}): ReactElement => (
  <div className="grid grid-cols-2 gap-2">
    <MetricCell
      label="Cost"
      value={formatCost(cost.totalCostUsd)}
      valueClassName="text-primary"
    />
    <MetricCell
      label="API Time"
      value={formatApiTime(cost.totalApiDurationMs)}
    />
    <MetricCell label="Tokens In" value={formatTokens(totalInputTokens)} />
    <MetricCell label="Tokens Out" value={formatTokens(totalOutputTokens)} />
  </div>
)

const FallbackVariant = ({
  totalInputTokens,
  totalOutputTokens,
}: {
  totalInputTokens: number
  totalOutputTokens: number
}): ReactElement => (
  <div className="grid grid-cols-2 gap-2">
    <MetricCell label="Tokens In" value={formatTokens(totalInputTokens)} />
    <MetricCell label="Tokens Out" value={formatTokens(totalOutputTokens)} />
  </div>
)

export const BudgetMetrics = ({
  cost,
  rateLimits,
  totalInputTokens,
  totalOutputTokens,
}: BudgetMetricsProps): ReactElement => {
  if (rateLimits) {
    return (
      <SubscriberVariant
        cost={cost}
        rateLimits={rateLimits}
        totalInputTokens={totalInputTokens}
        totalOutputTokens={totalOutputTokens}
      />
    )
  }

  if (cost) {
    return (
      <ApiKeyVariant
        cost={cost}
        totalInputTokens={totalInputTokens}
        totalOutputTokens={totalOutputTokens}
      />
    )
  }

  return (
    <FallbackVariant
      totalInputTokens={totalInputTokens}
      totalOutputTokens={totalOutputTokens}
    />
  )
}
