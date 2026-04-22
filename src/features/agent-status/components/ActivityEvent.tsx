import type { ReactElement } from 'react'
import { formatRelativeTime, formatDuration } from '../utils/relativeTime'
import type {
  ActivityEvent as ActivityEventType,
  ActivityEventKind,
} from '../types/activityEvent'

interface ActivityEventProps {
  event: ActivityEventType
  now: Date
}

const KIND_ICON: Record<ActivityEventKind, string> = {
  edit: 'edit',
  write: 'edit_note',
  read: 'visibility',
  bash: 'terminal',
  grep: 'search',
  glob: 'find_in_page',
  think: 'psychology',
  user: 'person',
  meta: 'tune',
}

const KIND_COLOR: Record<ActivityEventKind, string> = {
  edit: 'text-primary-container',
  write: 'text-primary-container',
  read: 'text-on-surface-variant',
  bash: 'text-secondary',
  grep: 'text-on-surface-variant',
  glob: 'text-on-surface-variant',
  think: 'text-primary-container',
  user: 'text-tertiary',
  meta: 'text-outline',
}

const getLabel = (event: ActivityEventType): string => {
  // The `kind === 'meta'` branch narrows `event` to ToolActivityEvent
  // via the discriminated union — `tool` is always present. Drop the
  // redundant `'tool' in event` guard that misled readers into thinking
  // it could be absent.
  if (event.kind === 'meta') {
    return event.tool.toUpperCase()
  }

  return event.kind.toUpperCase()
}

const getBodyClass = (kind: ActivityEventKind): string => {
  if (kind === 'think') {
    return 'text-xs text-on-surface italic'
  }
  if (kind === 'user') {
    return 'text-xs text-on-surface'
  }

  return 'text-xs text-on-surface font-mono'
}

interface StatusChipsProps {
  event: ActivityEventType
}

const StatusChips = ({ event }: StatusChipsProps): ReactElement | null => {
  if (event.kind === 'edit' || event.kind === 'write') {
    if (!event.diff) {
      return null
    }

    return (
      <div className="mt-0.5 flex items-center gap-2">
        <span className="text-[9px] font-mono text-success">
          +{event.diff.added}
        </span>
        <span className="text-[9px] font-mono text-error">
          −{event.diff.removed}
        </span>
      </div>
    )
  }

  if (event.kind === 'bash') {
    if (event.status === 'running') {
      return null
    }
    const verb = event.status === 'done' ? 'OK' : 'FAILED'

    const palette =
      event.status === 'done'
        ? 'bg-success/[0.12] text-success'
        : 'bg-error/[0.12] text-error'

    const text = event.bashResult
      ? `${verb} ${event.bashResult.passed}/${event.bashResult.total}`
      : verb

    return (
      <div className="mt-0.5">
        <span
          className={`inline-block rounded-md px-2 py-0.5 text-[9px] font-bold uppercase ${palette}`}
        >
          {text}
        </span>
      </div>
    )
  }

  return null
}

export const ActivityEvent = ({
  event,
  now,
}: ActivityEventProps): ReactElement => {
  const symbol = KIND_ICON[event.kind]
  const colorClass = KIND_COLOR[event.kind]
  const label = getLabel(event)
  const isRunning = event.status === 'running'

  const timestampText = isRunning
    ? // Clamp negative deltas to zero so a tool whose emitted timestamp
      // beats JS's Date.now() snapshot (sub-ms clock skew on fast machines,
      // batch catch-up paths) doesn't read as 'running -1s' for a frame.
      `running ${formatDuration(Math.max(0, now.getTime() - new Date(event.timestamp).getTime()))}`
    : formatRelativeTime(event.timestamp, now)

  return (
    <article aria-label={label} className="flex items-start gap-2 py-1">
      <div className="relative">
        <span
          className={`material-symbols-outlined text-sm ${colorClass} w-6 h-6 rounded-md bg-surface-container-high flex items-center justify-center`}
          aria-hidden="true"
        >
          {symbol}
        </span>
        {isRunning && (
          <span
            role="status"
            aria-label="running"
            className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-success animate-pulse"
          />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-[10px] font-bold uppercase tracking-[0.12em] ${colorClass}`}
          >
            {label}
          </span>
          <span className="text-[9px] font-mono text-outline">
            {timestampText}
          </span>
        </div>
        <div className={`mt-0.5 truncate ${getBodyClass(event.kind)}`}>
          {event.body}
        </div>
        <StatusChips event={event} />
      </div>
    </article>
  )
}
