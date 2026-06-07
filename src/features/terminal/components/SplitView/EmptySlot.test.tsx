import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { EmptySlot } from './EmptySlot'

describe('EmptySlot', () => {
  test('renders shell and browser add pane buttons', () => {
    render(<EmptySlot sessionId="s1" onAddPane={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: 'add shell pane' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'add browser pane' })
    ).toBeInTheDocument()
  })

  test('clicking add shell pane calls onAddPane with shell kind', async () => {
    const user = userEvent.setup()
    const onAddPane = vi.fn()

    render(<EmptySlot sessionId="s1" onAddPane={onAddPane} />)

    await user.click(screen.getByRole('button', { name: 'add shell pane' }))

    expect(onAddPane).toHaveBeenCalledOnce()
    expect(onAddPane).toHaveBeenCalledWith('s1', 'shell')
  })

  test('clicking add browser pane calls onAddPane with browser kind', async () => {
    const user = userEvent.setup()
    const onAddPane = vi.fn()

    render(<EmptySlot sessionId="s1" onAddPane={onAddPane} />)

    await user.click(screen.getByRole('button', { name: 'add browser pane' }))

    expect(onAddPane).toHaveBeenCalledOnce()
    expect(onAddPane).toHaveBeenCalledWith('s1', 'browser')
  })
})
