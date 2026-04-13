import type { ReactElement } from 'react'
import { useAgentStatus } from '../hooks/useAgentStatus'
import { StatusCard } from './StatusCard'
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
      {status.isActive && status.agentType ? (
        <div className="flex flex-col gap-2 p-2">
          <StatusCard
            agentType={status.agentType}
            modelId={status.modelId}
            modelDisplayName={status.modelDisplayName}
            status="running"
            cost={status.cost}
            rateLimits={status.rateLimits}
            totalInputTokens={status.contextWindow?.totalInputTokens ?? 0}
            totalOutputTokens={status.contextWindow?.totalOutputTokens ?? 0}
          />
          <ContextBucket
            usedPercentage={status.contextWindow?.usedPercentage ?? null}
            contextWindowSize={status.contextWindow?.contextWindowSize ?? 200_000}
            totalInputTokens={status.contextWindow?.totalInputTokens ?? 0}
            totalOutputTokens={status.contextWindow?.totalOutputTokens ?? 0}
          />
          {/* ToolCallSummary + sections — sub-spec 7 */}
        </div>
      ) : null}
    </div>
  )
}

export default AgentStatusPanel
