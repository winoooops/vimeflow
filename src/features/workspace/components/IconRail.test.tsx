import { describe, test, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IconRail } from './IconRail'
import { mockNavigationItems, mockSettingsItem } from '../data/mockNavigation'

describe('IconRail', () => {
  test('renders with 64px width', () => {
    render(
      <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />
    )

    const rail = screen.getByTestId('icon-rail')
    expect(rail).toHaveClass('w-16') // 64px (16 * 4 = 64)
  })

  test('uses bg-surface with border-r border-white/5', () => {
    render(
      <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />
    )

    const rail = screen.getByTestId('icon-rail')
    expect(rail).toHaveClass('bg-surface')
    expect(rail).toHaveClass('border-r')
    expect(rail).toHaveClass('border-white/5')
  })

  test('renders all navigation items', () => {
    render(
      <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />
    )

    expect(
      screen.getByRole('button', { name: 'Dashboard' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Source Control' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Debugger' })).toBeInTheDocument()
  })

  test('renders settings item at bottom', () => {
    render(
      <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />
    )

    const settingsButton = screen.getByRole('button', { name: 'Settings' })
    expect(settingsButton).toBeInTheDocument()
  })

  test('bookmark buttons have flat-bookmark class', () => {
    render(
      <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />
    )

    const dashboardButton = screen.getByRole('button', { name: 'Dashboard' })
    expect(dashboardButton).toHaveClass('flat-bookmark')
  })

  test('bookmarks have correct dimensions (w-8 h-12)', () => {
    render(
      <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />
    )

    const dashboardButton = screen.getByRole('button', { name: 'Dashboard' })
    expect(dashboardButton).toHaveClass('w-8')
    expect(dashboardButton).toHaveClass('h-12')
  })

  test('bookmarks have correct color backgrounds', () => {
    render(
      <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />
    )

    const dashboardButton = screen.getByRole('button', { name: 'Dashboard' })

    const sourceControlButton = screen.getByRole('button', {
      name: 'Source Control',
    })
    const debuggerButton = screen.getByRole('button', { name: 'Debugger' })
    const settingsButton = screen.getByRole('button', { name: 'Settings' })

    expect(dashboardButton).toHaveClass('bg-emerald-500')
    expect(sourceControlButton).toHaveClass('bg-amber-500')
    expect(debuggerButton).toHaveClass('bg-rose-500')
    // Settings uses a plain icon style, not a colored bookmark
    expect(settingsButton).toBeInTheDocument()
  })

  test('bookmarks contain Material Symbols icons', () => {
    render(
      <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />
    )

    const dashboardButton = screen.getByRole('button', { name: 'Dashboard' })

    // Icon text should be present in the button
    expect(within(dashboardButton).getByText('dashboard')).toBeInTheDocument()
  })

  test('shows item name as tooltip on hover', async () => {
    const user = userEvent.setup()
    render(
      <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />
    )

    await user.hover(screen.getByRole('button', { name: 'Dashboard' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Dashboard')
  })

  test('shows settings item name as tooltip on hover', async () => {
    const user = userEvent.setup()
    render(
      <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />
    )

    await user.hover(
      screen.getByRole('button', { name: mockSettingsItem.name })
    )

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      mockSettingsItem.name
    )
  })

  test('calls onClick when navigation item is clicked', async () => {
    const handleClick = vi.fn()
    const user = userEvent.setup()

    const items = [
      {
        ...mockNavigationItems[0],
        onClick: handleClick,
      },
    ]

    render(<IconRail items={items} settingsItem={mockSettingsItem} />)

    const dashboardButton = screen.getByRole('button', { name: 'Dashboard' })
    await user.click(dashboardButton)

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  test('calls onClick when settings item is clicked', async () => {
    const handleClick = vi.fn()
    const user = userEvent.setup()

    const settingsItem = {
      ...mockSettingsItem,
      onClick: handleClick,
    }

    render(<IconRail items={mockNavigationItems} settingsItem={settingsItem} />)

    const settingsButton = screen.getByRole('button', { name: 'Settings' })
    await user.click(settingsButton)

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  test('renders with empty items array', () => {
    render(<IconRail items={[]} settingsItem={mockSettingsItem} />)

    // Should still render settings button
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  test('navigation items appear before settings in DOM order', () => {
    render(
      <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />
    )

    const buttons = screen.getAllByRole('button')
    const dashboardButton = screen.getByRole('button', { name: 'Dashboard' })
    const settingsButton = screen.getByRole('button', { name: 'Settings' })

    const dashboardIndex = buttons.indexOf(dashboardButton)
    const settingsIndex = buttons.indexOf(settingsButton)

    expect(dashboardIndex).toBeLessThan(settingsIndex)
  })
})
