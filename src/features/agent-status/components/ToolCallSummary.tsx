import type { ReactElement } from 'react'
import type { ActiveToolCall } from '../types'

interface ToolCallSummaryProps {
  total: number
  byType: Record<string, number>
  active: ActiveToolCall | null
}

export const ToolCallSummary = ({
  total,
  byType,
  active,
}: ToolCallSummaryProps): ReactElement => {
  const sortedChips = Object.entries(byType).sort(([, a], [, b]) => b - a)

  return (
    <div className="border-t border-outline-variant/[0.08] px-5 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-outline">
          Tool Calls
        </span>
        <span className="font-mono text-[10px] text-outline">{total}</span>
      </div>

      {sortedChips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {sortedChips.map(([name, count]) => (
            <span
              key={name}
              className="rounded-md bg-surface-container-high px-2 py-1"
            >
              <span className="text-[9px] text-on-surface-variant">{name}</span>{' '}
              <span className="font-mono text-[9px] font-semibold text-primary">
                {count}
              </span>
            </span>
          ))}
        </div>
      )}

      {active && (
        <div
          data-testid="active-tool-indicator"
          className="rounded border-l-2 border-success bg-success/[0.06] px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            <span className="text-[9px] text-success">Running</span>
            <span className="font-mono text-[9px] text-on-surface-variant">
              {active.tool}
            </span>
          </div>
          {active.args && (
            <p className="mt-1 truncate font-mono text-[9px] text-outline">
              {active.args}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
