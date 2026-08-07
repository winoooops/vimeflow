import type { ReactElement, ReactNode } from 'react'
import { Popover } from '@/components/Popover'
import type { NotificationRecord } from '../../hooks/useNotificationCenter'
import type { Session } from '../../types'
import { NotificationBell } from './NotificationBell'
import { NotificationPanel } from './NotificationPanel'
import { NotificationToast } from './NotificationToast'
import {
  ISLAND_STAGE_WIDTH,
  NOTIFICATION_PANEL_WIDTH_PX,
  useNotificationIslandStage,
  type IslandStage,
} from './useNotificationIslandStage'

const NAV_STAGE_CLASSES: Readonly<Record<IslandStage, string>> = {
  pill: 'shadow-none',
  badge: 'shadow-none',
  toast:
    'shadow-[0_10px_26px_color-mix(in_srgb,var(--color-scrim)_35%,transparent)]',
  panel: 'pointer-events-none opacity-0 shadow-none',
}

interface NotificationIslandProps {
  readonly records: readonly NotificationRecord[]
  readonly sessions: readonly Session[]
  readonly onOpen: (id: string) => void
  readonly onDismiss: (id: string) => void
  readonly onMarkAllRead: () => void
  readonly onClear: () => void
  readonly children: ReactNode
}

// Composition root for the island's four-stage notification center
// (pill → badge → toast → panel). The behavior lives in
// useNotificationIslandStage; the pieces are NotificationBell,
// NotificationToast, and NotificationPanel.
export const NotificationIsland = ({
  records,
  sessions,
  onOpen,
  onDismiss,
  onMarkAllRead,
  onClear,
  children,
}: NotificationIslandProps): ReactElement => {
  const island = useNotificationIslandStage({
    records,
    sessions,
    onOpen,
    onDismiss,
    onMarkAllRead,
    onClear,
  })

  return (
    <>
      <nav
        ref={island.rootRef}
        aria-label="Open sessions"
        data-testid="session-island"
        data-state={island.stage}
        data-native-overlay-active={
          island.nativeOverlayActive ? true : undefined
        }
        className={`vf-notification-island vf-app-no-drag absolute left-1/2 top-2 z-20 flex h-[28px] -translate-x-1/2 items-center gap-[4px] rounded-[18px] border border-outline/55 bg-surface-container/90 p-[5px] backdrop-blur-md backdrop-saturate-150 ${NAV_STAGE_CLASSES[island.stage]}`}
        style={{ width: ISLAND_STAGE_WIDTH[island.stage] }}
      >
        <span
          data-testid="notification-indicators"
          aria-hidden={island.stripHidden ? true : undefined}
          inert={island.stripHidden ? true : undefined}
          className={`vf-notification-indicators flex shrink-0 items-center gap-1 ${
            island.stage === 'badge' && island.unread > 0 ? 'pr-1' : ''
          }`}
        >
          {children}
          {island.stage !== 'pill' && (
            <NotificationBell
              ref={island.bellRef}
              unread={island.unread}
              unreadAlert={island.unreadAlert}
              panelOpen={island.panelOpen}
              onToggle={island.togglePanel}
            />
          )}
        </span>

        <NotificationToast
          ref={island.toastButtonRef}
          visible={island.stage === 'toast'}
          display={island.displayToast}
          coalescedCount={island.coalescedCount}
          onOpenPanel={island.openPanel}
          onOpen={island.openRecord}
          onClose={island.closeToast}
          onHoldDwell={island.holdToastDwell}
          onStartDwell={island.startToastDwell}
        />
      </nav>

      <Popover
        anchor={island.panelAnchor}
        open={island.panelOpen}
        onOpenChange={island.handlePanelOpenChange}
        placement="bottom"
        offset={0}
        width={NOTIFICATION_PANEL_WIDTH_PX}
        aria-label="Notification center"
        focus="dialog-unfocused"
        // The island restores bell focus itself (with focusVisible: false),
        // so the focus manager must not also refocus on close — its plain
        // focus() would paint the keyboard focus ring after an Escape exit.
        // eslint-disable-next-line react/jsx-boolean-value -- returnFocus defaults to true; explicit false is required
        returnFocus={false}
        nativeOverlay
        nativeOverlayPayload={island.notificationPayload}
        nativeOverlayActions={island.nativeActions}
        onNativeOverlayActiveChange={island.setNativeOverlayActive}
        // z-50 restores the floating layer that GLASS_SURFACE normally
        // supplies: a custom className replaces the default, and without the
        // explicit layer the portaled panel (z-auto) paints under the dock
        // panel (z-30). macOS native runtime is unaffected — the local panel
        // unmounts whenever the native overlay window takes over.
        className={`vf-notification-panel z-50 overflow-hidden rounded-2xl bg-surface-container/[.97] shadow-[0_20px_52px_color-mix(in_srgb,var(--color-scrim)_50%,transparent)] ${
          island.panelClosing ? 'vf-notification-panel-closing' : ''
        }`}
      >
        <NotificationPanel
          items={island.panelItems}
          freshId={island.freshId}
          onOpen={island.openRecord}
          onDismiss={island.dismissRecord}
          onMarkAllRead={onMarkAllRead}
          onClear={onClear}
          onClosePanel={island.closePanel}
        />
      </Popover>
    </>
  )
}
