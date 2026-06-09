import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  activateBrowserPaneTab,
  closeBrowserPaneTab,
  createBrowserPane,
  destroyBrowserPane,
  focusBrowserPane,
  getBrowserCdpInfo,
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
} from './browserBridge'
import type { BrowserPaneBridge } from './types'

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
})
