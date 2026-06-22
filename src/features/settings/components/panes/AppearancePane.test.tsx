import { afterEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { SettingsProvider } from '../../SettingsProvider'
import { DEFAULT_SETTINGS } from '../../store/settingsDefaults'
import { BUILTIN_SCHEMES } from '../../sections'
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
  afterEach(() => {
    delete window.vimeflow
  })

  test('renders the pane title', () => {
    renderPane()

    expect(screen.getByText('Appearance')).toBeInTheDocument()
    expect(
      screen.getByText('Theme · Color Scheme · Typography')
    ).toBeInTheDocument()
  })

  test('renders all builtin scheme cards', () => {
    renderPane()

    BUILTIN_SCHEMES.forEach((s) => {
      expect(screen.getByText(s.label)).toBeInTheDocument()
    })
  })

  test('selects a scheme card on click', async () => {
    const user = userEvent.setup()
    renderPane()

    const dense = screen.getByText('Dense')
    await user.click(dense)

    expect(screen.getByRole('button', { name: /Dense/i })).toHaveClass(
      'bg-primary-container/[0.08]'
    )
  })

  test('marks the default active scheme with aria-pressed', () => {
    renderPane()

    expect(
      screen.getByRole('button', { name: /Obsidian/i, pressed: true })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /Dense/i, pressed: false })
    ).toBeInTheDocument()
  })

  test('renders the accent hue slider', () => {
    renderPane()

    expect(screen.getByLabelText('Accent hue')).toBeInTheDocument()
  })

  test('changes density via the select', async () => {
    const user = userEvent.setup()
    renderPane()

    const density = screen.getByLabelText('Density')
    await user.selectOptions(density, 'compact')

    expect(density).toHaveValue('compact')
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
})
