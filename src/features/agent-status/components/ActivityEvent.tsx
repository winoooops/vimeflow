import {
  useCallback,
  useEffect,
  useState,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import { Tooltip } from '../../../components/Tooltip'
import { formatShortcut } from '../../../lib/formatShortcut'
import { formatRelativeTime, formatDuration } from '../utils/relativeTime'
import type {
  ActivityEvent as ActivityEventType,
  ActivityEventKind,
  ToolActivityEvent,
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

const ACTIVITY_CARD_SURFACE =
  'relative w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-[10px] border border-[rgba(74,68,79,0.45)] bg-[rgba(20,18,32,0.96)] font-sans shadow-[0_16px_48px_rgba(0,0,0,0.55),0_0_0_1px_rgba(203,166,247,0.04)] backdrop-blur-[20px] backdrop-saturate-[150%]'

type CopyState = 'idle' | 'copied' | 'failed'

const writeClipboardText = async (text: string): Promise<void> => {
  const clipboard = (window.navigator as unknown as { clipboard?: Clipboard })
    .clipboard

  if (clipboard?.writeText === undefined) {
    throw new Error('Clipboard API unavailable')
  }

  await clipboard.writeText(text)
}

const isToolEvent = (event: ActivityEventType): event is ToolActivityEvent =>
  'tool' in event

const buildCopyText = (event: ActivityEventType): string =>
  'resultPreview' in event && event.resultPreview
    ? `${event.body}\n\n${event.resultPreview}`
    : event.body

interface ActivityTooltipContentProps {
  event: ActivityEventType
  now: Date
}

const KIND_ACCENT: Record<ActivityEventKind, string> = {
  bash: '#a8c8ff',
  edit: '#e2c7ff',
  write: '#e2c7ff',
  read: '#8a8299',
  grep: '#a8c8ff',
  glob: '#a8c8ff',
  meta: '#a8c8ff',
  think: '#c39eee',
  user: '#f0c674',
}

const Pip = ({ children }: { children: ReactNode }): ReactElement => (
  <span className="inline-flex items-center gap-[3px] whitespace-nowrap font-mono text-[10px] text-[#8a8299]">
    {children}
  </span>
)

const Dot = (): ReactElement => <span className="mr-px text-[#4a444f]">·</span>

const CommandBlock = ({
  cmd,
  accent,
}: {
  cmd: string
  accent: string
}): ReactElement => (
  <pre className="relative m-0 max-h-[12rem] overflow-y-auto thin-scrollbar rounded-md border border-[rgba(74,68,79,0.3)] bg-[rgba(13,13,28,0.55)] p-2 pl-6 font-mono text-[11px] leading-[1.55] text-[#cdc3d1]">
    <span
      className="absolute left-[10px] top-2 text-sm"
      style={{ color: accent, opacity: 0.8 }}
    >
      $
    </span>
    <span className="whitespace-pre-wrap break-all text-[#e3e0f7]">{cmd}</span>
  </pre>
)

const FilePathChip = ({
  path,
  accent,
}: {
  path: string
  accent: string
}): ReactElement => {
  // Split on the last path separator — POSIX `/` or Windows `\` — so a native
  // Windows path (`C:\repo\src\Button.tsx`) keeps its directory/filename
  // separation instead of collapsing the whole path into the filename. Slicing
  // by index preserves the original separators in the displayed string.
  const sepIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const dir = sepIndex >= 0 ? path.slice(0, sepIndex + 1) : ''
  const file = sepIndex >= 0 ? path.slice(sepIndex + 1) : path

  return (
    <div className="flex items-start gap-1.5 rounded-md border border-[rgba(74,68,79,0.3)] bg-[rgba(13,13,28,0.55)] px-2.5 py-2 font-mono text-[11.5px]">
      <span
        className="material-symbols-outlined shrink-0 text-xs"
        style={{ color: accent, transform: 'translateY(2px)' }}
        aria-hidden="true"
      >
        draft
      </span>
      <span className="min-w-0 break-all">
        <span className="text-[#6c7086]">{dir}</span>
        <span className="font-semibold text-[#e3e0f7]">{file}</span>
      </span>
    </div>
  )
}

const Kbd = ({ children }: { children: ReactNode }): ReactElement => (
  <span className="inline-flex items-center justify-center rounded border border-[rgba(74,68,79,0.35)] bg-[rgba(13,13,28,0.5)] px-1 py-px font-mono text-[9.5px] text-[#6c7086]">
    {children}
  </span>
)

// Shared relative-time string for the feed row and the tooltip header so the
// running-clock format and the negative-delta clamp can't drift between them.
const computeAgo = (event: ActivityEventType, now: Date): string =>
  event.status === 'running'
    ? // Clamp negative deltas to zero so a tool whose emitted timestamp beats
      // JS's Date.now() snapshot (sub-ms clock skew on fast machines, batch
      // catch-up paths) doesn't read as 'running -1s' for a frame.
      `running ${formatDuration(Math.max(0, now.getTime() - new Date(event.timestamp).getTime()))}`
    : formatRelativeTime(event.timestamp, now)

const ActivityTooltipContent = ({
  event,
  now,
}: ActivityTooltipContentProps): ReactElement => {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [isHovered, setIsHovered] = useState(false)
  const copyText = buildCopyText(event)

  useEffect(() => {
    setCopyState('idle')
  }, [copyText])

  useEffect(() => {
    if (copyState === 'idle') {
      return
    }
    const id = window.setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_MS)

    return (): void => window.clearTimeout(id)
  }, [copyState])

  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      await writeClipboardText(copyText)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }, [copyText])

  const copyButtonLabel =
    copyState === 'copied'
      ? 'Copied activity details'
      : copyState === 'failed'
        ? 'Copy failed, try again'
        : 'Copy activity details'

  const copyFeedback =
    copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : ''

  const isRunning = event.status === 'running'

  const ago = computeAgo(event, now)

  const duration =
    isToolEvent(event) && !isRunning && event.durationMs != null
      ? formatDuration(event.durationMs)
      : null

  const accent = KIND_ACCENT[event.kind]
  const kindLabel = event.kind.toLowerCase()

  const showFooter =
    event.kind === 'bash' ||
    event.kind === 'edit' ||
    event.kind === 'write' ||
    event.kind === 'read'

  // Platform-aware super key (⌘ on macOS, Ctrl elsewhere) so the placeholder
  // footer hints don't show a macOS-only key on Windows/Linux.
  const modKey = formatShortcut('Mod')

  return (
    <>
      {/* Accent stripe */}
      <span
        className="absolute left-3 right-3 top-0 h-[2px] opacity-[0.55]"
        style={{
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        }}
      />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        {/* Kind chip */}
        <div
          className="inline-flex h-5 items-center gap-[5px] rounded-[5px] border px-2 pl-1.5 font-mono text-[10px] font-semibold lowercase tracking-[0.06em]"
          style={{
            backgroundColor: `${accent}1f`,
            borderColor: `${accent}3d`,
            color: accent,
          }}
        >
          <span
            className="material-symbols-outlined text-[11px]"
            aria-hidden="true"
          >
            {KIND_ICON[event.kind]}
          </span>
          {kindLabel}
        </div>

        {/* Meta pips */}
        <Pip>
          <Dot />
          {ago}
        </Pip>
        {duration ? <Pip>{duration}</Pip> : null}

        <span className="flex-1" />

        {/* Copy */}
        <div className="flex shrink-0 items-center gap-2">
          <span
            aria-live="polite"
            className="min-w-10 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8a8299]"
          >
            {copyFeedback}
          </span>
          <button
            type="button"
            aria-label={copyButtonLabel}
            onClick={(): void => {
              void handleCopy()
            }}
            className="grid h-[22px] w-[22px] place-items-center rounded border-none transition-colors duration-[160ms] ease-in-out"
            style={{
              background:
                copyState !== 'copied' && isHovered
                  ? 'rgba(255,255,255,0.05)'
                  : 'transparent',
              color:
                copyState === 'copied'
                  ? '#7defa1'
                  : isHovered
                    ? '#e2c7ff'
                    : '#8a8299',
            }}
            onMouseEnter={(): void => setIsHovered(true)}
            onMouseLeave={(): void => setIsHovered(false)}
          >
            <span
              className="material-symbols-outlined text-xs"
              aria-hidden="true"
            >
              {copyState === 'copied' ? 'check' : 'content_copy'}
            </span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-3.5 py-1 pb-3">
        {event.kind === 'bash' ||
        event.kind === 'grep' ||
        event.kind === 'glob' ||
        event.kind === 'meta' ? (
          <CommandBlock cmd={event.body} accent={accent} />
        ) : null}

        {event.kind === 'edit' ||
        event.kind === 'write' ||
        event.kind === 'read' ? (
          <FilePathChip path={event.body} accent={accent} />
        ) : null}

        {event.kind === 'think' ? (
          <div
            className="border-l-2 pl-3 text-[13px] leading-[1.55] italic text-[#cdc3d1]"
            style={{ borderColor: `${accent}66` }}
          >
            {event.body}
          </div>
        ) : null}

        {event.kind === 'user' ? (
          <div className="text-[13px] leading-[1.55] text-[#e3e0f7]">
            {event.body}
          </div>
        ) : null}
      </div>

      {/* Footer */}
      {showFooter ? (
        <div className="flex items-center gap-2 border-t border-[rgba(74,68,79,0.25)] bg-[rgba(13,13,28,0.6)] px-3.5 py-[7px] font-mono text-[9.5px] tracking-[0.04em] text-[#6c7086]">
          {event.kind === 'bash' && (
            <>
              <Kbd>↵</Kbd> rerun <Kbd>{modKey}</Kbd>
              <Kbd>O</Kbd> open in terminal
            </>
          )}
          {(event.kind === 'edit' || event.kind === 'write') && (
            <>
              <Kbd>{modKey}</Kbd>
              <Kbd>O</Kbd> open file <Kbd>{modKey}</Kbd>
              <Kbd>D</Kbd> view diff
            </>
          )}
          {event.kind === 'read' && (
            <>
              <Kbd>{modKey}</Kbd>
              <Kbd>O</Kbd> open file
            </>
          )}
          <span className="flex-1" />
          <span className="text-[#4a444f]">esc</span>
        </div>
      ) : null}
    </>
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

  const timestampText = computeAgo(event, now)

  return (
    <Tooltip
      content={<ActivityTooltipContent event={event} now={now} />}
      placement="left"
      bare
      interactive
      ariaLabel={`${label} activity details`}
      className={ACTIVITY_CARD_SURFACE}
    >
      <article
        ref={rowRef}
        aria-label={label}
        aria-posinset={ariaPosInSet}
        aria-setsize={ariaSetSize}
        tabIndex={tabIndex}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        className="flex items-start gap-2 rounded-md py-1 cursor-default select-none outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
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
