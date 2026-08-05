import type { ReactElement } from 'react'
import { AGENTS } from '@/agents/registry'
import { AgentGlyph } from '@/components/AgentGlyph'
import { Button } from '@/components/Button'
import { IconButton } from '@/components/IconButton'
import type { NativeOverlayNotificationCenterItem } from '@/components/Popover'

interface NotificationPanelProps {
  readonly items: readonly NativeOverlayNotificationCenterItem[]
  readonly freshId?: string | null
  readonly onOpen: (id: string) => void
  readonly onDismiss: (id: string) => void
  readonly onMarkAllRead: () => void
  readonly onClear: () => void
  readonly onClosePanel: () => void
}

const MINI_BUTTON_CLASSES =
  'h-[18px] rounded-full px-2 text-[10px] font-semibold'

// Row geometry. Each row keeps its p-2 padding; the two text lines are pinned
// to explicit leadings (leading-4 + mt-[2px] + leading-[14px] = 32px of
// content) so every row is exactly 48px tall regardless of font metrics. The
// list/panel max-heights below are derived from this pitch so the scroll edge
// always lands on a whole-row boundary — no half-clipped last row.
export const NOTIFICATION_ROW_HEIGHT_PX = 48

export const NOTIFICATION_ROW_GAP_PX = 2

export const NOTIFICATION_LIST_MAX_VISIBLE_ROWS = 6

const LIST_TOP_PADDING_PX = 7 // pt-[7px] on the first group container
const LIST_BOTTOM_PADDING_PX = 4 // pb-1 on the scroll container
const HEADER_HEIGHT_PX = 35 // p-[6px] + h-[22px] buttons + 1px border-b
const ALERTS_HEADING_HEIGHT_PX = 25

const rowsHeight = (count: number): number =>
  count * NOTIFICATION_ROW_HEIGHT_PX +
  Math.max(0, count - 1) * NOTIFICATION_ROW_GAP_PX

const listMaxHeight = (needsCount: number, alertsCount: number): number => {
  const visibleNeeds = Math.min(needsCount, NOTIFICATION_LIST_MAX_VISIBLE_ROWS)

  const visibleAlerts = Math.min(
    alertsCount,
    NOTIFICATION_LIST_MAX_VISIBLE_ROWS - visibleNeeds
  )

  return (
    (visibleNeeds > 0 ? LIST_TOP_PADDING_PX + rowsHeight(visibleNeeds) : 0) +
    (visibleAlerts > 0
      ? ALERTS_HEADING_HEIGHT_PX + rowsHeight(visibleAlerts)
      : 0) +
    LIST_BOTTOM_PADDING_PX
  )
}

const relativeTime = (occurredAt: number): string => {
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - occurredAt) / 60_000)
  )

  if (elapsedMinutes < 1) {
    return 'now'
  }

  if (elapsedMinutes < 60) {
    return `${String(elapsedMinutes)}m`
  }

  return `${String(Math.floor(elapsedMinutes / 60))}h`
}

