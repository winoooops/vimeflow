import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { SidebarSettingsFooter } from './SidebarSettingsFooter'

describe('SidebarSettingsFooter', () => {
  test('renders Settings as visible bottom-sidebar text', () => {
    render(<SidebarSettingsFooter settingsIssueNumber={252} />)

    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-settings-footer')).toHaveClass(
      'vf-app-no-drag'
    )
  })

  test('renders as a disabled stub when no handler is wired', async () => {
    const user = userEvent.setup()
    render(<SidebarSettingsFooter settingsIssueNumber={252} />)

    const settings = screen.getByRole('button', { name: /^Settings/ })
    expect(settings).toHaveAttribute('aria-disabled', 'true')
    expect(settings).toHaveAccessibleName(/issue #252/)

    await user.click(settings)
  })

  test('fires onSettings when a handler is provided', async () => {
    const user = userEvent.setup()
    const onSettings = vi.fn()
    render(<SidebarSettingsFooter onSettings={onSettings} />)

    const settings = screen.getByRole('button', { name: 'Settings' })
    expect(settings).not.toHaveAttribute('aria-disabled')

    await user.click(settings)

    expect(onSettings).toHaveBeenCalledTimes(1)
  })
})
