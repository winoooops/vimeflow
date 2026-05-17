import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { DockSwitcher } from './DockSwitcher'

describe('DockSwitcher', () => {
  test('renders four buttons: top / bottom / left / right', () => {
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

  test('does not render a Hidden button', () => {
    render(<DockSwitcher position="bottom" onPick={vi.fn()} />)

    expect(
      screen.queryByRole('button', { name: /dock: hidden/i })
    ).not.toBeInTheDocument()
  })

  test('active button uses lavender styling', () => {
    render(<DockSwitcher position="left" onPick={vi.fn()} />)

    const active = screen.getByRole('button', { name: /dock: left/i })
    expect(active).toHaveClass('text-[#cba6f7]')
    expect(active).toHaveClass('bg-[rgba(203,166,247,0.15)]')
  })

  test('inactive button has muted color', () => {
    render(<DockSwitcher position="bottom" onPick={vi.fn()} />)

    expect(screen.getByRole('button', { name: /dock: left/i })).toHaveClass(
      'text-[#8a8299]'
    )
  })

  test('clicking a button calls onPick with that position', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<DockSwitcher position="bottom" onPick={onPick} />)

    await user.click(screen.getByRole('button', { name: /dock: top/i }))

    expect(onPick).toHaveBeenCalledWith('top')
  })
})
