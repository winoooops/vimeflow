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

  test('keeps expanded top-bar chrome draggable around the toggle slot on macOS', () => {
    renderTopBar({
      reserveWindowControls: true,
    })

    expect(screen.getByTestId('sidebar-top-bar')).not.toHaveClass(
      'vf-app-drag-region'
    )

    expect(screen.getByTestId('sidebar-top-bar-upper-drag-region')).toHaveClass(
      'vf-app-drag-region'
    )

    expect(screen.getByTestId('sidebar-top-bar-left-drag-region')).toHaveClass(
      'vf-app-drag-region'
    )

    expect(screen.getByTestId('sidebar-top-bar-toggle-clearance')).toHaveClass(
      'vf-app-no-drag'
    )

    expect(screen.getByTestId('sidebar-top-bar-right-drag-region')).toHaveClass(
      'vf-app-drag-region'
    )

    expect(screen.getByTestId('sidebar-top-bar-lower-drag-region')).toHaveClass(
      'vf-app-drag-region'
    )
  })

  test('does not apply drag-region class on non-macOS platforms', () => {
    const dragRegionTestIds = [
      'sidebar-top-bar-upper-drag-region',
      'sidebar-top-bar-left-drag-region',
      'sidebar-top-bar-right-drag-region',
      'sidebar-top-bar-lower-drag-region',
    ]

    renderTopBar({
      reserveWindowControls: false,
    })

    expect(screen.getByTestId('sidebar-top-bar')).not.toHaveClass(
      'vf-app-drag-region'
    )

    dragRegionTestIds.forEach((testId) => {
      expect(screen.getByTestId(testId)).not.toHaveClass('vf-app-drag-region')
    })
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
