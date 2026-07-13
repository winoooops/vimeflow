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
      screen.getByText('Command aliases · agent registry')
    ).toBeInTheDocument()
  })

  test('hydrates aliases from the bridge on mount', async () => {
    const loaded: AgentAlias[] = [
      {
        id: 'x1',
        alias: 'xx',
        agent: 'shell',
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
    expect(
      screen.getByRole('option', { name: 'Custom command' })
    ).toBeInTheDocument()

    expect(
      screen.queryByRole('option', { name: 'Gemini CLI' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Model')).not.toBeInTheDocument()
  })

  test('falls back to default aliases when the bridge is absent', async () => {
    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    await waitFor(() => {
      DEFAULT_ALIASES.forEach((a) => {
        expect(screen.getByDisplayValue(a.alias)).toBeInTheDocument()
      })
    })
  })

  test('does not flash default aliases while waiting for the bridge', async () => {
    const { aliasesLoad } = installBridge(DEFAULT_ALIASES)
    aliasesLoad.mockImplementation(
      () =>
        new Promise<AgentAlias[]>((resolve) => {
          setTimeout(() => resolve([]), 100)
        })
    )

    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    DEFAULT_ALIASES.forEach((a) => {
      expect(screen.queryByDisplayValue(a.alias)).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText('Loading aliases…')).toBeInTheDocument()
    })
  })

  test('disables alias controls until the initial bridge load completes', async () => {
    const { aliasesLoad } = installBridge(DEFAULT_ALIASES)
    let resolveLoad: (value: AgentAlias[]) => void = () => undefined

    aliasesLoad.mockImplementation(
      () =>
        new Promise<AgentAlias[]>((resolve) => {
          resolveLoad = resolve
        })
    )

    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    expect(screen.getByRole('button', { name: /Add alias/i })).toBeDisabled()

    resolveLoad(DEFAULT_ALIASES)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Add alias/i })
      ).not.toBeDisabled()
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

  test('persists a custom command through the generic flags field', async () => {
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

    await user.selectOptions(screen.getByLabelText('Agent for cc'), 'shell')
    await user.type(
      screen.getByLabelText('Command or flags for shell'),
      'lazygit'
    )

    await waitFor(() => {
      expect(aliasesSave).toHaveBeenLastCalledWith([
        { ...DEFAULT_ALIASES[0], agent: 'shell', extra: 'lazygit' },
        ...DEFAULT_ALIASES.slice(1),
      ])
    })
  })

  test('serializes alias saves and coalesces pending edits to the latest state', async () => {
    const { aliasesSave } = installBridge(DEFAULT_ALIASES)
    let resolveFirstSave: (() => void) | undefined
    aliasesSave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstSave = resolve
        })
    )
    aliasesSave.mockResolvedValue(undefined)
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

    const aliasInput = screen.getByLabelText('Alias for claude')
    await user.clear(aliasInput)
    await user.type(aliasInput, 'coc')

    expect(aliasesSave).toHaveBeenCalledTimes(1)

    resolveFirstSave?.()

    await waitFor(() => {
      expect(aliasesSave).toHaveBeenCalledTimes(2)
    })

    expect(aliasesSave).toHaveBeenLastCalledWith([
      { ...DEFAULT_ALIASES[0], alias: 'coc' },
      ...DEFAULT_ALIASES.slice(1),
    ])
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

  test('surfaces an inline error when alias save fails', async () => {
    const { aliasesSave } = installBridge(DEFAULT_ALIASES)
    aliasesSave.mockRejectedValue(new Error('disk full'))
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByDisplayValue('cc')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Add alias/i }))

    await waitFor(() => {
      expect(screen.getByTestId('alias-save-error')).toHaveTextContent(
        'disk full'
      )
    })
  })

  test('clears the save error after a successful save', async () => {
    const { aliasesSave } = installBridge(DEFAULT_ALIASES)
    aliasesSave.mockRejectedValueOnce(new Error('disk full'))
    aliasesSave.mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <AgentsPane />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByDisplayValue('cc')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Add alias/i }))

    await waitFor(() => {
      expect(screen.getByTestId('alias-save-error')).toHaveTextContent(
        'disk full'
      )
    })

    await user.click(screen.getByRole('button', { name: /Add alias/i }))

    await waitFor(() => {
      expect(screen.queryByTestId('alias-save-error')).not.toBeInTheDocument()
    })
  })
})
