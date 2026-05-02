import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react'
import type {
  ControlBatch,
  DispatchBatch,
  OrchestratorEvent,
  OrchestratorRun,
  OrchestratorSnapshot,
  QueueIssue,
  RetryEntry,
  RunStatus,
} from '../types'
import {
  createOrchestratorService,
  type OrchestratorService,
} from '../services/orchestratorService'

const EMPTY_SNAPSHOT: OrchestratorSnapshot = {
  paused: false,
  queue: [],
  running: [],
  retryQueue: [],
}

const MAX_EVENTS = 12

const STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  claimed: 'Claimed',
  preparing_workspace: 'Preparing',
  rendering_prompt: 'Rendering',
  running: 'Running',
  retry_scheduled: 'Retrying',
  succeeded: 'Succeeded',
  failed: 'Failed',
  stopped: 'Stopped',
  released: 'Released',
}

const STATUS_TONE: Record<RunStatus, string> = {
  queued: 'bg-surface-container-high text-on-surface-variant',
  claimed: 'bg-primary-container/40 text-primary',
  preparing_workspace: 'bg-primary-container/40 text-primary',
  rendering_prompt: 'bg-primary-container/40 text-primary',
  running: 'bg-success/15 text-success',
  retry_scheduled: 'bg-secondary/15 text-secondary',
  succeeded: 'bg-success/15 text-success',
  failed: 'bg-error/15 text-error',
  stopped: 'bg-error/15 text-error',
  released: 'bg-surface-container-high text-outline',
}

interface OrchestratorPanelProps {
  service?: OrchestratorService
}

interface QueueRow {
  key: string
  issueId: string
  identifier: string
  title: string
  status: RunStatus
  state: string | null
  attemptNumber: number | null
  detail: string | null
  canStop: boolean
  canRetry: boolean
}

const toQueueRows = (snapshot: OrchestratorSnapshot): QueueRow[] => [
  ...snapshot.running.map((run) => runningRow(run)),
  ...snapshot.retryQueue.map((entry) => retryRow(entry)),
  ...snapshot.queue.map((entry) => queueRow(entry)),
]

const runningRow = (run: OrchestratorRun): QueueRow => ({
  key: `running:${run.runId}`,
  issueId: run.issueId,
  identifier: run.issueIdentifier,
  title: run.lastEvent ?? shortId(run.runId),
  status: run.status,
  state: null,
  attemptNumber: run.attemptNumber,
  detail: run.workspacePath,
  canStop: true,
  canRetry: false,
})

const retryRow = (entry: RetryEntry): QueueRow => ({
  key: `retry:${entry.issueId}`,
  issueId: entry.issueId,
  identifier: entry.issueIdentifier,
  title: entry.lastError,
  status: 'retry_scheduled',
  state: null,
  attemptNumber: entry.attemptNumber,
  detail: `Retry ${formatTimestamp(entry.nextRetryAt)}`,
  canStop: false,
  canRetry: true,
})

const queueRow = (entry: QueueIssue): QueueRow => ({
  key: `queue:${entry.issue.id}`,
  issueId: entry.issue.id,
  identifier: entry.issue.identifier,
  title: entry.issue.title,
  status: entry.status,
  state: entry.issue.state,
  attemptNumber: entry.attemptNumber,
  detail: entry.lastError ?? retryDetail(entry.nextRetryAt),
  canStop: false,
  canRetry: entry.status === 'failed' || entry.status === 'stopped',
})

const retryDetail = (nextRetryAt: string | null): string | null =>
  nextRetryAt ? `Retry ${formatTimestamp(nextRetryAt)}` : null

const shortId = (id: string): string => id.slice(0, 8)

const formatTimestamp = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

