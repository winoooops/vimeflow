import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { EmptySlot } from './EmptySlot'

describe('EmptySlot', () => {
  test('renders shell and browser add pane buttons', () => {
    render(<EmptySlot sessionId="s1" slotId="slot:test" onAddPane={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: 'add shell pane' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'add browser pane' })
    ).toBeInTheDocument()
  })

  test('clicking add shell pane calls onAddPane with shell kind and slot id', async () => {
    const user = userEvent.setup()
    const onAddPane = vi.fn()

    render(
      <EmptySlot sessionId="s1" slotId="slot:test" onAddPane={onAddPane} />
    )

    await user.click(screen.getByRole('button', { name: 'add shell pane' }))

    expect(onAddPane).toHaveBeenCalledOnce()
    expect(onAddPane).toHaveBeenCalledWith('s1', 'shell', 'slot:test')
  })

  test('clicking add browser pane calls onAddPane with browser kind and slot id', async () => {
    const user = userEvent.setup()
    const onAddPane = vi.fn()

    render(
      <EmptySlot sessionId="s1" slotId="slot:test" onAddPane={onAddPane} />
    )

    await user.click(screen.getByRole('button', { name: 'add browser pane' }))

    expect(onAddPane).toHaveBeenCalledOnce()
    expect(onAddPane).toHaveBeenCalledWith('s1', 'browser', 'slot:test')
  })

  test('shows only the allowed kind when accepts restricts the slot', () => {
    render(
      <EmptySlot
        sessionId="s1"
        slotId="slot:test"
        accepts={['browser']}
        onAddPane={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'add browser pane' })
    ).toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: 'add shell pane' })
    ).not.toBeInTheDocument()
  })

  test('shows both kinds when accepts is undefined', () => {
    render(<EmptySlot sessionId="s1" slotId="slot:test" onAddPane={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: 'add shell pane' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'add browser pane' })
    ).toBeInTheDocument()
  })

  test('shows both kinds when accepts is empty (no restriction)', () => {
    render(
      <EmptySlot
        sessionId="s1"
        slotId="slot:test"
        accepts={[]}
        onAddPane={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'add shell pane' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'add browser pane' })
    ).toBeInTheDocument()
  })
})
