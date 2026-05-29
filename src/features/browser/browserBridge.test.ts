import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createBrowserPane,
  destroyBrowserPane,
  focusBrowserPane,
  getBrowserCdpInfo,
  navigateBrowserPane,
  onBrowserPaneFocus,
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

    const bridge: BrowserPaneBridge = {
      createPane: vi.fn().mockResolvedValue({
        url: 'https://created.example/',
        title: 'Created',
        partition: 'persist:vimeflow-browser:proj-1:pty-1',
      }),
      setBounds: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue(undefined),
      destroyPane: vi.fn().mockResolvedValue(undefined),
      focusPane: vi.fn().mockResolvedValue(undefined),
      getCdpInfo: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:9223',
        token: 'token',
        origin: 'vimeflow://agent-plugin/local',
        targetId: 'pty-1:p1',
      }),
      onFocus: vi.fn(() => unlistenFocus),
      onUrlChange: vi.fn(() => unlistenUrl),
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

    await destroyBrowserPane({ sessionId: 'pty-1', paneId: 'p1' })
    await focusBrowserPane({ sessionId: 'pty-1', paneId: 'p1' })
    await expect(
      getBrowserCdpInfo({ sessionId: 'pty-1', paneId: 'p1' })
    ).resolves.toMatchObject({
      token: 'token',
    })

    const focusCleanup = onBrowserPaneFocus(() => undefined)
    const urlCleanup = onBrowserPaneUrlChange(() => undefined)

    expect(bridge.createPane).toHaveBeenCalledWith(request)
    expect(bridge.setBounds).toHaveBeenCalledOnce()
    expect(bridge.navigate).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'p1',
      url: 'https://next.example/',
    })

    expect(bridge.destroyPane).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'p1',
    })

    expect(bridge.focusPane).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'p1',
    })

    expect(bridge.getCdpInfo).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'p1',
    })
    expect(focusCleanup).toBe(unlistenFocus)
    expect(urlCleanup).toBe(unlistenUrl)
  })
})
