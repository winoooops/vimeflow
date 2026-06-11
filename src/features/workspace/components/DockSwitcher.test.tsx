import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { DockSwitcher } from './DockSwitcher'

describe('DockSwitcher', () => {
  test('renders top / bottom / left / right buttons', () => {
    render(<DockSwitcher position="bottom" onPick={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: /dock: top/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /dock: bottom/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /dock: left/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /dock: right/i })
    ).toBeInTheDocument()
  })

  test('clicking Top calls onPick with "top"', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<DockSwitcher position="bottom" onPick={onPick} />)

    await user.click(screen.getByRole('button', { name: /dock: top/i }))

    expect(onPick).toHaveBeenCalledWith('top')
  })

  test('does not render a Hidden button', () => {
    render(<DockSwitcher position="bottom" onPick={vi.fn()} />)

    expect(
      screen.queryByRole('button', { name: /dock: hidden/i })
    ).not.toBeInTheDocument()
  })

  test('active button uses lavender styling', () => {
    render(<DockSwitcher position="left" onPick={vi.fn()} />)

    const active = screen.getByRole('button', { name: /dock: left/i })
    expect(active).toHaveClass('text-primary-container')
    expect(active).toHaveClass('bg-primary-container/15')
  })

  test('inactive button has muted color', () => {
    render(<DockSwitcher position="bottom" onPick={vi.fn()} />)

    expect(screen.getByRole('button', { name: /dock: left/i })).toHaveClass(
      'text-on-surface-muted'
    )
  })

  test('clicking a button calls onPick with that position', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<DockSwitcher position="bottom" onPick={onPick} />)

    await user.click(screen.getByRole('button', { name: /dock: right/i }))

    expect(onPick).toHaveBeenCalledWith('right')
  })

  test('hovering a position button shows a plain Dock: <position> tooltip', async () => {
    const user = userEvent.setup()
    render(<DockSwitcher position="bottom" onPick={vi.fn()} />)

    await user.hover(screen.getByRole('button', { name: /dock: top/i }))
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Dock: Top')
    // Dock position has no keyboard shortcut — the chip must not render.
    expect(within(tip).queryByTestId('tooltip-shortcut')).toBeNull()
  })
})
