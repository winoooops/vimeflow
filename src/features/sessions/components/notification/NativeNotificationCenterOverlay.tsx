import type { ReactElement } from 'react'
import type { NativeOverlayHostDialogRenderer } from '@/components/NativeOverlayHost'
import { Popover, type PopoverPlacement } from '@/components/Popover'
import { NotificationPanel } from './NotificationPanel'

export const renderNativeNotificationCenterOverlay: NativeOverlayHostDialogRenderer =
  ({ request, close, dispatchAction }): ReactElement | null => {
    if (request.payload.dialog !== 'notification-center') {
      return null
    }

    const payload = request.payload
    const itemById = new Map(payload.items.map((item) => [item.id, item]))

    return (
      <Popover
        anchor={request.anchorRect}
        open
        onOpenChange={(open): void => {
          if (!open) {
            close()
          }
        }}
        placement={request.placement as PopoverPlacement}
        offset={0}
        width={440}
        aria-label={payload.ariaLabel}
        focus="dialog-unfocused"
        className="vf-notification-panel overflow-hidden rounded-2xl bg-surface-container/[.97] shadow-[0_20px_52px_color-mix(in_srgb,var(--color-scrim)_50%,transparent)]"
      >
        <NotificationPanel
          items={payload.items}
          onOpen={(id): void => {
            const item = itemById.get(id)
            if (item !== undefined) {
              dispatchAction({
                actionId: item.openActionId,
                closeOnSelect: true,
              })
            }
          }}
          onDismiss={(id): void => {
            const item = itemById.get(id)
            if (item !== undefined) {
              dispatchAction({
                actionId: item.dismissActionId,
                closeOnSelect: false,
              })
            }
          }}
          onMarkAllRead={(): void => {
            dispatchAction({
              actionId: payload.actions.markAllRead,
              closeOnSelect: false,
            })
          }}
          onClear={(): void => {
            dispatchAction({
              actionId: payload.actions.clear,
              closeOnSelect: true,
            })
          }}
          onClosePanel={(): void => {
            dispatchAction({
              actionId: payload.actions.close,
              closeOnSelect: true,
            })
          }}
        />
      </Popover>
    )
  }
