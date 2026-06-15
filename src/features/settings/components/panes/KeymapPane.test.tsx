import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { KEYMAP_GROUPS } from '../../sections'
import { DEFAULT_SETTINGS } from '../../store/settingsDefaults'
import { SettingsProvider } from '../../SettingsProvider'
import { KeymapPane } from './KeymapPane'

const render = (ui: ReactElement): ReturnType<typeof rtlRender> =>
  rtlRender(ui, { wrapper: SettingsProvider })

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

  test('renders every base keymap binding', () => {
    render(<KeymapPane />)

    KEYMAP_GROUPS.flatMap((g) => g.bindings).forEach((b) => {
      expect(screen.queryAllByText(b.label).length).toBeGreaterThan(0)
    })
  })

  test('switching the preset to vim updates the value and reveals vim bindings', async () => {
    const user = userEvent.setup()
    render(<KeymapPane />)

    expect(screen.queryByText('Save file')).not.toBeInTheDocument()

    const select = screen.getByLabelText('Keymap preset')
    await user.selectOptions(select, 'vim')

    expect(select).toHaveValue('vim')
    expect(screen.getByText('Save file')).toBeInTheDocument()

    KEYMAP_GROUPS.flatMap((g) => g.bindings).forEach((b) => {
      expect(screen.queryAllByText(b.label).length).toBeGreaterThan(0)
    })
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
})
