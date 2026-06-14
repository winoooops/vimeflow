import { afterEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import type { AgentAlias } from '../../types'
import { SettingsProvider } from '../../SettingsProvider'
import { DEFAULT_ALIASES } from '../../sections'
import { AgentsPane } from './AgentsPane'

interface TestWrapperProps {
  children: ReactNode
}

const TestWrapper = ({ children }: TestWrapperProps): ReactElement => (
  <SettingsProvider>{children}</SettingsProvider>
)

interface BridgeMocks {
  aliasesLoad: ReturnType<typeof vi.fn>
  aliasesSave: ReturnType<typeof vi.fn>
  settingsSave: ReturnType<typeof vi.fn>
}

const installBridge = (loadedAliases: AgentAlias[]): BridgeMocks => {
  const aliasesLoad = vi.fn().mockResolvedValue(loadedAliases)
  const aliasesSave = vi.fn().mockResolvedValue(undefined)
  const settingsSave = vi.fn().mockResolvedValue(undefined)

  window.vimeflow = {
    settings: {
      load: vi.fn().mockResolvedValue({
        version: 1,
        closeWithNoTabs: 'platform',
        onLastWindowClosed: 'platform',
        useSystemPathPrompts: true,
        useSystemPrompts: true,
        redactPrivateValues: false,
        cliOpenBehavior: 'existing',
        aesthetic: 'obsidian',
        accentHue: 285,
        density: 'comfortable',
        uiFont: 'instrument',
        monoFont: 'jetbrains',
        keymapPreset: 'vimeflow',
        agentShimEnabled: true,
      }),
      save: settingsSave,
      openFile: vi.fn(),
    },
    aliases: {
      load: aliasesLoad,
      save: aliasesSave,
    },
  } as unknown as Window['vimeflow']

  return { aliasesLoad, aliasesSave, settingsSave }
}

describe('AgentsPane', () => {
  afterEach(() => {
    delete window.vimeflow
  })

  test('renders the pane title', () => {
    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    expect(screen.getByText('Coding Agents')).toBeInTheDocument()
    expect(
      screen.getByText('Shell aliases · agent registry')
    ).toBeInTheDocument()
  })

  test('hydrates aliases from the bridge on mount', async () => {
    const loaded: AgentAlias[] = [
      {
        id: 'x1',
        alias: 'xx',
        agent: 'shell',
        model: '',
        extra: 'echo hello',
        account: null,
      },
    ]

    installBridge(loaded)

    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByDisplayValue('xx')).toBeInTheDocument()
    })

    expect(screen.getAllByTestId('alias-row').length).toBe(1)
  })

  test('falls back to default aliases when the bridge is absent', () => {
    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    DEFAULT_ALIASES.forEach((a) => {
      expect(screen.getByDisplayValue(a.alias)).toBeInTheDocument()
    })
  })

  test('persists a new alias row when Add alias is clicked', async () => {
    const { aliasesSave } = installBridge(DEFAULT_ALIASES)
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('alias-row').length).toBe(
        DEFAULT_ALIASES.length
      )
    })

    await user.click(screen.getByRole('button', { name: /Add alias/i }))

    await waitFor(() => {
      expect(aliasesSave).toHaveBeenLastCalledWith([
        ...DEFAULT_ALIASES,
        {
          id: expect.any(String),
          alias: '',
          agent: 'claude',
          model: 'sonnet-4',
          extra: '',
          account: null,
        },
      ])
    })

    expect(aliasesSave).toHaveBeenCalledTimes(1)
  })

  test('persists alias removal with the remaining rows', async () => {
    const { aliasesSave } = installBridge(DEFAULT_ALIASES)
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('alias-row').length).toBe(
        DEFAULT_ALIASES.length
      )
    })

    const deleteButtons = screen.getAllByTestId('remove-alias')
    await user.click(deleteButtons[0])

    await waitFor(() => {
      expect(aliasesSave).toHaveBeenLastCalledWith(DEFAULT_ALIASES.slice(1))
    })

    expect(screen.getAllByTestId('alias-row').length).toBe(
      DEFAULT_ALIASES.length - 1
    )
  })

  test('persists alias edits', async () => {
    const { aliasesSave } = installBridge(DEFAULT_ALIASES)
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByDisplayValue('cc')).toBeInTheDocument()
    })

    const aliasInput = screen.getByLabelText('Alias for claude')
    await user.clear(aliasInput)
    await user.type(aliasInput, 'coc')

    await waitFor(() => {
      expect(aliasesSave).toHaveBeenLastCalledWith([
        { ...DEFAULT_ALIASES[0], alias: 'coc' },
        ...DEFAULT_ALIASES.slice(1),
      ])
    })
  })

  test('reads and writes agentShimEnabled through the settings store', async () => {
    const { settingsSave } = installBridge(DEFAULT_ALIASES)
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(
        screen.getByRole('switch', { name: 'Manage agent shell aliases' })
      ).toHaveAttribute('aria-checked', 'true')
    })

    await user.click(
      screen.getByRole('switch', { name: 'Manage agent shell aliases' })
    )

    await waitFor(() => {
      expect(settingsSave).toHaveBeenCalledWith(
        expect.objectContaining({ agentShimEnabled: false })
      )
    })
  })

  test('dims alias rows when the shim toggle is turned off', async () => {
    installBridge(DEFAULT_ALIASES)
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('alias-row').length).toBe(
        DEFAULT_ALIASES.length
      )
    })

    await user.click(
      screen.getByRole('switch', { name: 'Manage agent shell aliases' })
    )

    const rows = screen.getAllByTestId('alias-row')
    rows.forEach((row) => {
      expect(row).toHaveClass('opacity-45')
    })
  })

  test('disables alias row controls when the shim toggle is turned off', async () => {
    installBridge(DEFAULT_ALIASES)
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('alias-row').length).toBe(
        DEFAULT_ALIASES.length
      )
    })

    await user.click(
      screen.getByRole('switch', { name: 'Manage agent shell aliases' })
    )

    const rows = screen.getAllByTestId('alias-row')
    rows.forEach((row) => {
      const fieldset = within(row).getByRole('group')
      expect(fieldset).toBeInTheDocument()
      expect(fieldset).toBeDisabled()
    })
  })

  test('renders the info callout with the aliases.toml path', () => {
    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    expect(screen.getByText(/aliases.toml/)).toBeInTheDocument()
    expect(screen.getByText(/How this works/)).toBeInTheDocument()
  })
})
