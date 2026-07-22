import {
  type FocusEventHandler,
  type KeyboardEventHandler,
  type ReactElement,
  type Ref,
  useEffect,
  useState,
} from 'react'
import { Chip } from '@/components/Chip'
import {
  ACTIVITY_CARD_SURFACE,
  ACTIVITY_KIND_COLOR,
  ACTIVITY_KIND_ICON,
  NativeOverlayActivityCard,
  activityBodyClass,
  computeActivityAgo,
} from '@/components/NativeOverlayActivityCard'
import { Tooltip } from '@/components/Tooltip'
import { TERMINAL_CONTAINER_ID } from '@/features/workspace/containerIds'
import { useNativeActivityPopoverSource } from '../hooks/useNativeActivityPopover'
import type { ActivityEvent as ActivityEventType } from '../types/activityEvent'

interface ActivityEventProps {
  ariaPosInSet?: number
  ariaSetSize?: number
  event: ActivityEventType
  now: Date
  onFocus?: FocusEventHandler<HTMLElement>
  onKeyDown?: KeyboardEventHandler<HTMLElement>
  onShowDiff?: () => void
  showDiffShortcut?: string
  showDiffAriaShortcut?: string
  matchesShowDiffShortcut?: (event: KeyboardEvent) => boolean
  rowRef?: Ref<HTMLElement>
  tabIndex?: 0 | -1
}

export const getLabel = (event: ActivityEventType): string => {
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
  if ('tool' in event) {
    return event.label
  }

  return event.kind.toUpperCase()
}

export const computeAgo = computeActivityAgo

interface ActivityDetailsTooltipProps {
  event: ActivityEventType
  now: Date
  ariaLabel: string
  onActivate?: () => void
  onShowDiff?: () => void
  showDiffShortcut?: string
  showDiffAriaShortcut?: string
  matchesShowDiffShortcut?: (event: KeyboardEvent) => boolean
  children: ReactElement
}

const isEditorOrTerminalTarget = (element: Element): boolean =>
  element.closest('.cm-editor') !== null ||
  element.closest(`[data-container-id="${TERMINAL_CONTAINER_ID}"]`) !== null

const isGuardedShortcutSurface = (event: KeyboardEvent): boolean => {
  const target = event.target instanceof Element ? event.target : null

  const activeElement =
    document.activeElement instanceof Element ? document.activeElement : null

  return (
    (target !== null && isEditorOrTerminalTarget(target)) ||
    (activeElement !== null && isEditorOrTerminalTarget(activeElement))
  )
}

export const ActivityDetailsTooltip = ({
  event,
  now,
  ariaLabel,
  onActivate = undefined,
  onShowDiff = undefined,
  showDiffShortcut = undefined,
  showDiffAriaShortcut = undefined,
  matchesShowDiffShortcut = undefined,
  children,
}: ActivityDetailsTooltipProps): ReactElement => {
  const [open, setOpen] = useState(false)

  const { payload, actions } = useNativeActivityPopoverSource({
    event,
    ariaLabel,
    onActivate,
    onShowDiff,
    showDiffShortcut,
    showDiffAriaShortcut,
  })

  useEffect(() => {
    if (
      !open ||
      onShowDiff === undefined ||
      matchesShowDiffShortcut === undefined
    ) {
      return
    }

    const handleKeyDown = (keyboardEvent: KeyboardEvent): void => {
      if (
        keyboardEvent.repeat ||
        isGuardedShortcutSurface(keyboardEvent) ||
        !matchesShowDiffShortcut(keyboardEvent)
      ) {
        return
      }

      keyboardEvent.preventDefault()
      onShowDiff()
    }

    document.addEventListener('keydown', handleKeyDown, true)

    return (): void =>
      document.removeEventListener('keydown', handleKeyDown, true)
  }, [matchesShowDiffShortcut, onShowDiff, open])

  return (
    <Tooltip
      content={
        <NativeOverlayActivityCard
          event={event}
          now={now}
          onShowDiff={onShowDiff}
          showDiffShortcut={showDiffShortcut}
          showDiffAriaShortcut={showDiffAriaShortcut}
        />
      }
      placement="left"
      bare
      interactive
      ariaLabel={ariaLabel}
      className={ACTIVITY_CARD_SURFACE}
      nativeOverlay
      nativeOverlayPayload={payload}
      nativeOverlayActions={actions}
      onOpenChange={setOpen}
    >
      {children}
    </Tooltip>
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
        <Chip
          tone="custom"
          size="custom"
          radius="md"
          className={`rounded-md px-2 py-0.5 text-[9px] font-bold uppercase ${palette}`}
        >
          {text}
        </Chip>
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
  onShowDiff = undefined,
  showDiffShortcut = undefined,
  showDiffAriaShortcut = undefined,
  matchesShowDiffShortcut = undefined,
  rowRef = undefined,
  tabIndex = 0,
}: ActivityEventProps): ReactElement => {
  const symbol = ACTIVITY_KIND_ICON[event.kind]
  const colorClass = ACTIVITY_KIND_COLOR[event.kind]
  const label = getLabel(event)

  const timestampText = computeActivityAgo(event, now)

  return (
    <ActivityDetailsTooltip
      event={event}
      now={now}
      ariaLabel={`${label} trace details`}
      onShowDiff={onShowDiff}
      showDiffShortcut={showDiffShortcut}
      showDiffAriaShortcut={showDiffAriaShortcut}
      matchesShowDiffShortcut={matchesShowDiffShortcut}
    >
      <article
        ref={rowRef}
        data-event-id={event.id}
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
            className={`material-symbols-outlined flex h-6 w-6 items-center justify-center rounded-md bg-surface-container-high text-[16px] font-medium leading-none ${colorClass}`}
            aria-hidden="true"
          >
            {symbol}
          </span>
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
          <span
            className={`mt-0.5 block truncate ${activityBodyClass(event.kind)}`}
          >
            {event.body}
          </span>
          <StatusChips event={event} />
        </div>
      </article>
    </ActivityDetailsTooltip>
  )
}
