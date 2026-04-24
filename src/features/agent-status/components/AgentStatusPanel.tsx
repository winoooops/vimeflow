import type { ReactElement } from 'react'
import { useAgentStatus } from '../hooks/useAgentStatus'
import { StatusCard } from './StatusCard'
import { ContextBucket } from './ContextBucket'
import { ToolCallSummary } from './ToolCallSummary'
import { FilesChanged } from './FilesChanged'
import { TestResults } from './TestResults'
import { ActivityFooter } from './ActivityFooter'
import { ActivityFeed } from './ActivityFeed'
import { useActivityEvents } from '../hooks/useActivityEvents'

interface AgentStatusPanelProps {
  sessionId: string | null
}

const placeholderTests = { passed: 0, failed: 0, total: 0 }

export const AgentStatusPanel = ({
  sessionId,
}: AgentStatusPanelProps): ReactElement => {
  const status = useAgentStatus(sessionId)
  const events = useActivityEvents(status)

  return (
    <div
      data-testid="agent-status-panel"
      className="flex h-full flex-col overflow-hidden bg-surface-container"
      style={{
        width: status.isActive ? '280px' : '0px',
        transition: status.isActive
          ? 'width 200ms ease-in'
          : 'width 200ms ease-out',
      }}
    >
      {status.isActive && status.agentType ? (
        <>
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
              contextWindowSize={
                status.contextWindow?.contextWindowSize ?? 200_000
              }
              totalInputTokens={status.contextWindow?.totalInputTokens ?? 0}
              totalOutputTokens={status.contextWindow?.totalOutputTokens ?? 0}
            />
          </div>

          <div className="thin-scrollbar flex-1 overflow-y-auto">
            <ToolCallSummary
              total={status.toolCalls.total}
              byType={status.toolCalls.byType}
              active={status.toolCalls.active}
            />
            <ActivityFeed events={events} />
            <FilesChanged
              files={[]}
              error={null}
              onRetry={(): void => {
                // TODO: wire to git status refresh in Feature #12
              }}
              onSelect={(): void => {
                // TODO: wire to diff viewer in Feature #12
              }}
            />
            <TestResults
              passed={placeholderTests.passed}
              failed={placeholderTests.failed}
              total={placeholderTests.total}
            />
          </div>
          <ActivityFooter
            totalDurationMs={status.cost?.totalDurationMs ?? 0}
            turnCount={0}
            linesAdded={status.cost?.totalLinesAdded ?? 0}
            linesRemoved={status.cost?.totalLinesRemoved ?? 0}
          />
        </>
      ) : null}
    </div>
  )
}

export default AgentStatusPanel
