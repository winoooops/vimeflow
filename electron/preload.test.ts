// cspell:ignore Ghostty ghostty GHOSTTY
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { DIALOG_PICK_DIRECTORY } from './ipc-channels'
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
  NATIVE_OVERLAY_ACTION,
  NATIVE_OVERLAY_ACTION_RESULT,
  NATIVE_OVERLAY_CLEAR,
  NATIVE_OVERLAY_CLOSE,
  NATIVE_OVERLAY_CLOSED,
  NATIVE_OVERLAY_KEYDOWN,
  NATIVE_OVERLAY_OPEN,
  NATIVE_OVERLAY_READY,
  NATIVE_OVERLAY_RENDER,
  type NativeOverlayInvokeChannel,
} from './native-overlay-channels'
import {
  GHOSTTY_NATIVE_DATA,
  GHOSTTY_NATIVE_DESTROY,
  GHOSTTY_NATIVE_FOCUS,
  GHOSTTY_NATIVE_SECONDARY_ATTACH,
  GHOSTTY_NATIVE_SECONDARY_DATA,
  GHOSTTY_NATIVE_SECONDARY_FOCUS,
  GHOSTTY_NATIVE_SECONDARY_REMOVE,
  GHOSTTY_NATIVE_SECONDARY_VISIBLE,
  GHOSTTY_NATIVE_UPDATE,
} from './ghostty-native-channels'
import './preload'

const electronMock = vi.hoisted(() => {
  let exposedApi: Record<string, unknown> | undefined
  vi.stubEnv('VITE_GHOSTTY_NATIVE_MACOS_PARENT', '1')

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
      setMaxListeners: vi.fn(),
    },
  }
})

afterAll(() => {
  vi.unstubAllEnvs()
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

const exposedApi = (): Record<string, unknown> => {
  const api = electronMock.exposed

  if (!api || typeof api !== 'object') {
    throw new Error('preload API not exposed')
  }

  return api
}

const nativeOverlayInvokeCases: readonly [
  string,
  NativeOverlayInvokeChannel,
  Record<string, unknown>,
][] = [
  ['open', NATIVE_OVERLAY_OPEN, { surfaceId: 'surface-1' }],
  ['close', NATIVE_OVERLAY_CLOSE, { surfaceId: 'surface-1' }],
  ['actionResult', NATIVE_OVERLAY_ACTION_RESULT, { surfaceId: 'surface-1' }],
]

describe('preload browserPane wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('raises the shared ipcRenderer listener cap during preload startup', () => {
    expect(preloadSetMaxListenersCalls).toEqual([[64]])
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

test('exposes dialog.pickDirectory bound to the channel', async () => {
  const api = electronMock.exposed as {
    dialog: { pickDirectory: () => Promise<unknown> }
  }
  await api.dialog.pickDirectory()
  expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
    DIALOG_PICK_DIRECTORY
  )
})

describe('preload native Ghostty wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test.each([
    ['update', GHOSTTY_NATIVE_UPDATE],
    ['data', GHOSTTY_NATIVE_DATA],
    ['focus', GHOSTTY_NATIVE_FOCUS],
    ['destroy', GHOSTTY_NATIVE_DESTROY],
    ['attachSecondary', GHOSTTY_NATIVE_SECONDARY_ATTACH],
    ['secondaryData', GHOSTTY_NATIVE_SECONDARY_DATA],
    ['focusSecondary', GHOSTTY_NATIVE_SECONDARY_FOCUS],
    ['removeSecondary', GHOSTTY_NATIVE_SECONDARY_REMOVE],
    ['setSecondaryVisible', GHOSTTY_NATIVE_SECONDARY_VISIBLE],
  ])(
    '%s invokes ipcRenderer.invoke with the correct channel',
    async (method: string, channel: string) => {
      const api = exposedApi() as {
        ghosttyNative?: Record<string, (request: unknown) => Promise<unknown>>
      }
      const request = { sessionId: 'pty-1', paneId: 'pane-1' }

      await api.ghosttyNative?.[method](request)

      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
        channel,
        request
      )
    }
  )
})

describe('preload nativeOverlay wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test.each(nativeOverlayInvokeCases)(
    '%s invokes ipcRenderer.invoke with the correct channel',
    async (
      method: string,
      channel: NativeOverlayInvokeChannel,
      request: Record<string, unknown>
    ) => {
      const api = exposedApi() as {
        nativeOverlay: Record<string, (request: unknown) => Promise<unknown>>
      }

      await api.nativeOverlay[method](request)

      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
        channel,
        request
      )
    }
  )

  test.each([
    ['onAction', NATIVE_OVERLAY_ACTION],
    ['onClose', NATIVE_OVERLAY_CLOSED],
  ])(
    '%s registers on the correct channel',
    (method: string, channel: string) => {
      const api = exposedApi() as {
        nativeOverlay: Record<string, (cb: (payload: unknown) => void) => void>
      }

      api.nativeOverlay[method](vi.fn())

      expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
        channel,
        expect.any(Function)
      )
    }
  )

  test.each([
    ['ready', NATIVE_OVERLAY_READY, { surfaceId: 'surface-1' }],
    ['action', NATIVE_OVERLAY_ACTION, { surfaceId: 'surface-1' }],
    ['close', NATIVE_OVERLAY_CLOSE, { surfaceId: 'surface-1' }],
  ])(
    'host %s invokes ipcRenderer.invoke with the correct channel',
    async (
      method: string,
      channel: string,
      request: Record<string, unknown>
    ) => {
      const api = exposedApi() as {
        nativeOverlayHost: Record<
          string,
          (request: unknown) => Promise<unknown>
        >
      }

      await api.nativeOverlayHost[method](request)

      expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
        channel,
        request
      )
    }
  )

  test.each([
    ['onRender', NATIVE_OVERLAY_RENDER],
    ['onClear', NATIVE_OVERLAY_CLEAR],
    ['onActionResult', NATIVE_OVERLAY_ACTION_RESULT],
    ['onKeyDown', NATIVE_OVERLAY_KEYDOWN],
  ])(
    'host %s registers on the correct channel',
    (method: string, channel: string) => {
      const api = exposedApi() as {
        nativeOverlayHost: Record<
          string,
          (cb: (payload?: unknown) => void) => void
        >
      }

      api.nativeOverlayHost[method](vi.fn())

      expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
        channel,
        expect.any(Function)
      )
    }
  )
})
