import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement, type ReactElement } from 'react'
import { DEFAULT_SETTINGS } from '../../store/settingsDefaults'
import { SettingsProvider, SettingsContext } from '../../SettingsProvider'
import type { AppSettings } from '../../../../bindings/AppSettings'
import { KeymapPane } from './KeymapPane'

const render = (ui: ReactElement): ReturnType<typeof rtlRender> =>
  rtlRender(ui, { wrapper: SettingsProvider })

// Direct-context render lets a test seed `customKeybindings` synchronously
// (bypassing the provider's async load).
const renderWithSettings = (
  customKeybindings: Record<string, string> = {}
): ReturnType<typeof rtlRender> => {
  const settings: AppSettings = { ...DEFAULT_SETTINGS, customKeybindings }

  return rtlRender(
    createElement(
      SettingsContext.Provider,
      { value: { settings, saveError: null, update: vi.fn() } },
      createElement(KeymapPane)
    )
  )
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

  test('renders granular catalog rows + the Diff zone', () => {
    render(<KeymapPane />)

    // Granular catalog labels (one per command — replacing the old grouped rows).
    expect(screen.getByText('Focus pane 1')).toBeInTheDocument()
    expect(screen.getByText('Cycle layout')).toBeInTheDocument()
    expect(
      screen.getByText('Show / hide editor & diff dock')
    ).toBeInTheDocument()
    expect(screen.getByText('Open command palette')).toBeInTheDocument()
    // The bare-key Diff zone still renders from KEYMAP_GROUPS.
    expect(screen.getByText('Next / previous file')).toBeInTheDocument()
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

    expect(screen.getByText('⌘;')).toBeInTheDocument()
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

    expect(screen.getByText('Ctrl+;')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+Shift+B')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+Shift+C')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  test('reflects a persisted override on a rebindable row', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      platform: 'MacIntel',
    })

    // dock-toggle default is ⌘0; the override re-renders the row as ⌘K.
    renderWithSettings({ 'dock-toggle': 'Mod+KeyK' })

    expect(screen.getByText('⌘K')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })
})
