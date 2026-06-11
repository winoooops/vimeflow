import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { SidebarTopBar, type SidebarTopBarProps } from './SidebarTopBar'

const renderTopBar = (
  props: Partial<SidebarTopBarProps> = {}
): ReturnType<typeof render> => render(<SidebarTopBar {...props} />)

describe('SidebarTopBar', () => {
  test('does not render the persistent sidebar toggle', () => {
    renderTopBar()

    expect(
      screen.queryByTestId('sidebar-toggle-topbar')
    ).not.toBeInTheDocument()
  })

  test('keeps empty expanded top-bar chrome draggable on macOS', () => {
    renderTopBar({
      reserveWindowControls: true,
    })

    expect(screen.getByTestId('sidebar-top-bar')).toHaveClass(
      'vf-app-drag-region'
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
