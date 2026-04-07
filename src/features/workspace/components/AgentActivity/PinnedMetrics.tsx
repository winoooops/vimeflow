import type { ReactElement } from 'react'
import type { AgentActivity } from '../../types'

interface PinnedMetricsProps {
  activity: AgentActivity
}

const PinnedMetrics = ({ activity }: PinnedMetricsProps): ReactElement => {
  const { contextWindow, usage } = activity

  const rawPercentage =
    usage.messages.limit > 0
      ? (usage.messages.sent / usage.messages.limit) * 100
      : 0
  const usagePercentage = Math.min(rawPercentage, 100)

  return (
    <div
      data-testid="pinned-metrics"
      className="flex flex-col gap-3 font-label"
    >
      {/* Context Window Indicator */}
      <div
        data-testid="context-window-indicator"
        className="flex items-center gap-2 text-sm text-on-surface/60"
      >
        <span className="text-base">{contextWindow.emoji}</span>
        <span>Context</span>
      </div>

      {/* 5-Hour Usage */}
      <div className="flex flex-col gap-1">
        <div
          data-testid="usage-display"
          className="flex items-center justify-between text-sm"
        >
          <span className="text-on-surface">
            {usage.messages.sent} / {usage.messages.limit}
          </span>
          <span className="text-xs text-on-surface/60">messages</span>
        </div>

        {/* Progress Bar */}
        <div
          data-testid="usage-progress-bar"
          className="h-1 rounded-full bg-surface-container"
        >
          <div
            data-testid="usage-progress-fill"
            className="h-full rounded-full bg-gradient-to-r from-primary-container to-primary"
            style={{ width: `${usagePercentage}%` }}
          />
        </div>
      </div>
    </div>
  )
}

export default PinnedMetrics
