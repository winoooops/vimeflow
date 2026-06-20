import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  BROWSER_PANE_ACTIVATE_TAB,
  BROWSER_PANE_CDP_INFO,
  BROWSER_PANE_CLOSE_TAB,
  BROWSER_PANE_CREATE,
  BROWSER_PANE_DESTROY,
  BROWSER_PANE_FOCUS,
  BROWSER_PANE_FOCUSED,
  BROWSER_PANE_FOCUS_ADDRESS,
  BROWSER_PANE_NAVIGATE,
  BROWSER_PANE_NAV_ACTION,
  BROWSER_PANE_NAV_STATE_CHANGED,
  BROWSER_PANE_NEW_TAB,
  BROWSER_PANE_OPEN_EXTERNAL,
  BROWSER_PANE_SET_BOUNDS,
  BROWSER_PANE_TABS_CHANGED,
  BROWSER_PANE_URL_CHANGED,
} from './browser-pane-channels'
import {
  COMMAND_PALETTE_BINDING,
  COMMAND_PALETTE_TOGGLE,
  SETTINGS_CHANGED,
  SETTINGS_OPEN_WINDOW,
} from './ipc-channels'
import './preload'

const electronMock = vi.hoisted(() => {
  let exposedApi: Record<string, unknown> | undefined

  return {
    get exposed(): Record<string, unknown> | undefined {
      return exposedApi
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
      send: vi.fn(),
      setMaxListeners: vi.fn(),
    },
  }
})

vi.mock('electron', () => ({
  contextBridge: electronMock.contextBridge,
  ipcRenderer: electronMock.ipcRenderer,
}))

const preloadSetMaxListenersCalls = [
  ...electronMock.ipcRenderer.setMaxListeners.mock.calls,
]

const browserPane = (): Record<string, unknown> => {
  const api = electronMock.exposed

  if (!api || typeof api !== 'object') {
    throw new Error('preload API not exposed')
  }

  const pane = api.browserPane

  if (!pane || typeof pane !== 'object') {
    throw new Error('browserPane not exposed')
  }

  return pane as Record<string, unknown>
}

const preloadApi = (): Record<string, unknown> => {
  const api = electronMock.exposed

  if (!api || typeof api !== 'object') {
    throw new Error('preload API not exposed')
  }

  return api
}

