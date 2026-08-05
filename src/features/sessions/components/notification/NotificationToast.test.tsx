import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { AGENTS } from '@/agents/registry'
import type { NotificationRecord } from '../../hooks/useNotificationCenter'
import { NotificationToast } from './NotificationToast'

const record: NotificationRecord = {
  id: 'n1',
  sessionId: 'session-1',
  ptyId: 'pty-1',
  reason: 'approval-requested',
  title: 'Claude needs approval',
  body: 'Awaiting your approval',
  occurredAt: 1,
  read: false,
}

const display = { record, sessionName: 'notify-center', agent: AGENTS.claude }

const setupToast = (
  overrides: Partial<React.ComponentProps<typeof NotificationToast>> = {}
): React.ComponentProps<typeof NotificationToast> => {
  const handlers = {
    visible: true,
    display,
    coalescedCount: 0,
    onOpenPanel: vi.fn(),
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onHoldDwell: vi.fn(),
    onStartDwell: vi.fn(),
    ...overrides,
  }

  render(<NotificationToast {...handlers} />)

  return handlers
}

describe('NotificationToast', () => {
  test('renders nothing before the first arrival', () => {
    setupToast({ display: null })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('routes body, open, and close actions by record id', async () => {
    const handlers = setupToast()
    const user = userEvent.setup()

    await user.click(
      screen.getByRole('button', {
        name: 'Open notification center for Claude needs approval: Awaiting your approval',
      })
    )
    expect(handlers.onOpenPanel).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(handlers.onOpen).toHaveBeenCalledWith('n1')

    await user.click(
      screen.getByRole('button', { name: 'Dismiss notification toast' })
    )
    expect(handlers.onClose).toHaveBeenCalledOnce()
  })

  test('shows the coalesced counter only when arrivals coalesce', () => {
    setupToast({ coalescedCount: 2 })

    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.getByRole('status', { hidden: true })).toHaveTextContent(
      'Claude needs approval'
    )
  })

  test('shows the notification message in the arrival toast', () => {
    setupToast()

    expect(screen.getByText('Awaiting your approval')).toHaveClass('truncate')
    expect(
      screen.getByRole('button', {
        name: 'Open notification center for Claude needs approval: Awaiting your approval',
      })
    ).toBeInTheDocument()
  })

  test('holds toast dwell while keyboard focus is inside', async () => {
    const handlers = setupToast()
    const user = userEvent.setup()

    await user.tab()
    expect(handlers.onHoldDwell).toHaveBeenCalledOnce()

    await user.tab()
    expect(handlers.onStartDwell).not.toHaveBeenCalled()

    await user.tab()
    await user.tab()
    expect(handlers.onStartDwell).toHaveBeenCalledOnce()
  })

  test('keeps dwell held until pointer and keyboard focus both leave', async () => {
    const handlers = setupToast()
    const user = userEvent.setup()
    const toast = screen.getByRole('status', { hidden: true })

    await user.hover(toast)
    await user.tab()
    await user.unhover(toast)

    expect(handlers.onHoldDwell).toHaveBeenCalledTimes(2)
    expect(handlers.onStartDwell).not.toHaveBeenCalled()

    await user.tab()
    await user.tab()
    await user.tab()

    expect(handlers.onStartDwell).toHaveBeenCalledOnce()
  })

  test('leaves the a11y tree when the island is not in the toast stage', () => {
    setupToast({ visible: false })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
