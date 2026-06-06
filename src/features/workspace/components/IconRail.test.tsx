import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IconRail } from './IconRail'

describe('IconRail', () => {
  test('does not render the placeholder account avatar (removed, VIM-66)', () => {
    render(<IconRail settingsIssueNumber={1} />)
    expect(screen.queryByRole('img', { name: 'Account' })).toBeNull()
  })

  test('does not render the sidebar toggle while the sidebar is expanded', () => {
    render(<IconRail settingsIssueNumber={1} onToggleSidebar={vi.fn()} />)
    expect(screen.queryByTestId('sidebar-toggle-rail')).toBeNull()
  })

  test('renders the expand toggle when collapsed and fires onToggleSidebar', async () => {
    const user = userEvent.setup()
    const onToggleSidebar = vi.fn()
    render(
      <IconRail
        settingsIssueNumber={1}
        sidebarCollapsed
        onToggleSidebar={onToggleSidebar}
      />
    )
    const toggle = screen.getByTestId('sidebar-toggle-rail')

    expect(toggle).toHaveAttribute('aria-label', 'Show sidebar')

    await user.click(toggle)
    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
  })

  test('renders the command palette button with stable aria-label', () => {
    render(<IconRail settingsIssueNumber={1} />)
    const button = screen.getByRole('button', { name: 'Command Palette' })

    expect(button).toBeInTheDocument()
    expect(screen.getByTestId('icon-rail-search-icon')).toHaveAttribute(
      'aria-hidden',
      'true'
    )
    expect(screen.getByText('search')).toHaveClass('material-symbols-outlined')
  })

  test('fires onCommand when the command palette button is clicked', async () => {
    const user = userEvent.setup()
    const onCommand = vi.fn()
    render(<IconRail settingsIssueNumber={1} onCommand={onCommand} />)

    await user.click(screen.getByRole('button', { name: 'Command Palette' }))

    expect(onCommand).toHaveBeenCalledTimes(1)
  })

  test('renders the settings button as aria-disabled and interpolates the issue number on hover', async () => {
    const user = userEvent.setup()
    render(<IconRail settingsIssueNumber={42} />)
    const settings = screen.getByRole('button', { name: 'Settings' })

    expect(settings).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('icon-rail-settings-icon')).toHaveAttribute(
      'aria-hidden',
      'true'
    )

    expect(screen.getByText('settings')).toHaveClass(
      'material-symbols-outlined'
    )

    await user.hover(settings)

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Settings panel coming — see issue #42')
  })

  test('does NOT fire onSettings when the disabled gear is clicked', async () => {
    const user = userEvent.setup()
    const onSettings = vi.fn()
    render(<IconRail settingsIssueNumber={42} onSettings={onSettings} />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))

    expect(onSettings).not.toHaveBeenCalled()
  })

  test('ignores items and settingsItem props for backward compatibility', () => {
    const noop = vi.fn()

    render(
      <IconRail
        settingsIssueNumber={1}
        items={[
          {
            id: 'a',
            name: 'A',
            icon: 'add',
            color: 'bg-red-500',
            onClick: noop,
          },
        ]}
        settingsItem={{
          id: 'settings',
          name: 'Settings',
          icon: 'settings',
          color: 'bg-indigo-500',
          onClick: noop,
        }}
      />
    )
    expect(screen.queryAllByRole('button')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'A' })).toBeNull()
  })
})
