import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactElement } from 'react'
import { SettingsDialog } from './SettingsDialog'
import { SETTINGS_SECTIONS } from './sections'
import { DEFAULT_SETTINGS } from './store/settingsDefaults'
import { SettingsProvider } from './SettingsProvider'

const render = (ui: ReactElement): ReturnType<typeof rtlRender> =>
  rtlRender(ui, { wrapper: SettingsProvider })

const DialogWithTrigger = ({
  initialOpen = false,
}: {
  initialOpen?: boolean
}): ReactElement => {
  const [open, setOpen] = useState(initialOpen)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open settings
      </button>
      <SettingsDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    window.vimeflow = {
      settings: {
        load: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
        save: vi.fn().mockResolvedValue(undefined),
        openFile: vi.fn(),
      },
    } as unknown as Window['vimeflow']
  })

  afterEach(() => {
    delete window.vimeflow
  })

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

    await user.click(screen.getByRole('button', { name: 'Close' }))

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

  test('moves focus to the close button when opened', async () => {
    const user = userEvent.setup()
    render(<DialogWithTrigger />)

    await user.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  test('traps Tab focus inside the dialog', async () => {
    const user = userEvent.setup()
    render(<DialogWithTrigger initialOpen />)

    // Move focus to the last focusable element in the default Appearance pane
    // and press Tab; focus should wrap back to the close button.
    const lastFocusable = screen.getByLabelText('Mono font')

    lastFocusable.focus()
    await user.tab()

    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  test('restores focus to the triggering element on close', async () => {
    const user = userEvent.setup()
    render(<DialogWithTrigger />)

    const trigger = screen.getByRole('button', { name: 'Open settings' })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(trigger).toHaveFocus()
  })

  test('clears search query when the dialog is reopened', async () => {
    const user = userEvent.setup()
    render(<DialogWithTrigger />)

    const trigger = screen.getByRole('button', { name: 'Open settings' })
    await user.click(trigger)

    await user.type(screen.getByPlaceholderText('Search settings...'), 'term')

    expect(screen.queryByRole('button', { name: 'General' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(trigger)

    expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Appearance' })
    ).toBeInTheDocument()
  })
})
