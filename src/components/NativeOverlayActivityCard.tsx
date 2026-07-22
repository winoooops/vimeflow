import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Button } from '@/components/Button'
import { Chip } from '@/components/Chip'
import { IconButton } from '@/components/IconButton'
import type {
  NativeOverlayActivityEvent,
  NativeOverlayActivityEventKind,
  NativeOverlayActivityToolEvent,
} from '@/components/nativeOverlayActivity'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'
import { formatDuration, formatRelativeTime } from '@/lib/relativeTime'

export const ACTIVITY_CARD_SURFACE =
  'relative w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-[10px] border border-outline-variant/45 bg-[color-mix(in_srgb,var(--color-surface-container)_96%,transparent)] font-sans shadow-[0_16px_48px_color-mix(in_srgb,var(--color-surface-container-lowest)_55%,transparent),0_0_0_1px_color-mix(in_srgb,var(--color-primary-container)_4%,transparent)] backdrop-blur-[20px] backdrop-saturate-[150%]'

export const ACTIVITY_KIND_ICON: Record<
  NativeOverlayActivityEventKind,
  string
> = {
  edit: 'edit',
  write: 'edit_note',
  read: 'visibility',
  bash: 'terminal',
  grep: 'search',
  glob: 'find_in_page',
  plan: 'checklist',
  wait: 'hourglass_top',
  agent: 'hub',
  web: 'language',
  interaction: 'forum',
  external: 'extension',
  think: 'psychology',
  user: 'person',
  meta: 'tune',
}

export const ACTIVITY_KIND_COLOR: Record<
  NativeOverlayActivityEventKind,
  string
> = {
  edit: 'text-primary-container',
  write: 'text-primary-container',
  read: 'text-on-surface-variant',
  bash: 'text-secondary',
  grep: 'text-on-surface-variant',
  glob: 'text-on-surface-variant',
  plan: 'text-primary-container',
  wait: 'text-tertiary',
  agent: 'text-secondary',
  web: 'text-tertiary',
  interaction: 'text-tertiary',
  external: 'text-on-surface-variant',
  think: 'text-primary-container',
  user: 'text-tertiary',
  meta: 'text-on-surface-muted',
}

export const activityBodyClass = (
  kind: NativeOverlayActivityEventKind
): string => {
  if (kind === 'think') {
    return 'text-xs text-on-surface italic'
  }
  if (kind === 'user') {
    return 'text-xs text-on-surface'
  }

  return 'text-xs text-on-surface font-mono'
}

export const computeActivityAgo = (
  event: NativeOverlayActivityEvent,
  now: Date
): string =>
  event.status === 'running'
    ? `running ${formatDuration(Math.max(0, now.getTime() - new Date(event.timestamp).getTime()))}`
    : formatRelativeTime(event.timestamp, now)

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

const isToolEvent = (
  event: NativeOverlayActivityEvent
): event is NativeOverlayActivityToolEvent => 'tool' in event

const buildCopyText = (event: NativeOverlayActivityEvent): string =>
  'resultPreview' in event && event.resultPreview
    ? `${event.body}\n\n${event.resultPreview}`
    : event.body

interface ActivityPopoverContentProps {
  event: NativeOverlayActivityEvent
  now: Date
  onShowDiff?: () => void
  showDiffShortcut?: string
  showDiffAriaShortcut?: string
}

const KIND_ACCENT: Record<NativeOverlayActivityEventKind, string> = {
  bash: 'var(--color-secondary)',
  edit: 'var(--color-primary)',
  write: 'var(--color-primary)',
  read: 'var(--color-on-surface-muted)',
  grep: 'var(--color-secondary)',
  glob: 'var(--color-secondary)',
  plan: 'var(--color-primary)',
  wait: 'var(--color-tertiary)',
  agent: 'var(--color-secondary)',
  web: 'var(--color-tertiary)',
  interaction: 'var(--color-agent-shell-accent)',
  external: 'var(--color-on-surface-muted)',
  meta: 'var(--color-secondary)',
  think: 'var(--color-secondary-dim)',
  user: 'var(--color-agent-shell-accent)',
}

const Pip = ({ children }: { children: ReactNode }): ReactElement => (
  <span className="inline-flex items-center gap-[3px] whitespace-nowrap font-mono text-[10px] text-on-surface-muted">
    {children}
  </span>
)

const Dot = (): ReactElement => (
  <span className="mr-px text-outline-variant">·</span>
)

const CommandBlock = ({
  cmd,
  accent,
  prompt,
}: {
  cmd: string
  accent: string
  prompt: string | undefined
}): ReactElement => (
  <pre
    className={`relative m-0 max-h-[12rem] overflow-y-auto rounded-md border border-outline-variant/30 bg-[color-mix(in_srgb,var(--color-surface-container-lowest)_55%,transparent)] p-2 font-mono text-[11px] leading-[1.55] text-on-surface-variant ${prompt ? 'pl-6' : ''}`}
  >
    {prompt ? (
      <span
        className="absolute left-[10px] top-2 text-sm"
        style={{ color: accent, opacity: 0.8 }}
      >
        {prompt}
      </span>
    ) : null}
    <span className="whitespace-pre-wrap break-all text-on-surface">{cmd}</span>
  </pre>
)

