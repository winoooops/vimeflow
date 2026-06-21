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
  needsReattach?: boolean
  agent: Agent
  onCollapse: () => void
  cacheHistory: number[]
  snapshotKey?: string | null
  reserveWindowControls?: boolean
}

// Exported so WorkspaceView can target this width as the
// `transition-[width]` end state when expanding the activity-panel shell.
// Keeping the literal here as the single source of truth prevents the
// parent's animation target from drifting away from the actual panel width.
export const PANEL_WIDTH_PX = 280
const DEFAULT_CONTEXT_WINDOW_SIZE = 200_000
const MAX_RETAINED_BODY_SNAPSHOTS = 16

type AgentStatusPanelBodyPhase = 'fresh' | 'fetching' | 'loading'

interface AgentStatusPanelBodySnapshot {
  cacheHistory: number[]
  cwd: string
  gitStatus: UseGitStatusReturn | undefined
  snapshotKey: string | null
  status: AgentStatus
}

interface RetainedBodyState {
  phase: AgentStatusPanelBodyPhase
  snapshot: AgentStatusPanelBodySnapshot
}

interface RetainedBodyStateOptions {
  agentStatus: AgentStatus
  cacheHistory: number[]
  cwd: string
  gitStatus: UseGitStatusReturn | undefined
  isRefreshing: boolean
  snapshotKey: string | null
}

const hasStatusContent = (status: AgentStatus): boolean =>
  status.isActive ||
  status.agentExited ||
  status.agentType !== null ||
  status.modelId !== null ||
  status.modelDisplayName !== null ||
  status.version !== null ||
  status.agentSessionId !== null ||
  status.contextWindow !== null ||
  status.cost !== null ||
  status.rateLimits !== null ||
  status.numTurns > 0 ||
  status.toolCalls.total > 0 ||
  status.toolCalls.active !== null ||
  status.recentToolCalls.length > 0 ||
  status.testRun !== null

const hasBodyContent = (snapshot: AgentStatusPanelBodySnapshot): boolean =>
  hasStatusContent(snapshot.status) ||
  snapshot.cacheHistory.length > 0 ||
  (snapshot.gitStatus?.filesCwd === snapshot.cwd &&
    snapshot.gitStatus.files.length > 0)

const rememberBodySnapshot = (
  snapshots: Map<string, AgentStatusPanelBodySnapshot>,
  snapshot: AgentStatusPanelBodySnapshot
): void => {
  if (snapshot.snapshotKey === null) {
    return
  }

  snapshots.delete(snapshot.snapshotKey)
  snapshots.set(snapshot.snapshotKey, snapshot)

  while (snapshots.size > MAX_RETAINED_BODY_SNAPSHOTS) {
    const oldestKey = snapshots.keys().next().value

    if (oldestKey === undefined) {
      return
    }

    snapshots.delete(oldestKey)
  }
}

const useRetainedBodyState = ({
  agentStatus,
  cacheHistory,
  cwd,
  gitStatus,
  isRefreshing,
  snapshotKey,
}: RetainedBodyStateOptions): RetainedBodyState => {
  const lastStableSnapshotRef = useRef<AgentStatusPanelBodySnapshot | null>(
    null
  )

  const heldRefreshSnapshotRef = useRef<AgentStatusPanelBodySnapshot | null>(
    null
  )

  const previousSnapshotKeyRef = useRef<string | null>(snapshotKey)

  const snapshotsByKeyRef = useRef<Map<string, AgentStatusPanelBodySnapshot>>(
    new Map()
  )

  const currentSnapshot = useMemo<AgentStatusPanelBodySnapshot>(
    () => ({
      cacheHistory,
      cwd,
      gitStatus,
      snapshotKey,
      status: agentStatus,
    }),
    [agentStatus, cacheHistory, cwd, gitStatus, snapshotKey]
  )

  const targetSnapshot =
    snapshotKey === null
      ? null
      : (snapshotsByKeyRef.current.get(snapshotKey) ?? null)

  const currentHasContent = hasBodyContent(currentSnapshot)
  const snapshotKeyChanged = previousSnapshotKeyRef.current !== snapshotKey

  const targetHasRetainedContent =
    targetSnapshot !== null && hasBodyContent(targetSnapshot)

  const retainedTargetSnapshot = targetHasRetainedContent
    ? targetSnapshot
    : null
  const lastStableSnapshot = lastStableSnapshotRef.current

  const lastStableHasContent =
    lastStableSnapshot !== null && hasBodyContent(lastStableSnapshot)

  const retainedLastSnapshot = lastStableHasContent ? lastStableSnapshot : null

  const switchFallbackSnapshot =
    snapshotKeyChanged && !currentHasContent
      ? (retainedTargetSnapshot ?? retainedLastSnapshot)
      : null

  const retainedRefreshSnapshot =
    retainedTargetSnapshot ??
    heldRefreshSnapshotRef.current ??
    switchFallbackSnapshot

  const shouldRetainDuringRefresh =
    (isRefreshing || snapshotKeyChanged) &&
    !currentHasContent &&
    retainedRefreshSnapshot !== null

  const phase: AgentStatusPanelBodyPhase = shouldRetainDuringRefresh
    ? 'fetching'
    : isRefreshing && !currentHasContent
      ? 'loading'
      : isRefreshing
        ? 'fetching'
        : 'fresh'

  const snapshot = shouldRetainDuringRefresh
    ? retainedRefreshSnapshot
    : currentSnapshot

  useLayoutEffect(() => {
    if (switchFallbackSnapshot !== null) {
      heldRefreshSnapshotRef.current = switchFallbackSnapshot
    }
  }, [switchFallbackSnapshot])

  useEffect(() => {
    previousSnapshotKeyRef.current = snapshotKey

    if (currentHasContent) {
      rememberBodySnapshot(snapshotsByKeyRef.current, currentSnapshot)
      lastStableSnapshotRef.current = currentSnapshot
    }

    if (!isRefreshing && !snapshotKeyChanged) {
      heldRefreshSnapshotRef.current = null
    }
  }, [
    currentHasContent,
    currentSnapshot,
    isRefreshing,
    snapshotKey,
    snapshotKeyChanged,
  ])

  return { phase, snapshot }
}

