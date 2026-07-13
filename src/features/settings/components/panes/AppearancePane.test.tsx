import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { SettingsProvider } from '../../SettingsProvider'
import { DEFAULT_SETTINGS } from '../../store/settingsDefaults'
import { themeService } from '@/theme'
import { AppearancePane } from './AppearancePane'

interface TestWrapperProps {
  children: ReactNode
}

const TestWrapper = ({ children }: TestWrapperProps): ReactElement => (
  <SettingsProvider>{children}</SettingsProvider>
)

const renderPane = (): ReturnType<typeof render> =>
  render(
    <TestWrapper>
      <AppearancePane />
    </TestWrapper>
  )

describe('AppearancePane', () => {
  beforeEach(() => {
    themeService.apply('obsidian-lens')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete window.vimeflow
  })

  test('renders the pane title', () => {
    renderPane()

    expect(screen.getByText('Appearance')).toBeInTheDocument()
    expect(
      screen.getByText('Theme · Interface · Typography')
    ).toBeInTheDocument()
  })

  test('renders every registered theme card', () => {
    renderPane()

    themeService.list().forEach((theme) => {
      expect(
        screen.getByRole('button', { name: theme.label })
      ).toBeInTheDocument()
    })
  })

  test('selects a scheme card on click', async () => {
    const user = userEvent.setup()
    const applyTheme = vi.spyOn(themeService, 'apply')
    renderPane()

    await user.click(screen.getByRole('button', { name: 'Dracula' }))

    expect(applyTheme).toHaveBeenCalledWith('dracula')
    expect(screen.getByRole('button', { name: 'Dracula' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('marks the default active scheme with aria-pressed', () => {
    renderPane()

    expect(
      screen.getByRole('button', { name: 'Catppuccin', pressed: true })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Dracula', pressed: false })
    ).toBeInTheDocument()
  })

  test('follows a theme committed outside settings', () => {
    renderPane()

    act(() => {
      themeService.apply('gruvbox-light')
    })

    expect(
      screen.getByRole('button', { name: 'Gruvbox Light', pressed: true })
    ).toBeInTheDocument()
  })

  test('removes nonfunctional accent, density, and mono font controls', () => {
    renderPane()

    expect(screen.queryByLabelText('Accent hue')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Density')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Mono font')).not.toBeInTheDocument()
  })

  test('reflects the default reservoir swell setting', () => {
    renderPane()

    expect(screen.getByLabelText('Reservoir swell')).toHaveValue('soft-mound')
  })

  test('persists reservoir swell through the settings store', async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockResolvedValue(undefined)

    window.vimeflow = {
      settings: {
        load: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
        save,
        openFile: vi.fn(),
      },
    } as unknown as Window['vimeflow']

    renderPane()

    await waitFor(() => {
      expect(screen.getByLabelText('Reservoir swell')).toHaveValue('soft-mound')
    })

    await user.selectOptions(
      screen.getByLabelText('Reservoir swell'),
      'wide-lift'
    )

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ reservoirSwell: 'wide-lift' })
      )
    })
  })

  test('persists appearance controls through the settings store', async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockResolvedValue(undefined)

    window.vimeflow = {
      settings: {
        load: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
        save,
        openFile: vi.fn(),
      },
    } as unknown as Window['vimeflow']

    renderPane()

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Catppuccin', pressed: true })
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Dracula' }))
    await user.selectOptions(screen.getByLabelText('Interface font'), 'inter')

    expect(
      document.documentElement.style.getPropertyValue('--font-body')
    ).toContain('Inter')

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          uiFont: 'inter',
        })
      )
    })
  })

  test('normalizes a removed persisted interface font in the picker', async () => {
    window.vimeflow = {
      settings: {
        load: vi.fn().mockResolvedValue({
          ...DEFAULT_SETTINGS,
          uiFont: 'fraunces',
        }),
        save: vi.fn().mockResolvedValue(undefined),
        openFile: vi.fn(),
      },
    } as unknown as Window['vimeflow']

    renderPane()

    await waitFor(() => {
      expect(screen.getByLabelText('Interface font')).toHaveValue('instrument')
    })
  })

  test('opens import, export, and edit JSON workflows', async () => {
    const user = userEvent.setup()
    renderPane()

    await user.click(screen.getByRole('button', { name: 'New color scheme' }))
    expect(
      screen.getByRole('dialog', { name: 'New color scheme' })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Import theme...' }))
    expect(
      screen.getByRole('dialog', { name: 'Import theme' })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Export current' }))
    expect(
      screen.getByRole('dialog', { name: 'Export theme' })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await user.click(screen.getByRole('button', { name: 'Edit current' }))
    expect(
      screen.getByRole('dialog', { name: 'Edit theme' })
    ).toBeInTheDocument()
  })
})
