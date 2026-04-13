import type { ReactElement } from 'react'
import type { RecentToolCall } from '../types'
import { CollapsibleSection } from './CollapsibleSection'

interface RecentToolCallsProps {
  calls: RecentToolCall[]
}

const formatCallDuration = (ms: number | null): string | null => {
  if (ms == null) {
    return null
  }

  if (ms < 1000) {
    return `${ms}ms`
  }

  return `${(ms / 1000).toFixed(1)}s`
}

export const RecentToolCalls = ({
  calls,
}: RecentToolCallsProps): ReactElement => (
  <CollapsibleSection title="Recent" count={calls.length}>
    <div className="flex flex-col gap-2">
      {calls.map((call) => (
        <div key={call.id} className="flex items-start gap-2">
          <span
            className={call.status === 'done' ? 'text-success' : 'text-error'}
            aria-label={call.status === 'done' ? 'success' : 'failed'}
          >
            {call.status === 'done' ? '✓' : '✗'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-on-surface-variant">
                {call.tool}
              </span>
              {formatCallDuration(call.durationMs) && (
                <span className="font-mono text-[9px] text-outline">
                  {formatCallDuration(call.durationMs)}
                </span>
              )}
            </div>
            {call.args && (
              <p className="truncate font-mono text-[9px] text-outline">
                {call.args}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  </CollapsibleSection>
)
