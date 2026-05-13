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

  test('add pane click does not bubble to parent slots', async () => {
    const user = userEvent.setup()
    const onParentClick = vi.fn()

    render(
      <div onClick={onParentClick}>
        <EmptySlot sessionId="s1" onAddPane={vi.fn()} />
      </div>
    )

    await user.click(screen.getByRole('button', { name: 'add pane' }))

    expect(onParentClick).not.toHaveBeenCalled()
  })
})
