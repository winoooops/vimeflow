import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement, type ReactElement } from 'react'
import { DEFAULT_SETTINGS } from '../../store/settingsDefaults'
import { SettingsProvider, SettingsContext } from '../../SettingsProvider'
import type { AppSettings } from '../../../../bindings/AppSettings'
import { KEYMAP_CAPTURE_TARGET_ATTRIBUTE } from '../../../keymap/capture'
import { KeymapPane } from './KeymapPane'

const render = (ui: ReactElement): ReturnType<typeof rtlRender> =>
  rtlRender(ui, { wrapper: SettingsProvider })

// Direct-context render lets a test seed `customKeybindings` synchronously
// (bypassing the provider's async load).
const renderWithSettings = (
  customKeybindings: Record<string, string> = {}
): ReturnType<typeof rtlRender> & { update: ReturnType<typeof vi.fn> } => {
  const settings: AppSettings = { ...DEFAULT_SETTINGS, customKeybindings }
  const update = vi.fn()

  const view = rtlRender(
    createElement(
      SettingsContext.Provider,
      { value: { settings, saveError: null, update } },
      createElement(KeymapPane)
    )
  )

  return { ...view, update }
}

describe('KeymapPane', () => {
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
    vi.useRealTimers()
  })

  test('renders the pane title', () => {
    render(<KeymapPane />)

    expect(screen.getByText('Keymap')).toBeInTheDocument()
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument()
  })

  test('preset select defaults to vimeflow', () => {
    render(<KeymapPane />)

    expect(screen.getByLabelText('Keymap preset')).toHaveValue('vimeflow')
  })

  test('renders granular catalog rows including the current Diff keymap', () => {
    render(<KeymapPane />)

    // Granular catalog labels (one per command — replacing the old grouped rows).
    expect(screen.getByText('Focus pane 1')).toBeInTheDocument()
    expect(screen.getByText('Cycle layout')).toBeInTheDocument()
    expect(
      screen.getByText('Show / hide editor & diff dock')
    ).toBeInTheDocument()

    expect(
      screen.getByText('Show / hide agent activity panel')
    ).toBeInTheDocument()
    expect(screen.getByText('Open settings')).toBeInTheDocument()
    expect(screen.getByText('Open command palette')).toBeInTheDocument()
    expect(screen.getByText('Command palette leader')).toBeInTheDocument()
    expect(screen.getByText('Focus browser address bar')).toBeInTheDocument()
    expect(screen.getByText('Move to next line')).toBeInTheDocument()
    expect(screen.getByText('Next file / search match')).toBeInTheDocument()
    expect(screen.getByText('Previous hunk')).toBeInTheDocument()
    expect(screen.getByText('Stage / unstage hunk')).toBeInTheDocument()
    expect(screen.getByText('Request agent review')).toBeInTheDocument()
    expect(
      within(
        screen.getByTestId('settings-target-keymap-command-diff-review-request')
      ).getByText('Shift+2')
    ).toBeInTheDocument()

    expect(
      screen.getByText('Close search / cancel visual selection')
    ).toBeInTheDocument()
    expect(screen.queryByText('Open file')).not.toBeInTheDocument()
    expect(screen.queryByText('Back to file list')).not.toBeInTheDocument()
  })

  test('switching the preset to vim reveals the Vim ex-command rows', async () => {
    const user = userEvent.setup()
    render(<KeymapPane />)

    expect(screen.queryByText('Save file')).not.toBeInTheDocument()

    const select = screen.getByLabelText('Keymap preset')
    await user.selectOptions(select, 'vim')

    expect(select).toHaveValue('vim')
    expect(screen.getByText('Save file')).toBeInTheDocument()
  })

  test('renders Mac-style modifier glyphs on macOS', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      platform: 'MacIntel',
    })

    render(<KeymapPane />)

    expect(screen.getAllByText('⌘;')).toHaveLength(2)
    expect(screen.getByText('⌘B')).toBeInTheDocument()
    expect(screen.getByText('⌘C')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  test('renders Ctrl-style modifiers on Linux/Windows', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      platform: 'Linux x86_64',
    })

    render(<KeymapPane />)

    expect(screen.getAllByText('Ctrl+;')).toHaveLength(2)
    expect(screen.getByText('Ctrl+Shift+B')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+Shift+C')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  test('uses the resolved palette binding in the footer', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      platform: 'Linux x86_64',
    })

    renderWithSettings({ palette: 'Mod+Shift+KeyP' })

    expect(
      screen.getByText(
        'More actions are available in the Ctrl+Shift+P command palette.'
      )
    ).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  test('reflects a persisted override on a rebindable row', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      platform: 'MacIntel',
    })

    // dock-toggle default is ⌘0; the override re-renders the row as ⌘O.
    renderWithSettings({
      'dock-toggle': 'Mod+KeyO',
      'diff-line-next': 'Shift+ArrowDown',
    })

    expect(screen.getByText('⌘O')).toBeInTheDocument()
    expect(screen.getByText('⇧↓')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  test('saves a captured chord for a rebindable row', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      platform: 'Linux x86_64',
    })
    const { update } = renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    )

    const capture = screen.getByRole('button', {
      name: 'Capture Show / hide editor & diff dock binding',
    })
    expect(capture).toHaveAttribute(KEYMAP_CAPTURE_TARGET_ATTRIBUTE, 'true')
    fireEvent.keyDown(capture, { key: 'o', code: 'KeyO', ctrlKey: true })
    expect(screen.getByText('Ctrl+O')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save Show / hide editor & diff dock binding',
      })
    )

    expect(update).toHaveBeenCalledWith({
      customKeybindings: { 'dock-toggle': 'Mod+KeyO' },
    })

    const row = screen.getByTestId('settings-target-keymap-command-dock-toggle')
    const status = within(row).getByRole('status')
    const shortcut = within(row).getByText('Ctrl+0')

    expect(status).toHaveTextContent('Saved.')
    expect(within(row).getAllByText(/^(Saved\.|Ctrl\+0)$/)).toEqual([
      status,
      shortcut,
    ])

    vi.unstubAllGlobals()
  })

  test('saves and displays a Shift-only Diff binding', () => {
    const { update } = renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Move to next line binding',
      })
    )

    const capture = screen.getByRole('button', {
      name: 'Capture Move to next line binding',
    })
    fireEvent.keyDown(capture, {
      key: 'ArrowDown',
      code: 'ArrowDown',
      shiftKey: true,
    })
    expect(screen.getByText('Shift+↓')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save Move to next line binding',
      })
    )

    expect(update).toHaveBeenCalledWith({
      customKeybindings: { 'diff-line-next': 'Shift+ArrowDown' },
    })
  })

  test('explains that a Diff binding can omit the primary modifier', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      platform: 'MacIntel',
    })
    const { update } = renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Move to next line binding',
      })
    )

    fireEvent.keyDown(
      screen.getByRole('button', {
        name: 'Capture Move to next line binding',
      }),
      {
        key: 'ArrowDown',
        code: 'ArrowDown',
        metaKey: true,
        ctrlKey: true,
      }
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save Move to next line binding',
      })
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Use at most one primary modifier.'
    )
    expect(update).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  test('bare modifier key presses do not replace the captured draft', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      platform: 'Linux x86_64',
    })
    renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    )

    const capture = screen.getByRole('button', {
      name: 'Capture Show / hide editor & diff dock binding',
    })
    fireEvent.keyDown(capture, { key: 'o', code: 'KeyO', ctrlKey: true })
    fireEvent.keyDown(capture, {
      key: 'Shift',
      code: 'ShiftLeft',
      shiftKey: true,
    })

    expect(screen.getByText('Ctrl+O')).toBeInTheDocument()
    expect(screen.queryByText('ShiftLeft')).not.toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  test('bare Escape cancels a row binding edit', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      platform: 'Linux x86_64',
    })
    renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    )

    const capture = screen.getByRole('button', {
      name: 'Capture Show / hide editor & diff dock binding',
    })
    fireEvent.keyDown(capture, { key: 'Escape', code: 'Escape' })

    expect(
      screen.queryByRole('button', {
        name: 'Capture Show / hide editor & diff dock binding',
      })
    ).not.toBeInTheDocument()

    expect(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    ).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  test('bare Escape returns focus to the row edit button', () => {
    renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    )

    const capture = screen.getByRole('button', {
      name: 'Capture Show / hide editor & diff dock binding',
    })
    fireEvent.keyDown(capture, { key: 'Escape', code: 'Escape' })

    expect(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    ).toHaveFocus()
  })

  test('Cancel button returns focus to the row edit button', () => {
    renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Cancel Show / hide editor & diff dock binding edit',
      })
    )

    expect(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    ).toHaveFocus()
  })

  test('Save button returns focus to the row edit button', () => {
    renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    )

    const capture = screen.getByRole('button', {
      name: 'Capture Show / hide editor & diff dock binding',
    })
    fireEvent.keyDown(capture, { key: 'o', code: 'KeyO', ctrlKey: true })

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save Show / hide editor & diff dock binding',
      })
    )

    expect(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    ).toHaveFocus()
  })

  test('Tab cancels recording and moves focus to the next stable keymap control', () => {
    renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Focus pane 1 binding',
      })
    )

    const capture = screen.getByRole('button', {
      name: 'Capture Focus pane 1 binding',
    })
    capture.focus()

    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    const preventDefaultSpy = vi.spyOn(tabEvent, 'preventDefault')

    fireEvent(capture, tabEvent)

    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(
      screen.queryByRole('button', {
        name: 'Capture Focus pane 1 binding',
      })
    ).not.toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Edit Focus pane 2 binding' })
    ).toHaveFocus()
  })

  test('Shift+Tab cancels recording and moves focus to the previous stable keymap control', () => {
    renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Focus pane 2 binding',
      })
    )

    const capture = screen.getByRole('button', {
      name: 'Capture Focus pane 2 binding',
    })
    capture.focus()

    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      bubbles: true,
      cancelable: true,
      shiftKey: true,
    })
    const preventDefaultSpy = vi.spyOn(tabEvent, 'preventDefault')

    fireEvent(capture, tabEvent)

    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(
      screen.queryByRole('button', {
        name: 'Capture Focus pane 2 binding',
      })
    ).not.toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Edit Focus pane 1 binding' })
    ).toHaveFocus()
  })

  test('modified Escape stays in capture mode', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      platform: 'Linux x86_64',
    })
    renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    )

    const capture = screen.getByRole('button', {
      name: 'Capture Show / hide editor & diff dock binding',
    })
    fireEvent.keyDown(capture, {
      key: 'Escape',
      code: 'Escape',
      shiftKey: true,
    })

    expect(
      screen.getByRole('button', {
        name: 'Capture Show / hide editor & diff dock binding',
      })
    ).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  test('focus leaving the binding edit controls cancels recording', () => {
    renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    )

    const capture = screen.getByRole('button', {
      name: 'Capture Show / hide editor & diff dock binding',
    })
    const outside = document.createElement('button')
    document.body.append(outside)

    try {
      fireEvent.focusOut(capture, { relatedTarget: outside })
    } finally {
      outside.remove()
    }

    expect(
      screen.queryByRole('button', {
        name: 'Capture Show / hide editor & diff dock binding',
      })
    ).not.toBeInTheDocument()
  })

  test('focus can move from recording to save without cancelling', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      platform: 'Linux x86_64',
    })
    const { update } = renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    )

    const capture = screen.getByRole('button', {
      name: 'Capture Show / hide editor & diff dock binding',
    })
    fireEvent.keyDown(capture, { key: 'o', code: 'KeyO', ctrlKey: true })

    const save = screen.getByRole('button', {
      name: 'Save Show / hide editor & diff dock binding',
    })
    fireEvent.focusOut(capture, { relatedTarget: save })
    fireEvent.click(save)

    expect(update).toHaveBeenCalledWith({
      customKeybindings: { 'dock-toggle': 'Mod+KeyO' },
    })

    vi.unstubAllGlobals()
  })

  test('resetting a row removes only that override', () => {
    vi.useFakeTimers()

    const { update } = renderWithSettings({
      'dock-toggle': 'Mod+KeyO',
      'focus-pane-1': 'Mod+KeyJ',
    })

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Reset Show / hide editor & diff dock binding',
      })
    )

    expect(update).toHaveBeenCalledWith({
      customKeybindings: { 'focus-pane-1': 'Mod+KeyJ' },
    })
    expect(screen.getByRole('status')).toHaveTextContent('Reset.')

    act(() => {
      vi.advanceTimersByTime(1800)
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('does not render edit controls for display-only rows', () => {
    renderWithSettings()

    expect(
      screen.getByRole('button', {
        name: 'Edit Open command palette binding',
      })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', {
        name: 'Edit Command palette leader binding',
      })
    ).toBeInTheDocument()

    expect(
      screen.queryByRole('button', {
        name: 'Edit Open settings binding',
      })
    ).not.toBeInTheDocument()
  })

  test('shows a conflict warning without persisting', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      platform: 'Linux x86_64',
    })
    const { update } = renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    )

    fireEvent.keyDown(
      screen.getByRole('button', {
        name: 'Capture Show / hide editor & diff dock binding',
      }),
      { key: '1', code: 'Digit1', ctrlKey: true }
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save Show / hide editor & diff dock binding',
      })
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Shortcut conflicts with another command.'
    )
    expect(update).not.toHaveBeenCalled()

    fireEvent.keyDown(
      screen.getByRole('button', {
        name: 'Capture Show / hide editor & diff dock binding',
      }),
      { key: 'o', code: 'KeyO', ctrlKey: true }
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  test('cancel clears validation feedback from a failed edit', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      platform: 'Linux x86_64',
    })
    renderWithSettings()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Show / hide editor & diff dock binding',
      })
    )

    fireEvent.keyDown(
      screen.getByRole('button', {
        name: 'Capture Show / hide editor & diff dock binding',
      }),
      { key: '1', code: 'Digit1', ctrlKey: true }
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save Show / hide editor & diff dock binding',
      })
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Shortcut conflicts with another command.'
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Cancel Show / hide editor & diff dock binding edit',
      })
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    vi.unstubAllGlobals()
  })
})
