import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactElement } from 'react'
import { SettingsDialog } from './SettingsDialog'
import {
  SETTINGS_SECTIONS,
  SETTINGS_TARGET_IDS,
  keymapCommandTargetId,
} from './sections'
import { DEFAULT_SETTINGS } from './store/settingsDefaults'
import { SettingsProvider } from './SettingsProvider'

const render = (ui: ReactElement): ReturnType<typeof rtlRender> =>
  rtlRender(ui, { wrapper: SettingsProvider })

const installScrollByMock = (): {
  scrollBy: ReturnType<typeof vi.fn>
  restore: () => void
} => {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollBy'
  )
  const scrollBy = vi.fn()

  Object.defineProperty(HTMLElement.prototype, 'scrollBy', {
    configurable: true,
    value: scrollBy,
  })

  return {
    scrollBy,
    restore: (): void => {
      if (descriptor !== undefined) {
        Object.defineProperty(HTMLElement.prototype, 'scrollBy', descriptor)

        return
      }

      delete (
        HTMLElement.prototype as unknown as {
          scrollBy?: HTMLElement['scrollBy']
        }
      ).scrollBy
    },
  }
}

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
      expect(screen.getByRole('option', { name: s.label })).toBeInTheDocument()
    })
  })

  test('defaults to the appearance pane', () => {
    render(<SettingsDialog open onClose={vi.fn()} />)

    expect(screen.getByRole('option', { name: 'Appearance' })).toHaveClass(
      'text-primary'
    )
    expect(screen.getByText('Color Scheme')).toBeInTheDocument()
  })

  test('switches panes when a sidebar section is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onClose={vi.fn()} />)

    await user.click(screen.getByRole('option', { name: 'Keymap' }))

    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument()
  })

  test('filters sidebar sections via search', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('Search settings...'), 'term')

    expect(screen.getByRole('option', { name: 'Terminal' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'General' })).toBeNull()
  })

  test('surfaces font setting rows and jumps to the selected result', async () => {
    const user = userEvent.setup()

    const scrollIntoView = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined)
    render(<SettingsDialog open onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('Search settings...'), 'font')

    expect(screen.getByRole('option', { name: 'UI Font' })).toBeInTheDocument()

    expect(
      screen.getByRole('option', { name: 'Mono Font' })
    ).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'UI Font' }))

    const target = screen.getByTestId(
      `settings-target-${SETTINGS_TARGET_IDS.appearanceUiFont}`
    )

    await waitFor(() => {
      expect(target).toHaveFocus()
    })

    expect(target).toHaveAttribute('data-settings-target-active', 'true')
    expect(scrollIntoView).toHaveBeenCalled()

    scrollIntoView.mockRestore()
  })

  test('navigates subsection clicks to the first matching settings row', async () => {
    const user = userEvent.setup()

    const scrollIntoView = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined)
    render(<SettingsDialog open onClose={vi.fn()} />)

    await user.click(screen.getByRole('option', { name: 'Fonts' }))

    const target = screen.getByTestId(
      `settings-target-${SETTINGS_TARGET_IDS.appearanceUiFont}`
    )

    await waitFor(() => {
      expect(target).toHaveFocus()
    })

    expect(
      screen.getByRole('option', { name: 'Fonts', current: 'location' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(target).toHaveAttribute('data-settings-target-active', 'true')
    expect(scrollIntoView).toHaveBeenCalled()

    scrollIntoView.mockRestore()
  })

  test('clears search from the search field button', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onClose={vi.fn()} />)

    const input = screen.getByPlaceholderText('Search settings...')

    await user.type(input, 'term')

    expect(input).toHaveValue('term')
    expect(screen.queryByRole('option', { name: 'General' })).toBeNull()

    await user.click(
      screen.getByRole('button', { name: 'Clear settings search' })
    )

    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(screen.getByRole('option', { name: 'General' })).toBeInTheDocument()
  })

  test('navigates search result clicks to the matching settings row', async () => {
    const user = userEvent.setup()

    const scrollIntoView = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined)
    render(<SettingsDialog open onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('Search settings...'), 'redact')
    await user.click(
      screen.getByRole('option', { name: 'Redact Private Values' })
    )

    const target = screen.getByTestId(
      `settings-target-${SETTINGS_TARGET_IDS.generalRedactPrivateValues}`
    )

    await waitFor(() => {
      expect(target).toHaveFocus()
    })

    expect(
      screen.getByRole('option', { name: 'General', current: 'page' })
    ).toBeInTheDocument()
    expect(target).toHaveAttribute('data-settings-target-active', 'true')
    expect(scrollIntoView).toHaveBeenCalled()

    scrollIntoView.mockRestore()
  })

  test('navigates search results with arrow keys without leaving the search field', async () => {
    const user = userEvent.setup()

    const scrollIntoView = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined)
    render(<SettingsDialog open onClose={vi.fn()} />)

    const input = screen.getByPlaceholderText('Search settings...')

    await user.type(input, 'redact')
    await user.keyboard('{ArrowDown}')

    const target = screen.getByTestId(
      `settings-target-${SETTINGS_TARGET_IDS.generalRedactPrivateValues}`
    )

    await waitFor(() => {
      expect(target).toHaveAttribute('data-settings-target-active', 'true')
    })

    expect(input).toHaveFocus()
    expect(
      screen.getByRole('option', { name: 'General', current: 'page' })
    ).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalled()

    scrollIntoView.mockRestore()
  })

  test('starts default arrow navigation at the first visible search result', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onClose={vi.fn()} />)

    const input = screen.getByPlaceholderText('Search settings...')

    await user.click(input)
    await user.keyboard('{ArrowDown}')

    expect(input).toHaveFocus()
    expect(
      screen.getByRole('option', { name: 'General', current: 'page' })
    ).toBeInTheDocument()
  })

  test('scrolls active settings content with j and k', async () => {
    const user = userEvent.setup()
    const { scrollBy, restore } = installScrollByMock()

    try {
      render(<SettingsDialog open onClose={vi.fn()} />)

      await user.keyboard('j')

      expect(scrollBy).toHaveBeenLastCalledWith({
        behavior: 'smooth',
        top: 96,
      })

      await user.keyboard('k')

      expect(scrollBy).toHaveBeenLastCalledWith({
        behavior: 'smooth',
        top: -96,
      })
    } finally {
      restore()
    }
  })

  test('does not scroll settings content when j and k are typed in search', async () => {
    const user = userEvent.setup()
    const { scrollBy, restore } = installScrollByMock()

    try {
      render(<SettingsDialog open onClose={vi.fn()} />)

      const input = screen.getByPlaceholderText('Search settings...')

      await user.type(input, 'jk')

      expect(input).toHaveValue('jk')
      expect(scrollBy).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  test('navigates settings sections with arrow keys outside search input', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onClose={vi.fn()} />)

    await user.keyboard('{ArrowDown}')

    expect(
      screen.getByRole('option', { name: 'Keymap', current: 'page' })
    ).toBeInTheDocument()

    await user.keyboard('{ArrowUp}')

    expect(
      screen.getByRole('option', { name: 'Appearance', current: 'page' })
    ).toBeInTheDocument()
  })

  test('does not confirm a search result on Enter with an empty query and no selection', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onClose={vi.fn()} />)

    const input = screen.getByPlaceholderText('Search settings...')

    await user.click(input)
    await user.keyboard('{Enter}')

    expect(input).toHaveFocus()
    expect(
      screen.getByRole('option', { name: 'Appearance', current: 'page' })
    ).toBeInTheDocument()
  })

  test('keeps command palette and leader keymap targets independently navigable', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onClose={vi.fn()} />)

    await user.type(
      screen.getByPlaceholderText('Search settings...'),
      'command palette'
    )

    expect(
      screen.getByRole('option', { name: 'Open command palette' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('option', { name: 'Command palette leader' })
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('option', { name: 'Command palette leader' })
    )

    const target = screen.getByTestId(
      `settings-target-${keymapCommandTargetId('palette-leader')}`
    )

    await waitFor(() => {
      expect(target).toHaveFocus()
    })

    expect(
      screen.getByRole('option', { name: 'Keymap', current: 'page' })
    ).toBeInTheDocument()
    expect(target).toHaveAttribute('data-settings-target-active', 'true')
  })

  test('Tab from a focused search result moves to the setting control', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('Search settings...'), 'redact')
    await user.click(
      screen.getByRole('option', { name: 'Redact Private Values' })
    )

    const target = screen.getByTestId(
      `settings-target-${SETTINGS_TARGET_IDS.generalRedactPrivateValues}`
    )

    await waitFor(() => {
      expect(target).toHaveFocus()
    })

    await user.tab()

    expect(
      screen.getByRole('switch', { name: 'Redact Private Values' })
    ).toHaveFocus()
  })

  test('renders the close shortcut without a dead navbar focus hint', () => {
    render(<SettingsDialog open onClose={vi.fn()} />)

    expect(screen.queryByText('Focus')).toBeNull()
    expect(screen.queryByText('Navbar')).toBeNull()
    expect(screen.getByText('j')).toBeInTheDocument()
    expect(screen.getByText('k')).toBeInTheDocument()
    expect(screen.getByText('scroll')).toBeInTheDocument()
    expect(screen.getByText('↑')).toBeInTheDocument()
    expect(screen.getByText('↓')).toBeInTheDocument()
    expect(screen.getByText('navigate')).toBeInTheDocument()
    expect(screen.getByText('esc')).toBeInTheDocument()
  })

  test('keeps placeholder pane visible when active section is filtered out', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onClose={vi.fn()} />)

    // Click a placeholder section (Terminal)
    await user.click(screen.getByRole('option', { name: 'Terminal' }))

    // Type a query that filters Terminal out of the sidebar
    await user.type(
      screen.getByPlaceholderText('Search settings...'),
      'general'
    )

    // Terminal button should be gone from sidebar
    expect(screen.queryByRole('option', { name: 'Terminal' })).toBeNull()

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

  test('keeps Tab from recorder on the next keymap control', async () => {
    const user = userEvent.setup()
    render(<DialogWithTrigger initialOpen />)

    await user.click(screen.getByRole('option', { name: 'Keymap' }))
    await user.click(
      screen.getByRole('button', { name: 'Edit Focus pane 1 binding' })
    )

    expect(
      screen.getByRole('button', { name: 'Capture Focus pane 1 binding' })
    ).toHaveFocus()

    await user.tab()

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Capture Focus pane 1 binding' })
      ).not.toBeInTheDocument()
    })

    expect(
      screen.getByRole('button', { name: 'Edit Focus pane 2 binding' })
    ).toHaveFocus()
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

    expect(screen.queryByRole('option', { name: 'General' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(trigger)

    expect(screen.getByRole('option', { name: 'General' })).toBeInTheDocument()

    expect(
      screen.getByRole('option', { name: 'Appearance' })
    ).toBeInTheDocument()
  })
})
