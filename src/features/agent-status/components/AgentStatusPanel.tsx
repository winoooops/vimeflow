import { useMemo, type ReactElement } from 'react'
import type { AgentStatus } from '../types'
import { ContextBucket } from './ContextBucket'
import { TokenCache } from './TokenCache'
import { ToolCallSummary } from './ToolCallSummary'
import { FilesChanged } from './FilesChanged'
import { TestResults } from './TestResults'
import { ActivityFooter } from './ActivityFooter'
import { ActivityFeed } from './ActivityFeed'
import { useActivityEvents } from '../hooks/useActivityEvents'
import {
  useGitStatus,
  type UseGitStatusReturn,
} from '../../diff/hooks/useGitStatus'
import { sumLines } from '../../diff/utils/sumLines'
import type { ChangedFile } from '../../diff/types'

interface AgentStatusPanelProps {
  agentStatus: AgentStatus
  cwd: string
  onOpenDiff: (file: ChangedFile) => void
  onOpenFile?: (path: string) => void
  gitStatus?: UseGitStatusReturn
}

const PANEL_WIDTH_PX = 280
const DEFAULT_CONTEXT_WINDOW_SIZE = 200_000

export const AgentStatusPanel = ({
  agentStatus,
  cwd,
  onOpenDiff,
  onOpenFile = undefined,
  gitStatus = undefined,
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

  // Memoize the effective files array so its identity is stable across
  // renders when the underlying data didn't change. Without this, the
  // ternary creates a fresh array literal on every render and downstream
  // useMemos depending on it (lineTotals) re-run unnecessarily.
  const effectiveFiles = useMemo(
    () => (filesAreFresh ? files : []),
    [filesAreFresh, files]
  )

  const effectiveLoading =
    !idle && (loading || (!filesAreFresh && error === null))

  const lineTotals = useMemo(() => sumLines(effectiveFiles), [effectiveFiles])

  return (
    <div
      data-testid="agent-status-panel"
      className="flex h-full shrink-0 flex-col overflow-hidden bg-surface-container"
      style={{
        width: `${PANEL_WIDTH_PX}px`,
      }}
    >
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
        <TokenCache usage={status.contextWindow?.currentUsage ?? null} />
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
      <ActivityFooter
        totalDurationMs={status.cost?.totalDurationMs ?? 0}
        numTurns={status.numTurns}
        linesAdded={lineTotals.added}
        linesRemoved={lineTotals.removed}
      />
    </div>
  )
}

export default AgentStatusPanel
