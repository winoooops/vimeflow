import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import {
  NOTIFICATION_LIST_MAX_VISIBLE_ROWS,
  NOTIFICATION_ROW_GAP_PX,
  NOTIFICATION_ROW_HEIGHT_PX,
  NotificationPanel,
} from './NotificationPanel'
import type { NativeOverlayNotificationCenterItem } from './useNotificationIslandStage'

const items: readonly NativeOverlayNotificationCenterItem[] = [
  {
    id: 'need',
    kind: 'need',
    title: 'Claude needs approval',
    body: 'Edit WorkspaceView.tsx',
    sessionName: 'notifications',
    agentId: 'claude',
    occurredAt: Date.now(),
    read: false,
    openActionId: 'open:need',
    dismissActionId: 'dismiss:need',
  },
  {
    id: 'error',
    kind: 'err',
    title: 'Codex failed',
    sessionName: 'release',
    agentId: 'codex',
    occurredAt: Date.now(),
    read: true,
    openActionId: 'open:error',
    dismissActionId: 'dismiss:error',
  },
]

const setupPanel = (
  overrides: Partial<React.ComponentProps<typeof NotificationPanel>> = {}
): React.ComponentProps<typeof NotificationPanel> => {
  const handlers = {
    items,
    onOpen: vi.fn(),
    onDismiss: vi.fn(),
    onMarkAllRead: vi.fn(),
    onClear: vi.fn(),
    onClosePanel: vi.fn(),
    ...overrides,
  }

  render(<NotificationPanel {...handlers} />)

  return handlers
}

describe('NotificationPanel', () => {
  test('groups items and routes row and header actions', async () => {
    const user = userEvent.setup()
    const handlers = setupPanel()

    // The top action bar replaces the "Needs you" heading; the unread count
    // rides inside Mark all read, and Alerts keeps its group heading.
    expect(
      screen.queryByRole('heading', { name: 'Needs you' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Alerts' })).toBeVisible()
    expect(screen.getByTestId('notification-row-error')).toHaveClass(
      'opacity-60'
    )

    await user.click(
      screen.getByRole('button', {
        name: 'Open Claude needs approval in notifications',
      })
    )

    await user.click(
      screen.getByRole('button', {
        name: 'Dismiss Claude needs approval in notifications',
      })
    )
    await user.click(screen.getByRole('button', { name: 'Mark all read (1)' }))
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    await user.click(
      screen.getByRole('button', { name: 'Close notification center' })
    )

    expect(handlers.onOpen).toHaveBeenCalledWith('need')
    expect(handlers.onDismiss).toHaveBeenCalledWith('need')
    expect(handlers.onMarkAllRead).toHaveBeenCalledOnce()
    expect(handlers.onClear).toHaveBeenCalledOnce()
    expect(handlers.onClosePanel).toHaveBeenCalledOnce()
  })

  test('animates only the requested fresh row', () => {
    setupPanel({ freshId: 'need' })

    expect(screen.getByTestId('notification-row-need')).toHaveClass(
      'vf-notification-row'
    )

    expect(screen.getByTestId('notification-row-error')).not.toHaveClass(
      'vf-notification-row'
    )
  })

  test('caps the list height on a whole-row boundary so no row is clipped', () => {
    const manyItems: readonly NativeOverlayNotificationCenterItem[] =
      Array.from(
        { length: NOTIFICATION_LIST_MAX_VISIBLE_ROWS + 3 },
        (_, i) => ({
          ...items[0],
          id: `need-${String(i)}`,
        })
      )

    setupPanel({ items: manyItems })

    // The scroll area's max-height must fit an exact integer number of rows:
    // strip the vertical paddings, add back one gap, and the remainder must
    // divide evenly by the row pitch (height + gap).
    const rowPitch = NOTIFICATION_ROW_HEIGHT_PX + NOTIFICATION_ROW_GAP_PX

    const notificationListMaxHeight =
      7 +
      NOTIFICATION_LIST_MAX_VISIBLE_ROWS * NOTIFICATION_ROW_HEIGHT_PX +
      (NOTIFICATION_LIST_MAX_VISIBLE_ROWS - 1) * NOTIFICATION_ROW_GAP_PX +
      4

    const fittableSpace =
      notificationListMaxHeight - 7 - 4 + NOTIFICATION_ROW_GAP_PX

    expect(fittableSpace % rowPitch).toBe(0)
    expect(fittableSpace / rowPitch).toBe(NOTIFICATION_LIST_MAX_VISIBLE_ROWS)

    // The rendered containers carry the computed heights, and every row
    // keeps its per-item padding.
    expect(screen.getByTestId('notification-panel')).toHaveStyle({
      maxHeight: `${String(35 + notificationListMaxHeight)}px`,
    })

    expect(screen.getByTestId('notification-list')).toHaveStyle({
      maxHeight: `${String(notificationListMaxHeight)}px`,
    })

    for (const row of screen.getAllByTestId(/^notification-row-/)) {
      expect(row).toHaveClass('p-2')
    }
  })

  test('includes the alerts heading when sizing a mixed list', () => {
    setupPanel({
      items: [
        ...Array.from({ length: 2 }, (_, index) => ({
          ...items[0],
          id: `need-${String(index)}`,
        })),
        ...Array.from({ length: 7 }, (_, index) => ({
          ...items[1],
          id: `error-${String(index)}`,
        })),
      ],
    })

    // Two need rows + the fixed 25px Alerts heading + four alert rows make
    // the first six notifications visible without clipping either group.
    expect(screen.getByTestId('notification-list')).toHaveStyle({
      maxHeight: '332px',
    })

    expect(screen.getByTestId('notification-panel')).toHaveStyle({
      maxHeight: '367px',
    })
  })
})
