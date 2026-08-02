import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { NativeOverlayNotificationCenterItem } from '@/components/Popover'
import { NotificationPanel } from './NotificationPanel'

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
})
