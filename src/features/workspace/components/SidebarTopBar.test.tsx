import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { SidebarTopBar, type SidebarTopBarProps } from './SidebarTopBar'

const renderTopBar = (
  props: Partial<SidebarTopBarProps> = {}
): ReturnType<typeof render> =>
  render(<SidebarTopBar commandShortcutHint="Ctrl+;" {...props} />)

describe('SidebarTopBar', () => {
  test('does not render the persistent sidebar toggle', () => {
    renderTopBar()

    expect(
      screen.queryByTestId('sidebar-toggle-topbar')
    ).not.toBeInTheDocument()
  })

  test('keeps empty expanded top-bar chrome draggable while utilities remain clickable on macOS', () => {
    renderTopBar({
      onCommand: vi.fn(),
      onSettings: vi.fn(),
      reserveWindowControls: true,
    })

    expect(screen.getByTestId('sidebar-top-bar')).toHaveClass(
      'vf-app-drag-region'
    )

    expect(screen.getByRole('button', { name: 'Command Palette' })).toHaveClass(
      'vf-app-no-drag'
    )

    expect(screen.getByRole('button', { name: 'Settings' })).toHaveClass(
      'vf-app-no-drag'
    )
  })

  test('does not apply drag-region class on non-macOS platforms', () => {
    renderTopBar({
      onCommand: vi.fn(),
      onSettings: vi.fn(),
      reserveWindowControls: false,
    })

    expect(screen.getByTestId('sidebar-top-bar')).not.toHaveClass(
      'vf-app-drag-region'
    )
  })

  test('the Command Palette button is icon-only and fires onCommand', async () => {
    const user = userEvent.setup()
    const onCommand = vi.fn()
    renderTopBar({ onCommand, commandShortcutHint: 'Ctrl+;' })

    const button = screen.getByRole('button', { name: 'Command Palette' })
    // Icon-only: the shortcut lives in the tooltip, not inline on the button.
    expect(button).not.toHaveTextContent('Ctrl+;')

    await user.click(button)

    expect(onCommand).toHaveBeenCalledTimes(1)
  })

  test('utilities use the project tooltip, not a native title attribute', () => {
    renderTopBar({ onCommand: vi.fn() })

    expect(
      screen.getByRole('button', { name: 'Command Palette' })
    ).not.toHaveAttribute('title')
  })

  test('hovering the Command Palette button surfaces the tooltip with the shortcut chip', async () => {
    const user = userEvent.setup()
    renderTopBar({ onCommand: vi.fn(), commandShortcutHint: 'Ctrl+;' })

    await user.hover(screen.getByRole('button', { name: 'Command Palette' }))

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Command Palette')
    expect(screen.getByTestId('tooltip-shortcut')).toHaveTextContent('Ctrl+;')
  })

  test('Settings renders as a disabled stub when no handler is wired', async () => {
    const user = userEvent.setup()
    const onCommand = vi.fn()
    renderTopBar({ onCommand, settingsIssueNumber: 252 })

    const settings = screen.getByRole('button', { name: /^Settings/ })
    expect(settings).toHaveAttribute('aria-disabled', 'true')
    expect(settings).toHaveAccessibleName(/issue #252/)

    // Clicking the disabled stub is a no-op (must not throw / call anything).
    await user.click(settings)
    expect(onCommand).not.toHaveBeenCalled()
  })

  test('Settings enables and fires onSettings when a handler is provided', async () => {
    const user = userEvent.setup()
    const onSettings = vi.fn()
    renderTopBar({ onSettings })

    const settings = screen.getByRole('button', { name: /^Settings/ })
    expect(settings).not.toHaveAttribute('aria-disabled')

    await user.click(settings)

    expect(onSettings).toHaveBeenCalledTimes(1)
  })
})
