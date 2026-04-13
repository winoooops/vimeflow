import type { ReactElement } from 'react'
import { useAgentStatus } from '../hooks/useAgentStatus'

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
      {/* ContextBucket — sub-spec 6 */}
      {/* ToolCallSummary + sections — sub-spec 7 */}
    </div>
  )
}

export default AgentStatusPanel
