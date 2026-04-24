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
import { useGitStatus } from '../../diff/hooks/useGitStatus'
import type { ChangedFile } from '../../diff/types'

interface AgentStatusPanelProps {
  sessionId: string | null
  cwd: string
  onOpenDiff: (file: ChangedFile) => void
}

const placeholderTests = { passed: 0, failed: 0, total: 0 }

export const AgentStatusPanel = ({
  sessionId,
  cwd,
  onOpenDiff,
}: AgentStatusPanelProps): ReactElement => {
  const status = useAgentStatus(sessionId)
  const events = useActivityEvents(status)

  // Git status with file-system watcher
  const { files, filesCwd, loading, error, refresh } = useGitStatus(cwd, {
    watch: true,
    enabled: status.isActive,
  })

  // Freshness check — files are only valid if they came from the current cwd
  const filesAreFresh = filesCwd === cwd
  const effectiveFiles = filesAreFresh ? files : []

  const effectiveLoading = loading || (!filesAreFresh && error === null)

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
              files={effectiveFiles}
              loading={effectiveLoading}
              error={error}
              onRetry={refresh}
              onSelect={onOpenDiff}
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
