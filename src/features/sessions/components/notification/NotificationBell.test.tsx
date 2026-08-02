import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { NotificationBell } from './NotificationBell'

describe('NotificationBell', () => {
  test('rests quietly at zero unread and toggles the panel', async () => {
    const onToggle = vi.fn()
    render(<NotificationBell unread={0} onToggle={onToggle} />)

    const bell = screen.getByRole('button', { name: 'Notifications, 0 unread' })
    expect(bell).toHaveAttribute('aria-haspopup', 'dialog')
    expect(bell).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(bell)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  test('shows the plain count in primary without an alert', () => {
    render(<NotificationBell unread={3} panelOpen onToggle={vi.fn()} />)

    const bell = screen.getByRole('button', { name: 'Notifications, 3 unread' })
    expect(bell).toHaveClass('text-primary')
    expect(bell).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('3')).toHaveClass('bg-primary-container')
  })

  test('caps the count badge at 9+ and promotes alerts to error tint', () => {
    render(<NotificationBell unread={12} unreadAlert onToggle={vi.fn()} />)

    const bell = screen.getByRole('button', {
      name: 'Notifications, 12 unread',
    })
    expect(bell).toHaveClass('text-error')
    expect(screen.getByText('9+')).toHaveClass('bg-error-dim')
  })
})
