import {
  useCallback,
  useEffect,
  useState,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type ReactElement,
  type Ref,
} from 'react'
import { Tooltip } from '../../../components/Tooltip'
import { formatRelativeTime, formatDuration } from '../utils/relativeTime'
import type {
  ActivityEvent as ActivityEventType,
  ActivityEventKind,
} from '../types/activityEvent'

interface ActivityEventProps {
  ariaPosInSet?: number
  ariaSetSize?: number
  event: ActivityEventType
  now: Date
  onFocus?: FocusEventHandler<HTMLElement>
  onKeyDown?: KeyboardEventHandler<HTMLElement>
  rowRef?: Ref<HTMLElement>
  tabIndex?: 0 | -1
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
  // `isTestFile` is typed on the base event so consumers can read it
  // without narrowing. The producer (`toolCallsToEvents`) only ever sets
  // it on ToolActivityEvents, but we still guard for `tool` to keep the
  // fallback safe if a Think/User event ever sneaks `isTestFile: true`.
  if (event.isTestFile === true && 'tool' in event) {
    // Write tools may also overwrite existing files — labelled as
    // "CREATED" by approximation. Edit always means an existing file
    // was modified. Documented limitation in the spec.
    // No emoji in the label per CLAUDE.md ("Avoid adding emojis to files
    // unless asked"); the verb-prefixed text is the differentiator.
    return event.tool === 'Edit' ? 'UPDATED TEST' : 'CREATED TEST'
  }
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

const COPY_FEEDBACK_MS = 1500

type CopyState = 'idle' | 'copied' | 'failed'

const writeClipboardText = async (text: string): Promise<void> => {
  const clipboard = (window.navigator as unknown as { clipboard?: Clipboard })
    .clipboard

  if (clipboard?.writeText === undefined) {
    throw new Error('Clipboard API unavailable')
  }

  await clipboard.writeText(text)
}

interface ActivityTooltipContentProps {
  body: string
  label: string
}

const ActivityTooltipContent = ({
  body,
  label,
}: ActivityTooltipContentProps): ReactElement => {
  const [copyState, setCopyState] = useState<CopyState>('idle')

  useEffect(() => {
    setCopyState('idle')
  }, [body])

  useEffect(() => {
    if (copyState === 'idle') {
      return
    }

    const id = window.setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_MS)

    return (): void => window.clearTimeout(id)
  }, [copyState])

  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      await writeClipboardText(body)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }, [body])

  const copyButtonLabel =
    copyState === 'copied'
      ? 'Copied activity details'
      : copyState === 'failed'
        ? 'Copy failed, try again'
        : 'Copy activity details'

  const copyFeedback =
    copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : ''

  return (
    <div className="w-[min(30rem,calc(100vw-2rem))]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="min-w-0 text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant">
          {label}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <span
            aria-live="polite"
            className="min-w-10 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant"
          >
            {copyFeedback}
          </span>
          <button
            type="button"
            aria-label={copyButtonLabel}
            onClick={(): void => {
              void handleCopy()
            }}
            className="inline-flex h-6 items-center gap-1 rounded-md bg-on-surface/10 px-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant transition-colors hover:bg-on-surface/15 hover:text-on-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
          >
            <span
              className="material-symbols-outlined text-sm"
              aria-hidden="true"
            >
              {copyState === 'copied' ? 'check' : 'content_copy'}
            </span>
            Copy
          </button>
        </div>
      </div>
      <pre className="thin-scrollbar max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-container/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-on-surface">
        {body}
      </pre>
    </div>
  )
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
  ariaPosInSet = undefined,
  ariaSetSize = undefined,
  event,
  now,
  onFocus = undefined,
  onKeyDown = undefined,
  rowRef = undefined,
  tabIndex = 0,
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
    <Tooltip
      content={<ActivityTooltipContent body={event.body} label={label} />}
      placement="left"
      maxWidth={520}
      interactive
      ariaLabel={`${label} activity details`}
      className="p-3"
    >
      <article
        ref={rowRef}
        aria-label={label}
        aria-posinset={ariaPosInSet}
        aria-setsize={ariaSetSize}
        tabIndex={tabIndex}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        className="flex items-start gap-2 rounded-md py-1 outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
      >
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
          <span className={`mt-0.5 block truncate ${getBodyClass(event.kind)}`}>
            {event.body}
          </span>
          <StatusChips event={event} />
        </div>
      </article>
    </Tooltip>
  )
}
