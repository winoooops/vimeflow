import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { EmptySlot } from './EmptySlot'

describe('EmptySlot', () => {
  test('renders an add pane button', () => {
    render(<EmptySlot sessionId="s1" onAddPane={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'add pane' })).toBeInTheDocument()
  })

  test('clicking add pane calls onAddPane with the session id', async () => {
    const user = userEvent.setup()
    const onAddPane = vi.fn()

    render(<EmptySlot sessionId="s1" onAddPane={onAddPane} />)

    await user.click(screen.getByRole('button', { name: 'add pane' }))

    expect(onAddPane).toHaveBeenCalledOnce()
    expect(onAddPane).toHaveBeenCalledWith('s1')
  })
})
