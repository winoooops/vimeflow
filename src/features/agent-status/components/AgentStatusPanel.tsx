import type { ReactElement } from 'react'
import { useAgentStatus } from '../hooks/useAgentStatus'
import { ContextBucket } from './ContextBucket'

interface AgentStatusPanelProps {
  sessionId: string | null
}

export const AgentStatusPanel = ({
  sessionId,
}: AgentStatusPanelProps): ReactElement => {
  const status = useAgentStatus(sessionId)

  return (
    <div
      data-testid="agent-status-panel"
      className="h-full overflow-hidden bg-surface-container"
      style={{
        width: status.isActive ? '280px' : '0px',
        transition: status.isActive
          ? 'width 200ms ease-in'
          : 'width 200ms ease-out',
      }}
    >
      {/* StatusCard + BudgetMetrics — sub-spec 5 */}
      <div className="space-y-3 p-3">
        <ContextBucket
          usedPercentage={status.contextWindow?.usedPercentage ?? null}
          contextWindowSize={status.contextWindow?.contextWindowSize ?? 200_000}
          totalInputTokens={status.contextWindow?.totalInputTokens ?? 0}
          totalOutputTokens={status.contextWindow?.totalOutputTokens ?? 0}
        />
      </div>
      {/* ToolCallSummary + sections — sub-spec 7 */}
    </div>
  )
}

export default AgentStatusPanel
