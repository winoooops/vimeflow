import type { ReactElement } from 'react'
import { CollapsibleSection } from './CollapsibleSection'
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
    <CollapsibleSection title="Tool Calls" count={total} defaultExpanded>
      {sortedChips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {sortedChips.map(([name, count]) => (
            <span
              key={name}
              title={name}
              className="inline-flex max-w-[10rem] items-center gap-1.5 rounded-md bg-surface-container-high px-2 py-0.5"
            >
              <span className="truncate text-[9px] leading-none text-on-surface-variant">
                {name}
              </span>
              <span className="shrink-0 font-mono text-[9px] font-semibold leading-none text-primary">
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
    </CollapsibleSection>
  )
}