const NotificationRow = ({
  item,
  fresh,
  onOpen,
  onDismiss,
}: {
  readonly item: NativeOverlayNotificationCenterItem
  readonly fresh: boolean
  readonly onOpen: (id: string) => void
  readonly onDismiss: (id: string) => void
}): ReactElement => {
  const agent = AGENTS[item.agentId]

  return (
    <div
      data-testid={`notification-row-${item.id}`}
      className={`${fresh ? 'vf-notification-row ' : ''}group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[10px] rounded-[10px] p-2 transition-[background-color,opacity] hover:bg-on-surface/5 group-focus-within:bg-on-surface/5 ${
        item.read ? 'opacity-60' : 'opacity-100'
      }`}
    >
      <button
        type="button"
        aria-label={`Open ${item.title} in ${item.sessionName}`}
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-[10px] rounded-md text-left focus-visible:outline-none"
        onClick={(): void => onOpen(item.id)}
      >
        <span
          aria-hidden="true"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg"
          style={{
            color: agent.accent,
            background: `color-mix(in srgb, ${agent.accent} 18%, transparent)`,
          }}
        >
          <AgentGlyph agent={agent} size={15} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11.5px] font-semibold leading-4 tracking-[-0.005em] text-on-surface">
            {item.title}
          </span>
          <span className="mt-[2px] block truncate text-[10.5px] leading-[14px] text-on-surface-muted">
            {item.sessionName}
            {item.body === undefined ? '' : ` · ${item.body}`}
          </span>
        </span>
      </button>

      <span className="flex shrink-0 items-center gap-[7px]">
        <span className="font-mono text-[9.5px] text-on-surface-muted group-hover:hidden group-focus-within:hidden">
          {relativeTime(item.occurredAt)}
        </span>
        <span className="hidden shrink-0 items-center gap-1 group-hover:flex group-focus-within:flex">
          <Button
            size="sm"
            variant="ghost"
            className={`${MINI_BUTTON_CLASSES} border border-outline/45 text-on-surface-variant hover:bg-on-surface/[.06] hover:text-on-surface`}
            onClick={(): void => onOpen(item.id)}
          >
            Open
          </Button>
          <IconButton
            icon="close"
            label={`Dismiss ${item.title} in ${item.sessionName}`}
            size="sm"
            tooltipPlacement="bottom"
            className="h-5 w-5 rounded-full border border-outline/45 text-[13px]"
            onClick={(): void => onDismiss(item.id)}
          />
        </span>
      </span>
    </div>
  )
}

const groupHeading = (label: string, count: number): ReactElement => (
  <div className="flex h-[25px] items-center justify-between px-[11px]">
    <h2 className="font-mono text-[9.5px] uppercase tracking-[.09em] text-on-surface-muted">
      {label}
    </h2>
    <span
      aria-label={`${String(count)} notifications`}
      className="font-mono text-[9.5px] text-on-surface-muted"
    >
      {count}
    </span>
  </div>
)

export const NotificationPanel = ({
  items,
  freshId = null,
  onOpen,
  onDismiss,
  onMarkAllRead,
  onClear,
  onClosePanel,
}: NotificationPanelProps): ReactElement => {
  const needs = items.filter(({ kind }) => kind === 'need')
  const alerts = items.filter(({ kind }) => kind === 'err')
  const unread = items.filter(({ read }) => !read).length

  const notificationListMaxHeight = listMaxHeight(needs.length, alerts.length)

  const rows = (
    groupItems: readonly NativeOverlayNotificationCenterItem[]
  ): ReactElement[] =>
    groupItems.map((item) => (
      <NotificationRow
        key={item.id}
        item={item}
        fresh={item.id === freshId}
        onOpen={onOpen}
        onDismiss={onDismiss}
      />
    ))

  return (
    <div
      data-testid="notification-panel"
      className="flex flex-col"
      style={{ maxHeight: HEADER_HEIGHT_PX + notificationListMaxHeight }}
    >
      {/* Actions live on top in place of the "Needs you" heading, so the list
          keeps its full height; the unread count rides inside Mark all read. */}
      <header className="flex items-center gap-1 border-b border-outline-variant/50 bg-surface-container-lowest/45 p-[6px]">
        <Button
          size="sm"
          variant="ghost"
          disabled={unread === 0}
          className="h-[22px] rounded-md px-[9px] text-[10px] font-semibold"
          onClick={onMarkAllRead}
        >
          {unread > 0 ? `Mark all read (${unread})` : 'Mark all read'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={items.length === 0}
          className="h-[22px] rounded-md px-[9px] text-[10px] font-semibold"
          onClick={onClear}
        >
          Clear all
        </Button>
        <IconButton
          icon="close"
          label="Close notification center"
          size="sm"
          tooltipPlacement="bottom"
          className="ml-auto h-5 w-5 rounded-full text-[13px]"
          onClick={onClosePanel}
        />
      </header>
      <div
        data-testid="notification-list"
        className="overflow-y-auto pb-1"
        style={{ maxHeight: notificationListMaxHeight }}
      >
        {needs.length > 0 && (
          <div className="flex flex-col gap-[2px] px-[5px] pt-[7px]">
            {rows(needs)}
          </div>
        )}
        {alerts.length > 0 && (
          <section>
            {groupHeading('Alerts', alerts.length)}
            <div className="flex flex-col gap-[2px] px-[5px]">
              {rows(alerts)}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
