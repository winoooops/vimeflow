import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import type { AppSettings } from '../../../bindings/AppSettings'
import { SettingsProvider } from '../SettingsProvider'
import { useSettings } from './useSettings'

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
})

describe('useSettings', () => {
  afterEach(() => {
    delete window.vimeflow
  })

  test('throws when used outside SettingsProvider', () => {
    expect(() => {
      renderHook(() => useSettings())
    }).toThrow(/useSettings must be used within/i)
  })

  test('returns context value inside SettingsProvider', async () => {
    const loaded = createLoadedSettings()
    const load = vi.fn().mockResolvedValue(loaded)
    const save = vi.fn().mockResolvedValue(undefined)

    window.vimeflow = {
      settings: { load, save, openFile: vi.fn() },
    } as unknown as Window['vimeflow']

    const { result } = renderHook(() => useSettings(), {
      wrapper: ({ children }: { children: ReactNode }): ReactElement => (
        <SettingsProvider>{children}</SettingsProvider>
      ),
    })

    await waitFor(() => {
      expect(result.current.settings.closeWithNoTabs).toBe('close')
    })

    act(() => {
      result.current.update({ accentHue: 300 })
    })

    await waitFor(() => {
      expect(result.current.settings.accentHue).toBe(300)
    })

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ accentHue: 300 })
    )
  })
})
