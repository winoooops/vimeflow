import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type UIEvent,
} from 'react'
import type { Agent } from '../../../../agents/registry'
import type { AgentStatus } from '../../types'
import type { SessionStatus } from '../../../sessions/types'
import { ContextBucket } from '../ContextBucket'
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
import {
  readStatusScrollAnchor,
  writeStatusScrollAnchor,
} from '../../utils/statusSnapshotStore'

interface AgentStatusPanelProps {
  agentStatus: AgentStatus
  cwd: string
  onOpenDiff: (file: ChangedFile) => void
  onOpenFile?: (path: string) => void
  gitStatus?: UseGitStatusReturn
  isRefreshing?: boolean
  agent: Agent
  status: SessionStatus
  onCollapse: () => void
  cacheHistory: number[]
  snapshotKey?: string | null
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
  isRefreshing = false,
  agent,
  status: sessionStatus,
  onCollapse,
  cacheHistory,
  snapshotKey = null,
}: AgentStatusPanelProps): ReactElement => {
  const status = agentStatus
  const events = useActivityEvents(status)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const programmaticScrollTopRef = useRef<number | null>(null)

  const scrollMetricsRef = useRef<{
    firstEventId: string | null
    snapshotKey: string | null
    scrollHeight: number
    scrollTop: number
  } | null>(null)

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

  const restoreScrollAnchor = useCallback((): void => {
    if (snapshotKey === null) {
      return
    }

    const scrollContainer = scrollContainerRef.current

    if (scrollContainer === null) {
      return
    }

    const scrollTop = readStatusScrollAnchor(snapshotKey)

    programmaticScrollTopRef.current = scrollTop
    scrollContainer.scrollTop = scrollTop
    programmaticScrollTopRef.current = scrollContainer.scrollTop
    scrollMetricsRef.current = {
      firstEventId: feedEvents[0]?.id ?? null,
      snapshotKey,
      scrollHeight: scrollContainer.scrollHeight,
      scrollTop: scrollContainer.scrollTop,
    }
    // restoreScrollAnchor intentionally depends only on snapshotKey. It runs on
    // mount/key change to restore the saved scroll position; the latest feed
    // identity is updated by the following layout effect on every render cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotKey])

  useLayoutEffect(() => {
    restoreScrollAnchor()
  }, [restoreScrollAnchor])

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current

    if (scrollContainer === null) {
      return
    }

    const previousMetrics = scrollMetricsRef.current

    if (previousMetrics?.snapshotKey === snapshotKey) {
      const activityPrepended =
        (feedEvents[0]?.id ?? null) !== previousMetrics.firstEventId

      if (activityPrepended && previousMetrics.scrollTop > 0) {
        const firstRow = scrollContainer.querySelector<HTMLElement>(
          `[data-event-id="${CSS.escape(feedEvents[0]?.id ?? '')}"]`
        )

        const firstRowHeight = firstRow?.offsetHeight ?? 0

        const scrollHeightDelta =
          scrollContainer.scrollHeight - previousMetrics.scrollHeight

        const prependDelta =
          firstRowHeight > 0 ? firstRowHeight : scrollHeightDelta

        if (prependDelta > 0) {
          const nextScrollTop = previousMetrics.scrollTop + prependDelta

          programmaticScrollTopRef.current = nextScrollTop
          scrollContainer.scrollTop = nextScrollTop
          programmaticScrollTopRef.current = scrollContainer.scrollTop

          if (snapshotKey !== null) {
            writeStatusScrollAnchor(snapshotKey, scrollContainer.scrollTop)
          }
        }
      }
    }

    scrollMetricsRef.current = {
      firstEventId: feedEvents[0]?.id ?? null,
      snapshotKey,
      scrollHeight: scrollContainer.scrollHeight,
      scrollTop: scrollContainer.scrollTop,
    }
  }, [
    snapshotKey,
    feedEvents,
    runningId,
    status.toolCalls.total,
    effectiveFiles.length,
    effectiveLoading,
    error,
    status.testRun,
  ])

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>): void => {
      if (snapshotKey === null) {
        return
      }

      const nextScrollTop = event.currentTarget.scrollTop

      if (programmaticScrollTopRef.current === nextScrollTop) {
        programmaticScrollTopRef.current = null

        return
      }

      writeStatusScrollAnchor(snapshotKey, nextScrollTop)

      const currentMetrics = scrollMetricsRef.current
      if (currentMetrics !== null) {
        scrollMetricsRef.current = {
          ...currentMetrics,
          scrollHeight: event.currentTarget.scrollHeight,
          scrollTop: nextScrollTop,
        }
      }
    },
    [snapshotKey]
  )

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
        isRefreshing={isRefreshing}
        status={sessionStatus}
        onCollapse={onCollapse}
      />

      <span className="sr-only" role="status" aria-live="polite">
        {isRefreshing ? 'Fetching latest agent status' : ''}
      </span>

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

      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-clip"
        onScroll={handleScroll}
      >
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
