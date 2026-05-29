import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  activateBrowserPaneTab,
  closeBrowserPaneTab,
  createBrowserPane,
  destroyBrowserPane,
  focusBrowserPane,
  getBrowserCdpInfo,
  navigateBrowserPane,
  newBrowserPaneTab,
  onBrowserPaneFocus,
  onBrowserPaneTabsChange,
  onBrowserPaneUrlChange,
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
        },
      ],
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
  })

  test('delegates bridge calls to window.vimeflow.browserPane', async () => {
    const unlistenFocus = vi.fn()
    const unlistenUrl = vi.fn()
    const unlistenTabs = vi.fn()

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
      }),
      setBounds: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue(undefined),
      newTab: vi.fn().mockResolvedValue(undefined),
      destroyPane: vi.fn().mockResolvedValue(undefined),
      focusPane: vi.fn().mockResolvedValue(undefined),
      activateTab: vi.fn().mockResolvedValue(undefined),
      closeTab: vi.fn().mockResolvedValue(undefined),
      getCdpInfo: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:9223',
        token: 'token',
        origin: 'vimeflow://agent-plugin/local',
        targetId: 'pty-1:p1',
      }),
      onFocus: vi.fn(() => unlistenFocus),
      onUrlChange: vi.fn(() => unlistenUrl),
      onTabsChange: vi.fn(() => unlistenTabs),
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

    await expect(
      getBrowserCdpInfo({ sessionId: 'pty-1', paneId: 'p1' })
    ).resolves.toMatchObject({
      token: 'token',
    })

    const focusCleanup = onBrowserPaneFocus(() => undefined)
    const urlCleanup = onBrowserPaneUrlChange(() => undefined)
    const tabsCleanup = onBrowserPaneTabsChange(() => undefined)

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
    expect(focusCleanup).toBe(unlistenFocus)
    expect(urlCleanup).toBe(unlistenUrl)
    expect(tabsCleanup).toBe(unlistenTabs)
  })
})
