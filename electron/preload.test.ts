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
