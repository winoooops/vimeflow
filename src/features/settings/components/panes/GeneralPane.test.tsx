import { afterEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import type { AppSettings } from '../../../../bindings/AppSettings'
import { SettingsProvider } from '../../SettingsProvider'
import { DEFAULT_SETTINGS } from '../../store/settingsDefaults'
import { GeneralPane } from './GeneralPane'

interface TestWrapperProps {
  children: ReactNode
}

const TestWrapper = ({ children }: TestWrapperProps): ReactElement => (
  <SettingsProvider>{children}</SettingsProvider>
)

const createLoadedSettings = (): AppSettings => ({
  version: 1,
  closeWithNoTabs: 'close',
  onLastWindowClosed: 'quit',
  useSystemPathPrompts: false,
  useSystemPrompts: false,
  redactPrivateValues: true,
  cliOpenBehavior: 'new',
  aesthetic: 'obsidian',
  accentHue: 285,
  density: 'compact',
  uiFont: 'inter',
  monoFont: 'fira',
  keymapPreset: 'vscode',
  agentShimEnabled: false,
  customKeybindings: {},
})

const installBridge = (
  loaded: AppSettings
): { save: ReturnType<typeof vi.fn> } => {
  const save = vi.fn().mockResolvedValue(undefined)

  window.vimeflow = {
    settings: {
      load: vi.fn().mockResolvedValue(loaded),
      save,
      openFile: vi.fn(),
    },
  } as unknown as Window['vimeflow']

  return { save }
}

describe('GeneralPane', () => {
  afterEach(() => {
    delete window.vimeflow
  })

  test('renders the pane title and all setting rows', () => {
    render(
      <TestWrapper>
        <GeneralPane />
      </TestWrapper>
    )

    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByText('General Settings')).toBeInTheDocument()
    expect(screen.getByText('When Closing With No Tabs')).toBeInTheDocument()
    expect(screen.getByText('On Last Window Closed')).toBeInTheDocument()
    expect(screen.getByText('Use System Path Prompts')).toBeInTheDocument()
    expect(screen.getByText('Use System Prompts')).toBeInTheDocument()
    expect(screen.getByText('Redact Private Values')).toBeInTheDocument()
    expect(screen.getByText('CLI Default Open Behavior')).toBeInTheDocument()
  })

  test('reflects default settings when no bridge is present', () => {
    render(
      <TestWrapper>
        <GeneralPane />
      </TestWrapper>
    )

    expect(screen.getByLabelText('When closing with no tabs')).toHaveValue(
      'platform'
    )

    expect(screen.getByLabelText('On last window closed')).toHaveValue(
      'platform'
    )

    expect(
      screen.getByRole('switch', { name: 'Use System Path Prompts' })
    ).toHaveAttribute('aria-checked', 'true')

    expect(
      screen.getByRole('switch', { name: 'Use System Prompts' })
    ).toHaveAttribute('aria-checked', 'true')

    expect(
      screen.getByRole('switch', { name: 'Redact Private Values' })
    ).toHaveAttribute('aria-checked', 'false')

    expect(screen.getByLabelText('CLI default open behavior')).toHaveValue(
      'existing'
    )
  })

  test('reflects loaded settings from the store (read)', async () => {
    installBridge(createLoadedSettings())

    render(
      <TestWrapper>
        <GeneralPane />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByLabelText('When closing with no tabs')).toHaveValue(
        'close'
      )
    })

    expect(screen.getByLabelText('On last window closed')).toHaveValue('quit')
    expect(
      screen.getByRole('switch', { name: 'Use System Path Prompts' })
    ).toHaveAttribute('aria-checked', 'false')

    expect(
      screen.getByRole('switch', { name: 'Use System Prompts' })
    ).toHaveAttribute('aria-checked', 'false')

    expect(
      screen.getByRole('switch', { name: 'Redact Private Values' })
    ).toHaveAttribute('aria-checked', 'true')

    expect(screen.getByLabelText('CLI default open behavior')).toHaveValue(
      'new'
    )
  })

  test('persists every control through the settings store (update)', async () => {
    const { save } = installBridge(DEFAULT_SETTINGS)
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <GeneralPane />
      </TestWrapper>
    )

    // Wait for the provider to hydrate from load() before exercising controls.
    await waitFor(() => {
      expect(screen.getByLabelText('When closing with no tabs')).toHaveValue(
        'platform'
      )
    })

    await user.selectOptions(
      screen.getByLabelText('When closing with no tabs'),
      'nothing'
    )

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ closeWithNoTabs: 'nothing' })
      )
    })

    await user.selectOptions(
      screen.getByLabelText('On last window closed'),
      'quit'
    )

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ onLastWindowClosed: 'quit' })
      )
    })

    await user.click(
      screen.getByRole('switch', { name: 'Use System Path Prompts' })
    )

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ useSystemPathPrompts: false })
      )
    })

    await user.click(screen.getByRole('switch', { name: 'Use System Prompts' }))
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ useSystemPrompts: false })
      )
    })

    await user.click(
      screen.getByRole('switch', { name: 'Redact Private Values' })
    )

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ redactPrivateValues: true })
      )
    })

    await user.selectOptions(
      screen.getByLabelText('CLI default open behavior'),
      'new'
    )

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ cliOpenBehavior: 'new' })
      )
    })
  })
})
