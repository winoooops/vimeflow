// cspell:ignore Ghostty ghostty GHOSTTY
import { afterEach, describe, expect, test, vi } from 'vitest'
import { GHOSTTY_NATIVE_UPDATE } from './ghostty-native-channels'

const electronMock = vi.hoisted(() => {
  let exposedApi: Record<string, unknown> | undefined

  return {
    get exposed(): Record<string, unknown> | undefined {
      return exposedApi
    },
    reset: (): void => {
      exposedApi = undefined
    },
    contextBridge: {
      exposeInMainWorld: vi.fn((_apiKey: string, api: unknown): void => {
        exposedApi = api as Record<string, unknown>
      }),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      setMaxListeners: vi.fn(),
    },
  }
})

vi.mock('electron', () => ({
  contextBridge: electronMock.contextBridge,
  ipcRenderer: electronMock.ipcRenderer,
}))

const loadPreloadApi = async (
  env: Record<string, string>
): Promise<Record<string, unknown>> => {
  vi.resetModules()
  vi.unstubAllEnvs()
  electronMock.reset()
  vi.clearAllMocks()

  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value)
  }

  await import('./preload')

  const api = electronMock.exposed

  if (!api) {
    throw new Error('preload API not exposed')
  }

  return api
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('preload Ghostty env gating', () => {
  test('exposes secondary native methods in parent mode', async () => {
    const api = await loadPreloadApi({
      VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1',
    })

    const ghosttyNative = api.ghosttyNative as
      | Record<string, (request: unknown) => Promise<unknown>>
      | undefined

    expect(ghosttyNative?.attachSecondary).toEqual(expect.any(Function))
    expect(ghosttyNative?.setSecondaryVisible).toEqual(expect.any(Function))
  })

  test('omits secondary native methods in legacy helper mode', async () => {
    const api = await loadPreloadApi({
      VITE_GHOSTTY_NATIVE_MACOS: '1',
    })

    const ghosttyNative = api.ghosttyNative as
      | Record<string, (request: unknown) => Promise<unknown>>
      | undefined

    await ghosttyNative?.update({ sessionId: 'pty-1', paneId: 'pane-1' })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      GHOSTTY_NATIVE_UPDATE,
      { sessionId: 'pty-1', paneId: 'pane-1' }
    )
    expect(ghosttyNative?.attachSecondary).toBeUndefined()
    expect(ghosttyNative?.secondaryData).toBeUndefined()
    expect(ghosttyNative?.focusSecondary).toBeUndefined()
    expect(ghosttyNative?.removeSecondary).toBeUndefined()
    expect(ghosttyNative?.setSecondaryVisible).toBeUndefined()
  })
})
