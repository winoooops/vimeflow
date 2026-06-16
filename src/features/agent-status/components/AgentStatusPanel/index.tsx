import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react'
import type { Agent } from '../../../../agents/registry'
import type { AgentStatus } from '../../types'
import { ContextReservoirCard } from '../ContextReservoirCard'
import { TokenCache } from '../TokenCache'
import { ToolCallSummary } from '../ToolCallSummary'
import { FilesChanged } from '../FilesChanged'
import { TestResults } from '../TestResults'
import { ActivityFeed } from '../ActivityFeed'
import { LiveActionCard } from '../LiveActionCard'
import { useActivityEvents } from '../../hooks/useActivityEvents'
import { matchChangedFile } from '../../utils/matchChangedFile'
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
  onCollapse: () => void
  cacheHistory: number[]
  reserveWindowControls?: boolean
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
  onCollapse,
  cacheHistory,
  reserveWindowControls = false,
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

  const runningEvent = useMemo(
    () => events.find((event) => event.status === 'running') ?? null,
    [events]
  )

  // The running action is promoted to the NOW card, so drop it from the feed
  // (history-only) instead of rendering it twice.
  const feedEvents = useMemo(
    () =>
      runningEvent === null
        ? events
        : events.filter((event) => event.id !== runningEvent.id),
    [events, runningEvent]
  )

  // Own the live "running Ns" clock: tick only while an action runs, resetting
  // immediately when a new one starts so the counter never reads stale.
  const [now, setNow] = useState<Date>(() => new Date())
  const runningId = runningEvent?.id ?? null
  useEffect(() => {
    if (runningId === null) {
      return
    }
    setNow(new Date())
    const tick = setInterval(() => setNow(new Date()), 1000)

    return (): void => clearInterval(tick)
  }, [runningId])

  const liveFile =
    runningEvent !== null &&
    (runningEvent.kind === 'edit' || runningEvent.kind === 'write')
      ? matchChangedFile(effectiveFiles, runningEvent.body, cwd)
      : null

  const liveDiff =
    liveFile?.insertions != null && liveFile.deletions != null
      ? { added: liveFile.insertions, removed: liveFile.deletions }
      : null

  // Edit/write open a diff, but only once git tracks the change: its
  // repo-relative path is the coordinate the diff viewer requires, so we never
  // hand the viewer a guessed or absolute path.
  const handleLiveActivate = useCallback((): void => {
    if (liveFile !== null) {
      onOpenDiff(liveFile)
    }
  }, [liveFile, onOpenDiff])

  const canActivate = liveFile !== null

  return (
    <div
      data-testid="agent-status-panel"
      className="flex h-full shrink-0 flex-col overflow-hidden bg-surface"
      style={{
        width: `${PANEL_WIDTH_PX}px`,
      }}
    >
      <AgentStatusPanelHeader
        agent={agent}
        onCollapse={onCollapse}
        reserveWindowControls={reserveWindowControls}
      />

      <div className="flex flex-col gap-2 p-2">
        <ContextReservoirCard
          usedPercentage={status.contextWindow?.usedPercentage ?? null}
          contextWindowSize={
            status.contextWindow?.contextWindowSize ??
            DEFAULT_CONTEXT_WINDOW_SIZE
          }
        />
        <TokenCache
          usage={status.contextWindow?.currentUsage ?? null}
          history={cacheHistory}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-clip">
        <ToolCallSummary
          total={status.toolCalls.total}
          byType={status.toolCalls.byType}
          active={runningEvent === null ? status.toolCalls.active : null}
        />
        {runningEvent !== null && (
          <LiveActionCard
            event={runningEvent}
            now={now}
            diff={liveDiff}
            pathLabel={liveFile?.path}
            onActivate={canActivate ? handleLiveActivate : undefined}
          />
        )}
        <ActivityFeed events={feedEvents} />
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
