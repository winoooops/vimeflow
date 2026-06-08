import { useMemo, type ReactElement } from 'react'
import type { Agent } from '../../../../agents/registry'
import type { AgentStatus } from '../../types'
import type { SessionStatus } from '../../../sessions/types'
import { ContextBucket } from '../ContextBucket'
import { TokenCache } from '../TokenCache'
import { ToolCallSummary } from '../ToolCallSummary'
import { FilesChanged } from '../FilesChanged'
import { TestResults } from '../TestResults'
import { ActivityFeed } from '../ActivityFeed'
import { useActivityEvents } from '../../hooks/useActivityEvents'
import {
  useGitStatus,
  type UseGitStatusReturn,
} from '../../../diff/hooks/useGitStatus'
import type { ChangedFile } from '../../../diff/types'
import { AgentStatusPanelHeader } from './Header'

interface AgentStatusPanelProps {
  agentStatus: AgentStatus
  cwd: string
  onOpenDiff: (file: ChangedFile) => void
  onOpenFile?: (path: string) => void
  gitStatus?: UseGitStatusReturn
  agent: Agent
  status: SessionStatus
  onCollapse: () => void
  cacheHistory: number[]
}

// Exported so WorkspaceView can target this width as the
// `transition-[width]` end state when expanding the activity-panel shell.
// Keeping the literal here as the single source of truth prevents the
// parent's animation target from drifting away from the actual panel width.
export const PANEL_WIDTH_PX = 280
const DEFAULT_CONTEXT_WINDOW_SIZE = 200_000

export const AgentStatusPanel = ({
  agentStatus,
  cwd,
  onOpenDiff,
  onOpenFile = undefined,
  gitStatus = undefined,
  agent,
  status: sessionStatus,
  onCollapse,
  cacheHistory,
}: AgentStatusPanelProps): ReactElement => {
  const status = agentStatus
  const events = useActivityEvents(status)

  const internalGitStatus = useGitStatus(cwd, {
    watch: true,
    enabled: gitStatus === undefined && status.isActive,
  })

  const { files, filesCwd, loading, error, refresh, idle } =
    gitStatus ?? internalGitStatus

  const filesAreFresh = filesCwd === cwd

  const effectiveFiles = useMemo(
    () => (filesAreFresh ? files : []),
    [filesAreFresh, files]
  )

  const effectiveLoading =
    !idle && (loading || (!filesAreFresh && error === null))

  return (
    <div
      data-testid="agent-status-panel"
      className="flex h-full shrink-0 flex-col overflow-hidden bg-surface-container"
      style={{
        width: `${PANEL_WIDTH_PX}px`,
      }}
    >
      <AgentStatusPanelHeader
        agent={agent}
        status={sessionStatus}
        onCollapse={onCollapse}
      />

      <div className="flex flex-col gap-2 p-2">
        <ContextBucket
          usedPercentage={status.contextWindow?.usedPercentage ?? null}
          contextWindowSize={
            status.contextWindow?.contextWindowSize ??
            DEFAULT_CONTEXT_WINDOW_SIZE
          }
          totalInputTokens={status.contextWindow?.totalInputTokens ?? 0}
          totalOutputTokens={status.contextWindow?.totalOutputTokens ?? 0}
        />
        <TokenCache
          usage={status.contextWindow?.currentUsage ?? null}
          history={cacheHistory}
        />
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-clip">
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
        <TestResults snapshot={status.testRun} onOpenFile={onOpenFile} />
      </div>
    </div>
  )
}

export default AgentStatusPanel
