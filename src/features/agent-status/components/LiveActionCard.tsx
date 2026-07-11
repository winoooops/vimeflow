import { type KeyboardEvent, type ReactElement } from 'react'
import { Chip } from '@/components/Chip'
import { ActivityDetailsTooltip, computeAgo, getLabel } from './ActivityEvent'
import type { ActivityEvent as ActivityEventType } from '../types/activityEvent'

interface LiveActionCardProps {
  event: ActivityEventType
  now: Date
  diff?: { added: number; removed: number } | null
  pathLabel?: string
  onActivate?: () => void
}

const SECTION_LABEL =
  'mb-2 px-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-muted'

export const LiveActionCard = ({
  event,
  now,
  diff = null,
  pathLabel = undefined,
  onActivate = undefined,
}: LiveActionCardProps): ReactElement => {
  // Mirror the feed's label logic so meta tools show their name (not 'META')
  // and test-file edits keep their CREATED/UPDATED TEST wording.
  const verb = getLabel(event)
  const ago = computeAgo(event, now)
  const interactive = onActivate !== undefined

  // role=button divs don't fire click on Enter/Space like native buttons do.
  const handleKeyDown = (
    keyboardEvent: KeyboardEvent<HTMLDivElement>
  ): void => {
    if (!interactive) {
      return
    }
    if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
      keyboardEvent.preventDefault()
      onActivate()
    }
  }

  const card = (
    <div
      data-testid="live-action-card"
      role={interactive ? 'button' : undefined}
      tabIndex={0}
      aria-label={`${verb} ${pathLabel ?? event.body}`}
      onClick={interactive ? onActivate : undefined}
      onKeyDown={handleKeyDown}
      className={`rounded-lg border border-primary-container/20 bg-surface-container-high px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-container/50 ${
        interactive
          ? 'cursor-pointer hover:border-primary-container/40 hover:bg-surface-container-highest'
          : ''
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="material-symbols-outlined text-[13px] text-primary"
          aria-hidden="true"
        >
          bolt
        </span>
        <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.05em] text-primary">
          {verb}
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[10.5px] text-on-surface-muted">
          {ago}
        </span>
      </div>

      <div className="mt-1.5 truncate font-mono text-[11px] text-on-surface-variant">
        {pathLabel ?? event.body}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        {diff ? (
          <>
            <span className="font-mono text-[10px] text-success">
              +{diff.added}
            </span>
            <span className="font-mono text-[10px] text-error">
              −{diff.removed}
            </span>
          </>
        ) : null}
        <span className="flex-1" />
        <Chip
          tone="custom"
          radius="pill"
          size="custom"
          className="gap-1 rounded-full bg-success/[0.12] px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.06em] text-success-muted"
        >
          LIVE
        </Chip>
      </div>
    </div>
  )

  return (
    <div className="px-4 pb-3 pt-3.5">
      <div className={SECTION_LABEL}>NOW</div>
      <ActivityDetailsTooltip
        event={event}
        now={now}
        ariaLabel={`${verb} live action details`}
        onActivate={onActivate}
      >
        {card}
      </ActivityDetailsTooltip>
    </div>
  )
}
