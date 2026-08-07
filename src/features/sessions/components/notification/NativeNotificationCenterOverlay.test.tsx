import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { NativeOverlayDialogRequest } from '@/components/Popover'
import { renderNativeNotificationCenterOverlay } from './NativeNotificationCenterOverlay'
import type { NativeOverlayNotificationCenterDialogPayload } from './useNotificationIslandStage'

const payload: NativeOverlayNotificationCenterDialogPayload = {
  kind: 'dialog',
  dialog: 'notification-center',
  ariaLabel: 'Notification center',
  items: [
    {
      id: 'notice-1',
      kind: 'need',
      title: 'Claude needs approval',
      sessionName: 'notifications',
      agentId: 'claude',
      occurredAt: Date.now(),
      read: false,
      openActionId: 'notification:open:notice-1',
      dismissActionId: 'notification:dismiss:notice-1',
    },
  ],
  actions: {
    markAllRead: 'notification:mark-all-read',
    clear: 'notification:clear',
    close: 'notification:close',
  },
}

const request: NativeOverlayDialogRequest = {
  surfaceId: 'notification-center',
  kind: 'dialog',
  anchorRect: { x: 100, y: 8, width: 80, height: 28 },
  placement: 'bottom',
  payload,
}

describe('NativeNotificationCenterOverlay', () => {
  test('routes an outside press through the native host close', async () => {
    const close = vi.fn()

    const windowClose = vi
      .spyOn(window, 'close')
      .mockImplementation(() => undefined)
    const outside = document.createElement('button')
    outside.textContent = 'Outside'
    document.body.appendChild(outside)

    try {
      render(
        renderNativeNotificationCenterOverlay({
          request,
          close,
          dispatchAction: vi.fn(),
          actionResult: null,
        })
      )

      await userEvent.click(outside)

      expect(close).toHaveBeenCalledOnce()
      expect(windowClose).not.toHaveBeenCalled()
    } finally {
      outside.remove()
      windowClose.mockRestore()
    }
  })

  test('routes row and footer actions through the native host', async () => {
    const dispatchAction = vi.fn()
    const user = userEvent.setup()

    render(
      renderNativeNotificationCenterOverlay({
        request,
        close: vi.fn(),
        dispatchAction,
        actionResult: null,
      })
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

    expect(dispatchAction).toHaveBeenNthCalledWith(1, {
      actionId: 'notification:open:notice-1',
      closeOnSelect: true,
    })

    expect(dispatchAction).toHaveBeenNthCalledWith(2, {
      actionId: 'notification:dismiss:notice-1',
      closeOnSelect: false,
    })

    expect(dispatchAction).toHaveBeenNthCalledWith(3, {
      actionId: 'notification:mark-all-read',
      closeOnSelect: false,
    })

    expect(dispatchAction).toHaveBeenNthCalledWith(4, {
      actionId: 'notification:clear',
      closeOnSelect: true,
    })

    expect(dispatchAction).toHaveBeenNthCalledWith(5, {
      actionId: 'notification:close',
      closeOnSelect: true,
    })
  })
})
