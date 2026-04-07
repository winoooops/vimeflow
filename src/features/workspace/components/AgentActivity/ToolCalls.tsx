import type { ReactElement } from 'react'
import { useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import type { ToolCall } from '../../types'

interface ToolCallsProps {
  toolCalls: ToolCall[]
}

const ToolCalls = ({ toolCalls }: ToolCallsProps): ReactElement => {
  const [isExpanded, setIsExpanded] = useState(false)

  const getStatusIcon = (
    status: ToolCall['status']
  ): { symbol: string; className: string } => {
    switch (status) {
      case 'done':
        return { symbol: '✓', className: 'text-success' }
      case 'running':
        return { symbol: '⟳', className: 'text-secondary' }
      case 'failed':
        return { symbol: '✗', className: 'text-error' }
    }
  }

  return (
    <CollapsibleSection
      title="Tool Calls"
      count={toolCalls.length}
      isExpanded={isExpanded}
      onToggle={(): void => setIsExpanded(!isExpanded)}
    >
      <div data-testid="tool-calls-list" className="flex flex-col gap-1">
        {toolCalls.map((call) => {
          const { symbol, className } = getStatusIcon(call.status)

          return (
            <div
              key={call.id}
              data-testid="tool-call-entry"
              className="flex items-center gap-2 font-label"
            >
              <span data-testid="status-icon" className={className}>
                {symbol}
              </span>
              <span className="text-on-surface">{call.tool}</span>
              <span className="text-on-surface/60 flex-1">{call.args}</span>
            </div>
          )
        })}
      </div>
    </CollapsibleSection>
  )
}

export default ToolCalls
