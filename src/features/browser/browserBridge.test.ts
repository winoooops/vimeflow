import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  activateBrowserPaneTab,
  closeBrowserPaneTab,
  createBrowserPane,
  clearBrowserPaneBoundsCaptures,
  destroyBrowserPane,
  focusBrowserPane,
  getBrowserCdpInfo,
  getBrowserPaneBoundsCaptures,
  navActionBrowserPane,
  navigateBrowserPane,
  newBrowserPaneTab,
  onBrowserPaneFocus,
  onBrowserPaneFocusAddress,
  onBrowserPaneNavStateChange,
  onBrowserPaneTabsChange,
  onBrowserPaneUrlChange,
  openExternalBrowserPane,
  setBrowserPaneBounds,
  startBrowserPaneBoundsCapture,
  stopBrowserPaneBoundsCapture,
} from './browserBridge'
import type { BrowserPaneBoundsRequest, BrowserPaneBridge } from './types'

type BrowserBridgeWindow = Window & {
  vimeflow?: {
    browserPane?: BrowserPaneBridge
  }
}

const browserWindow = (): BrowserBridgeWindow =>
  window as unknown as BrowserBridgeWindow

const request = {
  sessionId: 'pty-1',
  paneId: 'p1',
  workspaceId: 'proj-1',
  initialUrl: 'https://example.com/',
} as const