const SkeletonLine = ({
  className = '',
}: {
  className?: string
}): ReactElement => (
  <div
    className={`rounded-full bg-outline-variant/20 motion-safe:animate-pulse ${className}`}
  />
)

const AgentStatusPanelOverviewSkeleton = (): ReactElement => (
  <div
    data-testid="agent-status-panel-overview-loading"
    className="flex flex-col gap-2 p-2"
    aria-hidden="true"
  >
    <div className="rounded-md bg-surface-container/45 p-3">
      <SkeletonLine className="h-2 w-24" />
      <SkeletonLine className="mt-3 h-12 w-full rounded-md" />
      <SkeletonLine className="mt-3 h-2 w-32" />
    </div>
    <div className="rounded-md bg-surface-container/35 p-3">
      <SkeletonLine className="h-2 w-20" />
      <SkeletonLine className="mt-3 h-7 w-16" />
      <SkeletonLine className="mt-3 h-2 w-full" />
    </div>
  </div>
)

const AgentStatusPanelBodyRefreshIndicator = (): ReactElement => (
  <div
    data-testid="agent-status-panel-body-refresh-indicator"
    className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px overflow-hidden bg-outline-variant/15"
    aria-hidden="true"
  >
    <div className="vf-activity-refresh-comet h-full" />
  </div>
)

const AgentStatusPanelBodySkeleton = (): ReactElement => (
  <div
    data-testid="agent-status-panel-body-loading"
    className="flex flex-col"
    aria-hidden="true"
  >
    {[0, 1, 2].map((index) => (
      <div
        key={index}
        className="border-t border-outline-variant/[0.08] px-5 py-3"
      >
        <div className="flex items-center gap-2">
          <SkeletonLine className="h-2 w-2" />
          <SkeletonLine className="h-2 w-24" />
          <SkeletonLine className="h-2 w-6" />
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <SkeletonLine className="h-2 w-full" />
          <SkeletonLine className="h-2 w-4/5" />
          <SkeletonLine className="h-2 w-2/3" />
        </div>
      </div>
    ))}
  </div>
)

