import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsDialog } from './SettingsDialog'
import { SETTINGS_SECTIONS } from './sections'

describe('SettingsDialog', () => {
  test('returns null and renders no dialog when open is false', () => {
    // eslint-disable-next-line react/jsx-boolean-value
    render(<SettingsDialog open={false} onClose={vi.fn()} />)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('renders the dialog with aria-label when open is true', () => {
    render(<SettingsDialog open onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  test('calls onClose when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SettingsDialog open onClose={onClose} />)

    await user.click(screen.getByTestId('settings-dialog-backdrop'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SettingsDialog open onClose={onClose} />)

    await user.click(screen.getByTitle('close'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('renders the sidebar sections', () => {
    render(<SettingsDialog open onClose={vi.fn()} />)

    SETTINGS_SECTIONS.forEach((s) => {
      expect(screen.getByRole('button', { name: s.label })).toBeInTheDocument()
    })
  })

  test('defaults to the appearance pane', () => {
    render(<SettingsDialog open onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveClass(
      'text-primary'
    )
    expect(screen.getByText('Color Scheme')).toBeInTheDocument()
  })

  test('switches panes when a sidebar section is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Keymap' }))

    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument()
  })

  test('filters sidebar sections via search', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('Search settings...'), 'term')

    expect(screen.getByRole('button', { name: 'Terminal' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'General' })).toBeNull()
  })

  test('renders the footer hint and close shortcut', () => {
    render(<SettingsDialog open onClose={vi.fn()} />)

    expect(screen.getByText('Focus')).toBeInTheDocument()
    expect(screen.getByText('Navbar')).toBeInTheDocument()
    expect(screen.getByText('esc')).toBeInTheDocument()
  })

  test('keeps placeholder pane visible when active section is filtered out', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onClose={vi.fn()} />)

    // Click a placeholder section (Terminal)
    await user.click(screen.getByRole('button', { name: 'Terminal' }))

    // Type a query that filters Terminal out of the sidebar
    await user.type(
      screen.getByPlaceholderText('Search settings...'),
      'general'
    )

    // Terminal button should be gone from sidebar
    expect(screen.queryByRole('button', { name: 'Terminal' })).toBeNull()

    // But the placeholder pane for Terminal should still render
    expect(
      screen.getByText(/Terminal settings haven't been wired yet/)
    ).toBeInTheDocument()
  })
})
