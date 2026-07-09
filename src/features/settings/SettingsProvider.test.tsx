import { describe, expect, test, vi, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import type { AppSettings } from '../../bindings/AppSettings'
import { SettingsProvider } from './SettingsProvider'
import { useSettings } from './hooks/useSettings'

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
  terminalFontFamily: 'Iosevka',
  reservoirSwell: 'trailing',
  keymapPreset: 'vscode',
  agentShimEnabled: false,
  customKeybindings: {},
})

const TestConsumer = (): ReactElement => {
  const { settings, update } = useSettings()

  return (
    <div>
      <span data-testid="closeWithNoTabs">{settings.closeWithNoTabs}</span>
      <button
        type="button"
        data-testid="update"
        onClick={() => update({ closeWithNoTabs: 'nothing' })}
      >
        Update
      </button>
    </div>
  )
}

describe('SettingsProvider', () => {
  afterEach(() => {
    delete window.vimeflow
  })

  test('hydrates settings from window.vimeflow.settings.load()', async () => {
    const loaded = createLoadedSettings()
    const load = vi.fn().mockResolvedValue(loaded)
    const save = vi.fn().mockResolvedValue(undefined)

    window.vimeflow = {
      settings: { load, save, openFile: vi.fn() },
    } as unknown as Window['vimeflow']

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('closeWithNoTabs').textContent).toBe('close')
    })

    expect(load).toHaveBeenCalledTimes(1)
  })

  test('update merges state and calls save()', async () => {
    const loaded = createLoadedSettings()
    const load = vi.fn().mockResolvedValue(loaded)
    const save = vi.fn().mockResolvedValue(undefined)

    window.vimeflow = {
      settings: { load, save, openFile: vi.fn() },
    } as unknown as Window['vimeflow']

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('closeWithNoTabs').textContent).toBe('close')
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(screen.getByTestId('closeWithNoTabs').textContent).toBe('nothing')
    })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ closeWithNoTabs: 'nothing' })
    )
  })

  test('does not let the initial load clobber an in-flight update', async () => {
    const loaded = createLoadedSettings()
    let resolveLoad: ((settings: AppSettings) => void) | undefined

    const load = vi.fn(
      () =>
        new Promise<AppSettings>((resolve) => {
          resolveLoad = resolve
        })
    )
    const save = vi.fn().mockResolvedValue(undefined)

    window.vimeflow = {
      settings: { load, save, openFile: vi.fn() },
    } as unknown as Window['vimeflow']

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(screen.getByTestId('closeWithNoTabs').textContent).toBe('nothing')
    })

    act(() => {
      resolveLoad?.(loaded)
    })

    await waitFor(() => {
      expect(load).toHaveBeenCalledTimes(1)
    })

    expect(screen.getByTestId('closeWithNoTabs').textContent).toBe('nothing')
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ closeWithNoTabs: 'nothing' })
    )
  })

  test('merges pre-load updates onto loaded settings before saving', async () => {
    const loaded = createLoadedSettings()
    let resolveLoad: ((settings: AppSettings) => void) | undefined

    const load = vi.fn(
      () =>
        new Promise<AppSettings>((resolve) => {
          resolveLoad = resolve
        })
    )
    const save = vi.fn().mockResolvedValue(undefined)

    window.vimeflow = {
      settings: { load, save, openFile: vi.fn() },
    } as unknown as Window['vimeflow']

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(screen.getByTestId('closeWithNoTabs').textContent).toBe('nothing')
    })

    expect(save).not.toHaveBeenCalled()

    act(() => {
      resolveLoad?.(loaded)
    })

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({
        ...loaded,
        closeWithNoTabs: 'nothing',
      })
    })
  })

  test('syncs an in-memory snapshot to the main process only on update', async () => {
    const loaded = createLoadedSettings()
    const load = vi.fn().mockResolvedValue(loaded)
    const save = vi.fn().mockResolvedValue(undefined)
    const syncSnapshot = vi.fn().mockResolvedValue(undefined)

    window.vimeflow = {
      settings: { load, save, openFile: vi.fn(), syncSnapshot },
    } as unknown as Window['vimeflow']

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('closeWithNoTabs').textContent).toBe('close')
    })

    expect(syncSnapshot).not.toHaveBeenCalled()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(screen.getByTestId('closeWithNoTabs').textContent).toBe('nothing')
    })

    await waitFor(() => {
      expect(syncSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ closeWithNoTabs: 'nothing' })
      )
    })
  })

  test('applies settings broadcasts from another renderer', async () => {
    const loaded = createLoadedSettings()
    const next = { ...loaded, keymapPreset: 'vim' as const }
    const load = vi.fn().mockResolvedValue(loaded)
    const save = vi.fn().mockResolvedValue(undefined)
    let changeCallback: ((settings: AppSettings) => void) | undefined

    window.vimeflow = {
      settings: {
        load,
        save,
        openFile: vi.fn(),
        onDidChange: vi.fn((callback: (settings: AppSettings) => void) => {
          changeCallback = callback

          return vi.fn()
        }),
      },
    } as unknown as Window['vimeflow']

    const KeymapConsumer = (): ReactElement => {
      const { settings } = useSettings()

      return <span data-testid="keymapPreset">{settings.keymapPreset}</span>
    }

    render(
      <SettingsProvider>
        <KeymapConsumer />
      </SettingsProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('keymapPreset').textContent).toBe('vscode')
    })

    act(() => {
      changeCallback?.(next)
    })

    await waitFor(() => {
      expect(screen.getByTestId('keymapPreset').textContent).toBe('vim')
    })

    expect(save).not.toHaveBeenCalled()
  })

  test('falls back to DEFAULT_SETTINGS when the bridge is absent', () => {
    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>
    )

    expect(screen.getByTestId('closeWithNoTabs').textContent).toBe('platform')
  })

  test('falls back to DEFAULT_SETTINGS when load() rejects', async () => {
    const load = vi.fn().mockRejectedValue(new Error('load failed'))
    const save = vi.fn().mockResolvedValue(undefined)

    window.vimeflow = {
      settings: { load, save, openFile: vi.fn() },
    } as unknown as Window['vimeflow']

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('closeWithNoTabs').textContent).toBe('platform')
    })
  })

  test('surfaces saveError when save() rejects', async () => {
    const loaded = createLoadedSettings()
    const load = vi.fn().mockResolvedValue(loaded)
    const save = vi.fn().mockRejectedValue(new Error('disk full'))

    window.vimeflow = {
      settings: { load, save, openFile: vi.fn() },
    } as unknown as Window['vimeflow']

    const SaveErrorConsumer = (): ReactElement => {
      const { saveError, update } = useSettings()

      return (
        <div>
          <span data-testid="saveError">{saveError?.message ?? 'none'}</span>
          <button
            type="button"
            data-testid="update"
            onClick={() => update({ closeWithNoTabs: 'nothing' })}
          >
            Update
          </button>
        </div>
      )
    }

    render(
      <SettingsProvider>
        <SaveErrorConsumer />
      </SettingsProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('saveError').textContent).toBe('none')
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(screen.getByTestId('saveError').textContent).toBe('disk full')
    })
  })
})