const FilePathChip = ({
  path,
  accent,
}: {
  path: string
  accent: string
}): ReactElement => {
  const sepIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const dir = sepIndex >= 0 ? path.slice(0, sepIndex + 1) : ''
  const file = sepIndex >= 0 ? path.slice(sepIndex + 1) : path

  return (
    <div className="flex items-start gap-1.5 rounded-md border border-outline-variant/30 bg-[color-mix(in_srgb,var(--color-surface-container-lowest)_55%,transparent)] px-2.5 py-2 font-mono text-[11.5px]">
      <span
        className="material-symbols-outlined shrink-0 text-xs"
        style={{ color: accent, transform: 'translateY(2px)' }}
        aria-hidden="true"
      >
        draft
      </span>
      <span className="min-w-0 break-all">
        <span className="text-syn-comment">{dir}</span>
        <span className="font-semibold text-on-surface">{file}</span>
      </span>
    </div>
  )
}

const Kbd = ({ children }: { children: ReactNode }): ReactElement => (
  <Chip
    tone="custom"
    size="custom"
    radius="chip"
    className="justify-center rounded border border-outline-variant/35 bg-[color-mix(in_srgb,var(--color-surface-container-lowest)_50%,transparent)] px-1 py-px font-mono text-[9.5px] text-syn-comment"
  >
    {children}
  </Chip>
)

export const NativeOverlayActivityCard = ({
  event,
  now,
  onShowDiff = undefined,
  showDiffShortcut = undefined,
  showDiffAriaShortcut = undefined,
}: ActivityPopoverContentProps): ReactElement => {
  const [copyState, setCopyState] = useState<CopyState>('idle')
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
      ? 'Copied trace details'
      : copyState === 'failed'
        ? 'Copy failed, try again'
        : 'Copy trace details'

  const copyFeedback =
    copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : ''

  const isRunning = event.status === 'running'
  const ago = computeActivityAgo(event, now)

  const duration =
    isToolEvent(event) && !isRunning && event.durationMs != null
      ? formatDuration(event.durationMs)
      : null
  const accent = KIND_ACCENT[event.kind]

  const kindLabel = isToolEvent(event)
    ? event.label.toLowerCase()
    : event.kind.toLowerCase()

  const showsFilePath =
    event.kind === 'edit' || event.kind === 'write' || event.kind === 'read'

  return (
    <>
      <span
        className="absolute left-3 right-3 top-0 h-[2px] opacity-[0.55]"
        style={{
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        }}
      />

      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <Chip
          tone="custom"
          size="custom"
          radius="chip"
          leadingIcon={ACTIVITY_KIND_ICON[event.kind]}
          label={kindLabel}
          iconClassName="material-symbols-outlined text-[11px]"
          className="h-5 gap-[5px] rounded-[5px] border px-2 pl-1.5 font-mono text-[10px] font-semibold lowercase tracking-[0.06em]"
          style={{
            backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
            borderColor: `color-mix(in srgb, ${accent} 24%, transparent)`,
            color: accent,
          }}
        />

        <Pip>
          <Dot />
          {ago}
        </Pip>
        {duration ? <Pip>{duration}</Pip> : null}

        <span className="flex-1" />

        <div className="flex shrink-0 items-center gap-2">
          <span
            aria-live="polite"
            className="min-w-10 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-on-surface-muted"
          >
            {copyFeedback}
          </span>
          <IconButton
            icon={copyState === 'copied' ? 'check' : 'content_copy'}
            label={copyButtonLabel}
            variant="ghost"
            size="sm"
            showTooltip={TOOLTIP_SUPPRESSED}
            onClick={(): void => {
              void handleCopy()
            }}
            className={
              copyState === 'copied' ? 'text-agent-codex-accent' : undefined
            }
          />
        </div>
      </div>

      <div className="px-3.5 py-1 pb-3">
        {isToolEvent(event) && !showsFilePath ? (
          <CommandBlock
            cmd={event.body}
            accent={accent}
            prompt={event.kind === 'bash' ? '$' : undefined}
          />
        ) : null}

        {showsFilePath ? (
          <FilePathChip path={event.body} accent={accent} />
        ) : null}

        {event.kind === 'think' ? (
          <div
            className="border-l-2 pl-3 text-[13px] leading-[1.55] italic text-on-surface-variant"
            style={{
              borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`,
            }}
          >
            {event.body}
          </div>
        ) : null}

        {event.kind === 'user' ? (
          <div className="text-[13px] leading-[1.55] text-on-surface">
            {event.body}
          </div>
        ) : null}
      </div>

      {onShowDiff === undefined ? null : (
        <div className="flex items-center border-t border-outline-variant/25 bg-[color-mix(in_srgb,var(--color-surface-container-lowest)_60%,transparent)] px-3.5 py-[7px]">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leadingIcon="difference"
            aria-label="Show diff"
            aria-keyshortcuts={showDiffAriaShortcut}
            onClick={onShowDiff}
            className="gap-1.5 px-2 font-mono text-[10px] text-on-surface-variant"
          >
            Show diff
            {showDiffShortcut === undefined ? null : (
              <Kbd>{showDiffShortcut}</Kbd>
            )}
          </Button>
        </div>
      )}
    </>
  )
}