describe('browserBridge', () => {
  afterEach(() => {
    stopBrowserPaneBoundsCapture()
    clearBrowserPaneBoundsCaptures()
    delete browserWindow().vimeflow
  })

  test('createBrowserPane falls back to deterministic metadata without preload bridge', async () => {
    delete browserWindow().vimeflow

    await expect(createBrowserPane(request)).resolves.toEqual({
      url: request.initialUrl,
      title: null,
      partition: 'persist:vimeflow-browser:proj-1:pty-1',
      tabs: [
        {
          id: 'tab-0',
          url: request.initialUrl,
          title: null,
          active: true,
          favicon: null,
        },
      ],
      navState: { canGoBack: false, canGoForward: false, isLoading: false },
    })
  })

  test('no-op bridge methods resolve when preload bridge is absent', async () => {
    delete browserWindow().vimeflow

    await expect(
      setBrowserPaneBounds({
        sessionId: 'pty-1',
        paneId: 'p1',
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        visible: true,
      })
    ).resolves.toBeUndefined()

    await expect(
      navigateBrowserPane({
        sessionId: 'pty-1',
        paneId: 'p1',
        url: 'https://example.com/',
      })
    ).resolves.toBeUndefined()

    await expect(
      navActionBrowserPane({ sessionId: 'pty-1', paneId: 'p1', action: 'back' })
    ).resolves.toBeUndefined()
  })

  test('delegates bridge calls to window.vimeflow.browserPane', async () => {
    const unlistenFocus = vi.fn()
    const unlistenFocusAddress = vi.fn()
    const unlistenUrl = vi.fn()
    const unlistenTabs = vi.fn()
    const unlistenNavState = vi.fn()

    const bridge: BrowserPaneBridge = {
      createPane: vi.fn().mockResolvedValue({
        url: 'https://created.example/',
        title: 'Created',
        partition: 'persist:vimeflow-browser:proj-1:pty-1',
        tabs: [
          {
            id: 'tab-0',
            url: 'https://created.example/',
            title: 'Created',
            active: true,
          },
        ],
        navState: { canGoBack: false, canGoForward: false, isLoading: false },
      }),
      setBounds: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue(undefined),
      newTab: vi.fn().mockResolvedValue(undefined),
      destroyPane: vi.fn().mockResolvedValue(undefined),
      focusPane: vi.fn().mockResolvedValue(undefined),
      activateTab: vi.fn().mockResolvedValue(undefined),
      closeTab: vi.fn().mockResolvedValue(undefined),
      openExternal: vi.fn().mockResolvedValue(undefined),
      navAction: vi.fn().mockResolvedValue(undefined),
      getCdpInfo: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:9223',
        token: 'token',
        origin: 'vimeflow://agent-plugin/local',
        targetId: 'pty-1:p1',
      }),
      onFocus: vi.fn(() => unlistenFocus),
      onFocusAddress: vi.fn(() => unlistenFocusAddress),
      onUrlChange: vi.fn(() => unlistenUrl),
      onTabsChange: vi.fn(() => unlistenTabs),
      onNavStateChange: vi.fn(() => unlistenNavState),
    }

    browserWindow().vimeflow = {
      invoke: vi.fn(),
      listen: vi.fn(),
      browserPane: bridge,
    }

    await expect(createBrowserPane(request)).resolves.toMatchObject({
      url: 'https://created.example/',
    })

    await setBrowserPaneBounds({
      sessionId: 'pty-1',
      paneId: 'p1',
      bounds: { x: 1, y: 2, width: 300, height: 200 },
      visible: true,
    })

    await navigateBrowserPane({
      sessionId: 'pty-1',
      paneId: 'p1',
      url: 'https://next.example/',
    })

    await newBrowserPaneTab({
      sessionId: 'pty-1',
      paneId: 'p1',
      url: 'https://new.example/',
    })

    await destroyBrowserPane({ sessionId: 'pty-1', paneId: 'p1' })
    await focusBrowserPane({ sessionId: 'pty-1', paneId: 'p1' })
    await activateBrowserPaneTab({
      sessionId: 'pty-1',
      paneId: 'p1',
      tabId: 'tab-1',
    })

    await closeBrowserPaneTab({
      sessionId: 'pty-1',
      paneId: 'p1',
      tabId: 'tab-1',
    })

    await openExternalBrowserPane({ sessionId: 'pty-1', paneId: 'p1' })

    await navActionBrowserPane({
      sessionId: 'pty-1',
      paneId: 'p1',
      action: 'reload',
    })

    await expect(
      getBrowserCdpInfo({ sessionId: 'pty-1', paneId: 'p1' })
    ).resolves.toMatchObject({
      token: 'token',
    })

    const focusCleanup = onBrowserPaneFocus(() => undefined)
    const focusAddressCleanup = onBrowserPaneFocusAddress(() => undefined)
    const urlCleanup = onBrowserPaneUrlChange(() => undefined)
    const tabsCleanup = onBrowserPaneTabsChange(() => undefined)
    const navStateCleanup = onBrowserPaneNavStateChange(() => undefined)

    expect(bridge.createPane).toHaveBeenCalledWith(request)
    expect(bridge.setBounds).toHaveBeenCalledOnce()
    expect(bridge.navigate).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'p1',
      url: 'https://next.example/',
    })

    expect(bridge.newTab).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'p1',
      url: 'https://new.example/',
    })

    expect(bridge.destroyPane).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'p1',
    })

    expect(bridge.focusPane).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'p1',
    })

    expect(bridge.activateTab).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'p1',
      tabId: 'tab-1',
    })

    expect(bridge.closeTab).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'p1',
      tabId: 'tab-1',
    })

    expect(bridge.getCdpInfo).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'p1',
    })

    expect(bridge.openExternal).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'p1',
    })

    expect(bridge.navAction).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'p1',
      action: 'reload',
    })
    expect(focusCleanup).toBe(unlistenFocus)
    expect(focusAddressCleanup).toBe(unlistenFocusAddress)
    expect(urlCleanup).toBe(unlistenUrl)
    expect(tabsCleanup).toBe(unlistenTabs)
    expect(navStateCleanup).toBe(unlistenNavState)
  })

  test('captures browser pane bounds requests before forwarding to preload', async () => {
    const bridge: BrowserPaneBridge = {
      createPane: vi.fn(),
      setBounds: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn(),
      newTab: vi.fn(),
      destroyPane: vi.fn(),
      focusPane: vi.fn(),
      activateTab: vi.fn(),
      closeTab: vi.fn(),
      openExternal: vi.fn(),
      navAction: vi.fn(),
      getCdpInfo: vi.fn(),
      onFocus: vi.fn(() => (): void => undefined),
      onFocusAddress: vi.fn(() => (): void => undefined),
      onUrlChange: vi.fn(() => (): void => undefined),
      onTabsChange: vi.fn(() => (): void => undefined),
      onNavStateChange: vi.fn(() => (): void => undefined),
    }
    browserWindow().vimeflow = {
      invoke: vi.fn(),
      listen: vi.fn(),
      browserPane: bridge,
    }

    expect(startBrowserPaneBoundsCapture()).toBe(true)

    const boundsRequest: BrowserPaneBoundsRequest = {
      sessionId: 'sess-1',
      paneId: 'browser-1',
      bounds: { x: 10, y: 20, width: 640, height: 480 },
      visible: false,
      shortcutContext: {
        paneIds: ['p0', 'browser-1'],
        activePaneId: 'browser-1',
      },
    }

    await setBrowserPaneBounds(boundsRequest)

    expect(bridge.setBounds).toHaveBeenCalledWith(boundsRequest)
    expect(getBrowserPaneBoundsCaptures()).toEqual([
      {
        sequence: 0,
        ...boundsRequest,
      },
    ])
  })

  test('does not capture bounds requests after preload bridge disappears', async () => {
    const bridge: BrowserPaneBridge = {
      createPane: vi.fn(),
      setBounds: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn(),
      newTab: vi.fn(),
      destroyPane: vi.fn(),
      focusPane: vi.fn(),
      activateTab: vi.fn(),
      closeTab: vi.fn(),
      openExternal: vi.fn(),
      navAction: vi.fn(),
      getCdpInfo: vi.fn(),
      onFocus: vi.fn(() => (): void => undefined),
      onFocusAddress: vi.fn(() => (): void => undefined),
      onUrlChange: vi.fn(() => (): void => undefined),
      onTabsChange: vi.fn(() => (): void => undefined),
      onNavStateChange: vi.fn(() => (): void => undefined),
    }
    browserWindow().vimeflow = {
      invoke: vi.fn(),
      listen: vi.fn(),
      browserPane: bridge,
    }

    expect(startBrowserPaneBoundsCapture()).toBe(true)

    delete browserWindow().vimeflow?.browserPane

    await setBrowserPaneBounds({
      sessionId: 'sess-1',
      paneId: 'browser-1',
      bounds: { x: 10, y: 20, width: 640, height: 480 },
      visible: false,
    })

    expect(bridge.setBounds).not.toHaveBeenCalled()
    expect(getBrowserPaneBoundsCaptures()).toEqual([])
  })

  test('returns cloned browser pane bounds captures', async () => {
    const bridge: BrowserPaneBridge = {
      createPane: vi.fn(),
      setBounds: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn(),
      newTab: vi.fn(),
      destroyPane: vi.fn(),
      focusPane: vi.fn(),
      activateTab: vi.fn(),
      closeTab: vi.fn(),
      openExternal: vi.fn(),
      navAction: vi.fn(),
      getCdpInfo: vi.fn(),
      onFocus: vi.fn(() => (): void => undefined),
      onFocusAddress: vi.fn(() => (): void => undefined),
      onUrlChange: vi.fn(() => (): void => undefined),
      onTabsChange: vi.fn(() => (): void => undefined),
      onNavStateChange: vi.fn(() => (): void => undefined),
    }
    browserWindow().vimeflow = {
      invoke: vi.fn(),
      listen: vi.fn(),
      browserPane: bridge,
    }

    expect(startBrowserPaneBoundsCapture()).toBe(true)

    await setBrowserPaneBounds({
      sessionId: 'sess-1',
      paneId: 'browser-1',
      bounds: { x: 10, y: 20, width: 640, height: 480 },
      visible: true,
      shortcutContext: {
        paneIds: ['browser-1'],
        activePaneId: 'browser-1',
      },
    })

    const captures = getBrowserPaneBoundsCaptures()
    const firstCapture = captures[0]
    if (!firstCapture?.shortcutContext) {
      throw new Error('expected a bounds capture with shortcut context')
    }
    firstCapture.bounds.width = 1
    firstCapture.shortcutContext.paneIds.push('mutated')

    expect(getBrowserPaneBoundsCaptures()).toEqual([
      expect.objectContaining({
        bounds: { x: 10, y: 20, width: 640, height: 480 },
        shortcutContext: {
          paneIds: ['browser-1'],
          activePaneId: 'browser-1',
        },
      }),
    ])
  })

  test('keeps bounds capture sequence monotonic after clearing captures', async () => {
    const bridge: BrowserPaneBridge = {
      createPane: vi.fn(),
      setBounds: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn(),
      newTab: vi.fn(),
      destroyPane: vi.fn(),
      focusPane: vi.fn(),
      activateTab: vi.fn(),
      closeTab: vi.fn(),
      openExternal: vi.fn(),
      navAction: vi.fn(),
      getCdpInfo: vi.fn(),
      onFocus: vi.fn(() => (): void => undefined),
      onFocusAddress: vi.fn(() => (): void => undefined),
      onUrlChange: vi.fn(() => (): void => undefined),
      onTabsChange: vi.fn(() => (): void => undefined),
      onNavStateChange: vi.fn(() => (): void => undefined),
    }
    browserWindow().vimeflow = {
      invoke: vi.fn(),
      listen: vi.fn(),
      browserPane: bridge,
    }

    expect(startBrowserPaneBoundsCapture()).toBe(true)

    await setBrowserPaneBounds({
      sessionId: 'sess-1',
      paneId: 'browser-1',
      bounds: { x: 10, y: 20, width: 640, height: 480 },
      visible: false,
    })
    const hiddenSequence = getBrowserPaneBoundsCaptures()[0]?.sequence

    clearBrowserPaneBoundsCaptures()

    await setBrowserPaneBounds({
      sessionId: 'sess-1',
      paneId: 'browser-1',
      bounds: { x: 10, y: 20, width: 640, height: 480 },
      visible: true,
    })

    expect(hiddenSequence).toBe(0)
    expect(getBrowserPaneBoundsCaptures()).toEqual([
      expect.objectContaining({
        sequence: 1,
        visible: true,
      }),
    ])
  })

  test('keeps active bounds capture when start is called twice', async () => {
    const bridge: BrowserPaneBridge = {
      createPane: vi.fn(),
      setBounds: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn(),
      newTab: vi.fn(),
      destroyPane: vi.fn(),
      focusPane: vi.fn(),
      activateTab: vi.fn(),
      closeTab: vi.fn(),
      openExternal: vi.fn(),
      navAction: vi.fn(),
      getCdpInfo: vi.fn(),
      onFocus: vi.fn(() => (): void => undefined),
      onFocusAddress: vi.fn(() => (): void => undefined),
      onUrlChange: vi.fn(() => (): void => undefined),
      onTabsChange: vi.fn(() => (): void => undefined),
      onNavStateChange: vi.fn(() => (): void => undefined),
    }
    browserWindow().vimeflow = {
      invoke: vi.fn(),
      listen: vi.fn(),
      browserPane: bridge,
    }

    expect(startBrowserPaneBoundsCapture()).toBe(true)

    await setBrowserPaneBounds({
      sessionId: 'sess-1',
      paneId: 'browser-1',
      bounds: { x: 10, y: 20, width: 640, height: 480 },
      visible: false,
    })

    expect(startBrowserPaneBoundsCapture()).toBe(true)

    await setBrowserPaneBounds({
      sessionId: 'sess-1',
      paneId: 'browser-1',
      bounds: { x: 10, y: 20, width: 640, height: 480 },
      visible: true,
    })

    expect(getBrowserPaneBoundsCaptures()).toEqual([
      expect.objectContaining({
        sequence: 0,
        visible: false,
      }),
      expect.objectContaining({
        sequence: 1,
        visible: true,
      }),
    ])
  })

  test('stops bounds capture without discarding collected captures', async () => {
    const bridge: BrowserPaneBridge = {
      createPane: vi.fn(),
      setBounds: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn(),
      newTab: vi.fn(),
      destroyPane: vi.fn(),
      focusPane: vi.fn(),
      activateTab: vi.fn(),
      closeTab: vi.fn(),
      openExternal: vi.fn(),
      navAction: vi.fn(),
      getCdpInfo: vi.fn(),
      onFocus: vi.fn(() => (): void => undefined),
      onFocusAddress: vi.fn(() => (): void => undefined),
      onUrlChange: vi.fn(() => (): void => undefined),
      onTabsChange: vi.fn(() => (): void => undefined),
      onNavStateChange: vi.fn(() => (): void => undefined),
    }
    browserWindow().vimeflow = {
      invoke: vi.fn(),
      listen: vi.fn(),
      browserPane: bridge,
    }

    expect(startBrowserPaneBoundsCapture()).toBe(true)

    await setBrowserPaneBounds({
      sessionId: 'sess-1',
      paneId: 'browser-1',
      bounds: { x: 10, y: 20, width: 640, height: 480 },
      visible: false,
    })

    stopBrowserPaneBoundsCapture()

    await setBrowserPaneBounds({
      sessionId: 'sess-1',
      paneId: 'browser-1',
      bounds: { x: 10, y: 20, width: 640, height: 480 },
      visible: true,
    })

    expect(getBrowserPaneBoundsCaptures()).toEqual([
      expect.objectContaining({
        sequence: 0,
        visible: false,
      }),
    ])
  })

  test('starts a fresh bounds capture session after stopping', async () => {
    const bridge: BrowserPaneBridge = {
      createPane: vi.fn(),
      setBounds: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn(),
      newTab: vi.fn(),
      destroyPane: vi.fn(),
      focusPane: vi.fn(),
      activateTab: vi.fn(),
      closeTab: vi.fn(),
      openExternal: vi.fn(),
      navAction: vi.fn(),
      getCdpInfo: vi.fn(),
      onFocus: vi.fn(() => (): void => undefined),
      onFocusAddress: vi.fn(() => (): void => undefined),
      onUrlChange: vi.fn(() => (): void => undefined),
      onTabsChange: vi.fn(() => (): void => undefined),
      onNavStateChange: vi.fn(() => (): void => undefined),
    }
    browserWindow().vimeflow = {
      invoke: vi.fn(),
      listen: vi.fn(),
      browserPane: bridge,
    }

    expect(startBrowserPaneBoundsCapture()).toBe(true)

    await setBrowserPaneBounds({
      sessionId: 'sess-1',
      paneId: 'browser-1',
      bounds: { x: 10, y: 20, width: 640, height: 480 },
      visible: false,
    })

    stopBrowserPaneBoundsCapture()

    expect(getBrowserPaneBoundsCaptures()).toEqual([
      expect.objectContaining({
        sequence: 0,
        visible: false,
      }),
    ])

    expect(startBrowserPaneBoundsCapture()).toBe(true)
    expect(getBrowserPaneBoundsCaptures()).toEqual([])

    await setBrowserPaneBounds({
      sessionId: 'sess-1',
      paneId: 'browser-1',
      bounds: { x: 10, y: 20, width: 640, height: 480 },
      visible: true,
    })

    expect(getBrowserPaneBoundsCaptures()).toEqual([
      expect.objectContaining({
        sequence: 0,
        visible: true,
      }),
    ])
  })

  test('does not start bounds capture without the preload browser bridge', () => {
    delete browserWindow().vimeflow

    expect(startBrowserPaneBoundsCapture()).toBe(false)
  })
})