describe('preload browserPane wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('raises the shared ipcRenderer listener cap during preload startup', () => {
    expect(preloadSetMaxListenersCalls).toEqual([[64]])
  })

  test('setCommandPaletteBinding sends the resolved binding to main', () => {
    const setCommandPaletteBinding = preloadApi().setCommandPaletteBinding as (
      binding: string
    ) => void

    setCommandPaletteBinding('Mod+KeyK')

    expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith(
      COMMAND_PALETTE_BINDING,
      'Mod+KeyK'
    )
  })

  test('setCommandPaletteBindings sends split palette bindings to main', () => {
    const setCommandPaletteBindings = preloadApi()
      .setCommandPaletteBindings as (bindings: {
      palette: string
      leader: string
    }) => void

    setCommandPaletteBindings({
      palette: 'Mod+KeyP',
      leader: 'Mod+KeyK',
    })

    expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith(
      COMMAND_PALETTE_BINDING,
      {
        palette: 'Mod+KeyP',
        leader: 'Mod+KeyK',
      }
    )
  })

  test('settings.openWindow invokes the native settings window channel', async () => {
    const settings = preloadApi().settings as {
      openWindow: () => Promise<void>
    }

    await settings.openWindow()

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      SETTINGS_OPEN_WINDOW
    )
  })

  test('settings.onDidChange forwards settings broadcasts', () => {
    const settings = preloadApi().settings as {
      onDidChange: (callback: (settings: unknown) => void) => () => void
    }
    const callback = vi.fn()

    const unlisten = settings.onDidChange(callback)

    const handler = electronMock.ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === SETTINGS_CHANGED
    )?.[1] as ((event: unknown, settings: unknown) => void) | undefined

    if (handler === undefined) {
      throw new Error('settings listener was not registered')
    }

    const next = { version: 1, onLastWindowClosed: 'quit' }
    handler({}, next)
    unlisten()

    expect(callback).toHaveBeenCalledWith(next)
    expect(electronMock.ipcRenderer.off).toHaveBeenCalledWith(
      SETTINGS_CHANGED,
      handler
    )
  })

  test('onCommandPaletteToggle forwards the shortcut source', () => {
    const onCommandPaletteToggle = preloadApi().onCommandPaletteToggle as (
      callback: (source?: 'palette' | 'leader') => void
    ) => () => void
    const callback = vi.fn()

    const unlisten = onCommandPaletteToggle(callback)

    const handler = electronMock.ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === COMMAND_PALETTE_TOGGLE
    )?.[1] as ((event: unknown, source: unknown) => void) | undefined

    if (handler === undefined) {
      throw new Error('command palette listener was not registered')
    }

    handler({}, 'palette')
    handler({}, 'invalid')
    unlisten()

    expect(callback).toHaveBeenNthCalledWith(1, 'palette')
    expect(callback).toHaveBeenNthCalledWith(2, undefined)
    expect(electronMock.ipcRenderer.off).toHaveBeenCalledWith(
      COMMAND_PALETTE_TOGGLE,
      handler
    )
  })

  test.each([
    ['createPane', BROWSER_PANE_CREATE, { sessionId: 's1', paneId: 'p1' }],
    [
      'setBounds',
      BROWSER_PANE_SET_BOUNDS,
      {
        sessionId: 's1',
        paneId: 'p1',
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        visible: true,
      },
    ],
    [
      'navigate',
      BROWSER_PANE_NAVIGATE,
      { sessionId: 's1', paneId: 'p1', url: 'https://example.com/' },
    ],
    ['newTab', BROWSER_PANE_NEW_TAB, { sessionId: 's1', paneId: 'p1' }],
    [
      'activateTab',
      BROWSER_PANE_ACTIVATE_TAB,
      { sessionId: 's1', paneId: 'p1', tabId: 'tab-1' },
    ],
    [
      'closeTab',
      BROWSER_PANE_CLOSE_TAB,
      { sessionId: 's1', paneId: 'p1', tabId: 'tab-1' },
    ],
    ['destroyPane', BROWSER_PANE_DESTROY, { sessionId: 's1', paneId: 'p1' }],
    ['focusPane', BROWSER_PANE_FOCUS, { sessionId: 's1', paneId: 'p1' }],
    ['getCdpInfo', BROWSER_PANE_CDP_INFO, { sessionId: 's1', paneId: 'p1' }],
    [
      'openExternal',
      BROWSER_PANE_OPEN_EXTERNAL,
      { sessionId: 's1', paneId: 'p1' },
    ],
    [
      'navAction',
      BROWSER_PANE_NAV_ACTION,
      { sessionId: 's1', paneId: 'p1', action: 'back' },
    ],
  ])(
    '%s invokes ipcRenderer.invoke with the correct channel',
    async (
      method: string,
      channel: string,
      request: Record<string, unknown>
    ) => {
      const fn = browserPane()[method] as (req: unknown) => Promise<unknown>

      await fn(request)

      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
        channel,
        request
      )
    }
  )

  test.each([
    ['onFocus', BROWSER_PANE_FOCUSED],
    ['onFocusAddress', BROWSER_PANE_FOCUS_ADDRESS],
    ['onUrlChange', BROWSER_PANE_URL_CHANGED],
    ['onTabsChange', BROWSER_PANE_TABS_CHANGED],
    ['onNavStateChange', BROWSER_PANE_NAV_STATE_CHANGED],
  ])(
    '%s registers on the correct channel',
    (method: string, channel: string) => {
      const fn = browserPane()[method] as (
        cb: (payload: unknown) => void
      ) => () => void

      fn(vi.fn())

      expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
        channel,
        expect.any(Function)
      )
    }
  )
})