const appendEvents = (
  previous: OrchestratorEvent[],
  events: OrchestratorEvent[]
): OrchestratorEvent[] => [...events, ...previous].slice(0, MAX_EVENTS)

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const OrchestratorPanel = ({
  service: serviceProp = undefined,
}: OrchestratorPanelProps): ReactElement => {
  const service = useMemo(
    () => serviceProp ?? createOrchestratorService(),
    [serviceProp]
  )
  const [snapshot, setSnapshot] = useState<OrchestratorSnapshot>(EMPTY_SNAPSHOT)

  const [workflowPath, setWorkflowPath] = useState('')

  const [loadedWorkflowPath, setLoadedWorkflowPath] = useState<string | null>(
    null
  )

  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<OrchestratorEvent[]>([])

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | null = null

    const subscribe = async (): Promise<void> => {
      try {
        const unlisten = await service.onEvent((event) => {
          setEvents((current) => appendEvents(current, [event]))
        })

        if (disposed) {
          unlisten()

          return
        }

        cleanup = unlisten
      } catch (subscriptionError: unknown) {
        if (!disposed) {
          setError(errorMessage(subscriptionError))
        }
      }
    }

    void subscribe()

    return (): void => {
      disposed = true
      cleanup?.()
    }
  }, [service])

  const rows = useMemo(() => toQueueRows(snapshot), [snapshot])

  const runAction = useCallback(
    async (
      action: string,
      handler: () => Promise<
        OrchestratorSnapshot | DispatchBatch | ControlBatch
      >
    ): Promise<void> => {
      setLoadingAction(action)
      setError(null)

      try {
        const result = await handler()
        if ('snapshot' in result) {
          setSnapshot(result.snapshot)
          setEvents((current) => appendEvents(current, result.events))
        } else {
          setSnapshot(result)
        }
      } catch (actionError: unknown) {
        setError(errorMessage(actionError))
      } finally {
        setLoadingAction(null)
      }
    },
    []
  )

  const handleLoadWorkflow = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()
      const trimmedPath = workflowPath.trim()
      if (trimmedPath.length === 0) {
        setError('Workflow path is required')

        return
      }

      void runAction('load', async () => {
        const nextSnapshot = await service.loadWorkflow(trimmedPath)
        setLoadedWorkflowPath(trimmedPath)

        return nextSnapshot
      })
    },
    [runAction, service, workflowPath]
  )

  const handleRefresh = useCallback((): void => {
    void runAction('refresh', () => service.refreshSnapshot())
  }, [runAction, service])

  const handlePauseToggle = useCallback((): void => {
    void runAction('pause', () => service.setPaused(!snapshot.paused))
  }, [runAction, service, snapshot.paused])

  const handleDispatch = useCallback((): void => {
    void runAction('dispatch', () => service.dispatchOnce())
  }, [runAction, service])

  const handleStop = useCallback(
    (issueId: string): void => {
      void runAction(`stop:${issueId}`, () => service.stopRun(issueId))
    },
    [runAction, service]
  )

  const handleRetry = useCallback(
    (issueId: string): void => {
      void runAction(`retry:${issueId}`, () => service.retryIssue(issueId))
    },
    [runAction, service]
  )

  const busy = loadingAction !== null
  const workflowDisplay = loadedWorkflowPath ?? 'No workflow loaded'

  return (
    <aside
      data-testid="orchestrator-panel"
      className="flex h-full w-[320px] flex-col overflow-hidden bg-surface-container-low"
      aria-label="Orchestration"
    >
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <div className="min-w-0">
          <h2 className="font-headline text-sm font-[800] text-on-surface">
            Orchestration
          </h2>
          <p className="truncate text-[10px] text-on-surface-variant">
            {workflowDisplay}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${
            snapshot.paused
              ? 'bg-secondary/15 text-secondary'
              : 'bg-success/15 text-success'
          }`}
        >
          {snapshot.paused ? 'Paused' : 'Active'}
        </span>
      </div>

      <form
        onSubmit={handleLoadWorkflow}
        className="flex shrink-0 gap-2 px-3 pb-3"
      >
        <label className="sr-only" htmlFor="orchestrator-workflow-path">
          Workflow path
        </label>
        <input
          id="orchestrator-workflow-path"
          value={workflowPath}
          onChange={(event) => setWorkflowPath(event.target.value)}
          placeholder="/repo/WORKFLOW.md"
          className="min-w-0 flex-1 rounded-md bg-surface-container-high px-2 py-1.5 font-mono text-[11px] text-on-surface outline-none ring-1 ring-transparent transition focus:ring-primary/60"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary-container px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-container/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Load
        </button>
      </form>

      <div className="grid grid-cols-3 gap-2 px-3 pb-3">
        <Metric label="Queued" value={snapshot.queue.length} />
        <Metric label="Running" value={snapshot.running.length} />
        <Metric label="Retrying" value={snapshot.retryQueue.length} />
      </div>

      <div className="flex shrink-0 gap-2 px-3 pb-3">
        <IconButton
          label="Refresh"
          icon="refresh"
          disabled={busy}
          onClick={handleRefresh}
        />
        <IconButton
          label={snapshot.paused ? 'Resume' : 'Pause'}
          icon={snapshot.paused ? 'play_arrow' : 'pause'}
          disabled={busy}
          onClick={handlePauseToggle}
        />
        <IconButton
          label="Dispatch"
          icon="bolt"
          disabled={busy}
          onClick={handleDispatch}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="mx-3 mb-3 rounded-md bg-error/15 px-3 py-2 text-[11px] text-error"
        >
          {error}
        </div>
      )}

      <div className="thin-scrollbar flex-1 overflow-y-auto">
        <section className="px-3 pb-4" aria-labelledby="work-queue-heading">
          <div className="mb-2 flex items-center justify-between">
            <h3
              id="work-queue-heading"
              className="font-label text-[10px] font-semibold uppercase tracking-wider text-on-surface/50"
            >
              Work Queue
            </h3>
            <span className="text-[10px] text-outline">{rows.length}</span>
          </div>

          {rows.length === 0 ? (
            <p className="rounded-lg bg-surface-container px-3 py-3 text-[11px] text-on-surface-variant">
              No orchestrator work
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((row) => (
                <QueueRowItem
                  key={row.key}
                  row={row}
                  disabled={busy}
                  onStop={handleStop}
                  onRetry={handleRetry}
                />
              ))}
            </div>
          )}
        </section>

        <section className="px-3 pb-4" aria-labelledby="events-heading">
          <div className="mb-2 flex items-center justify-between">
            <h3
              id="events-heading"
              className="font-label text-[10px] font-semibold uppercase tracking-wider text-on-surface/50"
            >
              Recent Events
            </h3>
            <span className="text-[10px] text-outline">{events.length}</span>
          </div>

          {events.length === 0 ? (
            <p className="rounded-lg bg-surface-container px-3 py-3 text-[11px] text-on-surface-variant">
              No events yet
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {events.map((event) => (
                <EventRow
                  key={`${event.timestamp}:${event.issueIdentifier}:${event.status}`}
                  event={event}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}

const Metric = ({
  label,
  value,
}: {
  label: string
  value: number
}): ReactElement => (
  <div className="rounded-lg bg-surface-container p-2">
    <div className="font-mono text-lg font-semibold leading-none text-on-surface">
      {value}
    </div>
    <div className="mt-1 text-[10px] text-on-surface-variant">{label}</div>
  </div>
)

const IconButton = ({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string
  icon: string
  disabled: boolean
  onClick: () => void
}): ReactElement => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className="flex h-9 flex-1 items-center justify-center rounded-md bg-surface-container-high text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
  >
    <span className="material-symbols-outlined text-base">{icon}</span>
  </button>
)

const QueueRowItem = ({
  row,
  disabled,
  onStop,
  onRetry,
}: {
  row: QueueRow
  disabled: boolean
  onStop: (issueId: string) => void
  onRetry: (issueId: string) => void
}): ReactElement => (
  <article className="rounded-lg bg-surface-container p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-primary">
            {row.identifier}
          </span>
          {row.state && (
            <span className="truncate text-[10px] text-outline">
              {row.state}
            </span>
          )}
        </div>
        <h4 className="mt-1 line-clamp-2 text-xs font-medium text-on-surface">
          {row.title}
        </h4>
      </div>
      <StatusBadge status={row.status} />
    </div>
    <div className="mt-2 flex items-center gap-2 text-[10px] text-on-surface-variant">
      {row.attemptNumber !== null && <span>Attempt {row.attemptNumber}</span>}
      {row.detail && <span className="truncate">{row.detail}</span>}
    </div>
    {(row.canStop || row.canRetry) && (
      <div className="mt-3 flex items-center gap-2">
        {row.canStop && (
          <RowActionButton
            label={`Stop ${row.identifier}`}
            icon="stop_circle"
            disabled={disabled}
            onClick={() => onStop(row.issueId)}
          />
        )}
        {row.canRetry && (
          <RowActionButton
            label={`Retry ${row.identifier}`}
            icon="replay"
            disabled={disabled}
            onClick={() => onRetry(row.issueId)}
          />
        )}
      </div>
    )}
  </article>
)

const RowActionButton = ({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string
  icon: string
  disabled: boolean
  onClick: () => void
}): ReactElement => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className="flex h-7 w-7 items-center justify-center rounded-md bg-surface-container-high text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
  >
    <span className="material-symbols-outlined text-sm">{icon}</span>
  </button>
)

const StatusBadge = ({ status }: { status: RunStatus }): ReactElement => (
  <span
    className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${STATUS_TONE[status]}`}
  >
    {STATUS_LABELS[status]}
  </span>
)

const EventRow = ({ event }: { event: OrchestratorEvent }): ReactElement => {
  const detail = event.error ?? event.message ?? event.workspacePath

  return (
    <article className="rounded-lg bg-surface-container p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-primary">
              {event.issueIdentifier}
            </span>
            <span className="text-[10px] text-outline">
              {formatTimestamp(event.timestamp)}
            </span>
          </div>
          {detail && (
            <p className="mt-1 line-clamp-2 text-[11px] text-on-surface-variant">
              {detail}
            </p>
          )}
        </div>
        <StatusBadge status={event.status} />
      </div>
    </article>
  )
}

export default OrchestratorPanel