export const AgentStatusPanel = ({
  agentStatus,
  cwd,
  onOpenDiff,
  onOpenFile = undefined,
  gitStatus = undefined,
  isRefreshing = false,
  needsReattach = false,
  agent,
  onCollapse,
  cacheHistory,
  snapshotKey = null,
  reserveWindowControls = false,
}: AgentStatusPanelProps): ReactElement => {
  const bodyState = useRetainedBodyState({
    agentStatus,
    cacheHistory,
    cwd,
    gitStatus,
    isRefreshing,
    snapshotKey,
  })
  const status = bodyState.snapshot.status
  const bodyCwd = bodyState.snapshot.cwd
  const bodyGitStatus = bodyState.snapshot.gitStatus
  const bodyCacheHistory = bodyState.snapshot.cacheHistory
  const bodySnapshotKey = bodyState.snapshot.snapshotKey
  const isBodyLoading = bodyState.phase === 'loading'
  const isBodyFetching = bodyState.phase === 'fetching'
  const showsRefreshing = isRefreshing || isBodyFetching
  const isRetainedBody = isBodyFetching && bodySnapshotKey !== snapshotKey
  const events = useActivityEvents(status)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const programmaticScrollTopRef = useRef<number | null>(null)

  const scrollMetricsRef = useRef<{
    firstEventId: string | null
    snapshotKey: string | null
    scrollHeight: number
    scrollTop: number
  } | null>(null)

  const internalGitStatus = useGitStatus(bodyCwd, {
    watch: true,
    enabled: bodyGitStatus === undefined && status.isActive,
  })

  const { files, filesCwd, loading, error, refresh, idle } =
    bodyGitStatus ?? internalGitStatus

  const filesAreFresh = filesCwd === bodyCwd

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
      ? matchChangedFile(effectiveFiles, runningEvent.body, bodyCwd)
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
    if (bodySnapshotKey === null) {
      return
    }

    const scrollContainer = scrollContainerRef.current

    if (scrollContainer === null) {
      return
    }

    const scrollTop = readStatusScrollAnchor(bodySnapshotKey)

    programmaticScrollTopRef.current = scrollTop
    scrollContainer.scrollTop = scrollTop
    programmaticScrollTopRef.current = scrollContainer.scrollTop
    scrollMetricsRef.current = {
      firstEventId: feedEvents[0]?.id ?? null,
      snapshotKey: bodySnapshotKey,
      scrollHeight: scrollContainer.scrollHeight,
      scrollTop: scrollContainer.scrollTop,
    }
    // restoreScrollAnchor intentionally depends only on bodySnapshotKey. It runs
    // on mount/key change to restore the saved scroll position; the latest feed
    // identity is updated by the following layout effect on every render cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodySnapshotKey])

  useLayoutEffect(() => {
    restoreScrollAnchor()
  }, [restoreScrollAnchor])

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current

    if (scrollContainer === null) {
      return
    }

    const previousMetrics = scrollMetricsRef.current

    if (previousMetrics?.snapshotKey === bodySnapshotKey) {
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
          scrollHeightDelta > 0 ? scrollHeightDelta : firstRowHeight

        if (prependDelta > 0) {
          const nextScrollTop = previousMetrics.scrollTop + prependDelta

          programmaticScrollTopRef.current = nextScrollTop
          scrollContainer.scrollTop = nextScrollTop
          programmaticScrollTopRef.current = scrollContainer.scrollTop

          if (bodySnapshotKey !== null) {
            writeStatusScrollAnchor(bodySnapshotKey, scrollContainer.scrollTop)
          }
        }
      }
    }

    scrollMetricsRef.current = {
      firstEventId: feedEvents[0]?.id ?? null,
      snapshotKey: bodySnapshotKey,
      scrollHeight: scrollContainer.scrollHeight,
      scrollTop: scrollContainer.scrollTop,
    }
  }, [
    bodySnapshotKey,
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
      if (bodySnapshotKey === null) {
        return
      }

      const nextScrollTop = event.currentTarget.scrollTop

      if (programmaticScrollTopRef.current === nextScrollTop) {
        programmaticScrollTopRef.current = null

        return
      }

      if (bodySnapshotKey !== snapshotKey) {
        return
      }

      writeStatusScrollAnchor(bodySnapshotKey, nextScrollTop)

      const currentMetrics = scrollMetricsRef.current
      if (currentMetrics !== null) {
        scrollMetricsRef.current = {
          ...currentMetrics,
          scrollHeight: event.currentTarget.scrollHeight,
          scrollTop: nextScrollTop,
        }
      }
    },
    [bodySnapshotKey, snapshotKey]
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
        isRefreshing={showsRefreshing}
        needsReattach={needsReattach}
        onCollapse={onCollapse}
        reserveWindowControls={reserveWindowControls}
      />

      <span className="sr-only" role="status" aria-live="polite">
        {isBodyLoading
          ? 'Loading agent status'
          : showsRefreshing
            ? 'Fetching latest agent status'
            : ''}
      </span>

      {isBodyLoading ? (
        <AgentStatusPanelOverviewSkeleton />
      ) : (
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
            history={bodyCacheHistory}
          />
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {isBodyFetching && <AgentStatusPanelBodyRefreshIndicator />}
        <div
          ref={scrollContainerRef}
          data-testid="agent-status-panel-scroll-region"
          data-body-phase={bodyState.phase}
          className="h-full overflow-y-auto overflow-x-clip"
          onScroll={handleScroll}
        >
          {isBodyLoading ? (
            <AgentStatusPanelBodySkeleton />
          ) : (
            <div
              data-testid="agent-status-panel-body-content"
              className={isRetainedBody ? 'select-none' : undefined}
              inert={isRetainedBody || undefined}
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
          )}
        </div>
      </div>
    </div>
  )
}

export default AgentStatusPanel
