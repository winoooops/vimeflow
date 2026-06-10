import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { SidebarTopBar, type SidebarTopBarProps } from './SidebarTopBar'

const renderTopBar = (
  props: Partial<SidebarTopBarProps> = {}
): ReturnType<typeof render> =>
  render(<SidebarTopBar onToggleSidebar={vi.fn()} {...props} />)

describe('SidebarTopBar', () => {
  test('renders the collapse toggle on the left', () => {
    renderTopBar()

    expect(screen.getByTestId('sidebar-toggle-topbar')).toBeInTheDocument()
  })

  test('keeps empty expanded top-bar chrome draggable while controls remain clickable on macOS', () => {
    renderTopBar({
      reserveWindowControls: true,
    })

    expect(screen.getByTestId('sidebar-top-bar')).toHaveClass(
      'vf-app-drag-region'
    )

    expect(screen.getByTestId('sidebar-toggle-topbar')).toHaveClass(
      'vf-app-no-drag'
    )
  })

  test('does not apply drag-region class on non-macOS platforms', () => {
    renderTopBar({
      reserveWindowControls: false,
    })

    expect(screen.getByTestId('sidebar-top-bar')).not.toHaveClass(
      'vf-app-drag-region'
    )
  })

  test('the toggle invokes onToggleSidebar', async () => {
    const user = userEvent.setup()
    const onToggleSidebar = vi.fn()
    renderTopBar({ onToggleSidebar })

    await user.click(screen.getByTestId('sidebar-toggle-topbar'))

    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
  })

  test('does not render sidebar utility buttons in the traffic-light row', () => {
    renderTopBar()

    expect(
      screen.queryByRole('button', { name: 'Command Palette' })
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: /^Settings/ })
    ).not.toBeInTheDocument()
  })
})
