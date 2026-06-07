import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { connect } from 'node:net'
import {
  BROWSER_PANE_ACTIVATE_TAB,
  BROWSER_PANE_CDP_INFO,
  BROWSER_PANE_CLOSE_TAB,
  BROWSER_PANE_CREATE,
  BROWSER_PANE_DESTROY,
  BROWSER_PANE_FOCUS_ADDRESS,
  BROWSER_PANE_NAV_ACTION,
  BROWSER_PANE_NAV_STATE_CHANGED,
  BROWSER_PANE_NEW_TAB,
  BROWSER_PANE_OPEN_EXTERNAL,
  BROWSER_PANE_SET_BOUNDS,
  BROWSER_PANE_TABS_CHANGED,
} from './browser-pane-channels'
import { BrowserPaneController, isFocusAddressShortcut } from './browser-pane'

// cspell:ignore debuggee Lkls
type IpcHandler = (event: unknown, payload?: unknown) => unknown
type EventHandler = (...args: unknown[]) => void

interface FakeDebugger {
  isAttached: () => boolean
  attach: (version: string) => void
  detach: () => void
  on: (event: string, handler: EventHandler) => void
  off: (event: string, handler: EventHandler) => void
  sendCommand: (
    method: string,
    params: Record<string, unknown>
  ) => Promise<unknown>
}

interface FakeWebContents {
  id: number
  loadURL: (url: string) => Promise<void>
  getURL: () => string
  getTitle: () => string
  setAudioMuted: (muted: boolean) => void
  setWindowOpenHandler: (handler: unknown) => void
  session?: unknown
  on: (event: string, handler: EventHandler) => FakeWebContents
  once: (event: string, handler: EventHandler) => FakeWebContents
  removeListener: (event: string, handler: EventHandler) => FakeWebContents
  isDestroyed: () => boolean
  close: () => void
  focus: () => void
  send: (channel: string, payload: unknown) => void
  executeJavaScript: (source: string, userGesture?: boolean) => Promise<unknown>
  debugger: FakeDebugger
}

const electronMock = vi.hoisted(() => {
  type LocalIpcHandler = (event: unknown, payload?: unknown) => unknown
  type LocalEventHandler = (...args: unknown[]) => void

  interface LocalBounds {
    x: number
    y: number
    width: number
    height: number
  }

  interface LocalFakeDebugger {
    isAttached: () => boolean
    attach: (version: string) => void
    detach: () => void
    on: (event: string, handler: LocalEventHandler) => void
    off: (event: string, handler: LocalEventHandler) => void
    sendCommand: (
      method: string,
      params: Record<string, unknown>
    ) => Promise<unknown>
  }

  interface LocalFakeWebContents {
    id: number
    loadURL: (url: string) => Promise<void>
    getURL: () => string
    getTitle: () => string
    setAudioMuted: (muted: boolean) => void
    setWindowOpenHandler: (handler: unknown) => void
    session?: unknown
    on: (event: string, handler: LocalEventHandler) => LocalFakeWebContents
    once: (event: string, handler: LocalEventHandler) => LocalFakeWebContents
    removeListener: (
      event: string,
      handler: LocalEventHandler
    ) => LocalFakeWebContents
    isDestroyed: () => boolean
    close: () => void
    focus: () => void
    send: (channel: string, payload: unknown) => void
    executeJavaScript: (
      source: string,
      userGesture?: boolean
    ) => Promise<unknown>
    navigationHistory: {
      canGoBack: () => boolean
      canGoForward: () => boolean
      goBack: () => void
      goForward: () => void
      getAllEntries: () => { url: string; title: string }[]
      getActiveIndex: () => number
      restore: (options: {
        index?: number
        entries: { url: string; title: string }[]
      }) => void
    }
    isLoading: () => boolean
    reload: () => void
    stop: () => void
    debugger: LocalFakeDebugger
  }

  interface LocalFakeView {
    webContents: LocalFakeWebContents
    setBounds: (bounds: LocalBounds) => void
  }

  interface LocalFakeWindow {
    id: number
    webContents: LocalFakeWebContents
    contentView: {
      addChildView: (view: LocalFakeView) => void
      removeChildView: (view: LocalFakeView) => void
    }
    once: (event: string, handler: LocalEventHandler) => void
    removeListener: (event: string, handler: LocalEventHandler) => void
    isDestroyed: () => boolean
    isFocused: () => boolean
    close: () => void
    destroy: () => void
  }

  let nextWebContentsId = 1
  const handlers = new Map<string, LocalIpcHandler>()
  const views: LocalFakeView[] = []

  const createWebContents = (): LocalFakeWebContents => {
    let currentUrl = ''

    const debuggee: LocalFakeDebugger = {
      isAttached: vi.fn(() => false),
      attach: vi.fn(),
      detach: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      sendCommand: vi.fn().mockResolvedValue({}),
    }

    const webContents: LocalFakeWebContents = {
      id: nextWebContentsId,
      loadURL: vi.fn((url: string): Promise<void> => {
        currentUrl = url

        return new Promise(() => undefined)
      }),
      getURL: vi.fn(() => currentUrl),
      getTitle: vi.fn(() => 'Example'),
      setAudioMuted: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      session: fakeSession,
      on: vi.fn(() => webContents),
      once: vi.fn(() => webContents),
      removeListener: vi.fn(() => webContents),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      focus: vi.fn(),
      send: vi.fn(),
      executeJavaScript: vi.fn().mockResolvedValue(undefined),
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
        goBack: vi.fn(),
        goForward: vi.fn(),
        getAllEntries: vi.fn((): { url: string; title: string }[] => []),
        getActiveIndex: vi.fn(() => -1),
        restore: vi.fn(),
      },
      isLoading: vi.fn(() => false),
      reload: vi.fn(),
      stop: vi.fn(),
      debugger: debuggee,
    }

    nextWebContentsId += 1

    return webContents
  }

  const fakeSession = {
    fetch: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  }

  let sender = createWebContents()
  let win: LocalFakeWindow

  const resetWindow = (): void => {
    sender = createWebContents()
    win = {
      id: 7,
      webContents: createWebContents(),
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
      },
      once: vi.fn(),
      removeListener: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isFocused: vi.fn(() => true),
      close: vi.fn(),
      destroy: vi.fn(),
    }
  }

  const createPopupWindow = (): LocalFakeWindow => ({
    id: 70 + nextWebContentsId,
    webContents: createWebContents(),
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    once: vi.fn(),
    removeListener: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => true),
    close: vi.fn(),
    destroy: vi.fn(),
  })

  resetWindow()

  const BrowserWindow = {
    fromWebContents: vi.fn(() => win),
    fromId: vi.fn(() => win),
  }

  const WebContentsView = vi.fn(function createView(): LocalFakeView {
    const view: LocalFakeView = {
      webContents: createWebContents(),
      setBounds: vi.fn(),
    }

    views.push(view)

    return view
  })

  const ipcMain = {
    handle: vi.fn((channel: string, handler: LocalIpcHandler): void => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string): void => {
      handlers.delete(channel)
    }),
  }

  const session = {
    fromPartition: vi.fn(() => fakeSession),
  }

  const shell = {
    openExternal: vi.fn(),
  }

  return {
    BrowserWindow,
    WebContentsView,
    fakeSession,
    handlers,
    ipcMain,
    shell,
    get sender(): LocalFakeWebContents {
      return sender
    },
    session,
    get views(): LocalFakeView[] {
      return views
    },
    get win(): LocalFakeWindow {
      return win
    },
    createPopupWindow,
    reset(): void {
      handlers.clear()
      views.splice(0, views.length)
      nextWebContentsId = 1
      resetWindow()
      BrowserWindow.fromWebContents.mockClear()
      BrowserWindow.fromId.mockClear()
      WebContentsView.mockClear()
      ipcMain.handle.mockClear()
      ipcMain.removeHandler.mockClear()
      shell.openExternal.mockClear()
      session.fromPartition.mockClear()
      fakeSession.on.mockClear()
      fakeSession.removeAllListeners.mockClear()
      fakeSession.setPermissionRequestHandler.mockClear()
      fakeSession.setPermissionCheckHandler.mockClear()
    },
  }
})

vi.mock('electron', () => ({
  BrowserWindow: electronMock.BrowserWindow,
  WebContentsView: electronMock.WebContentsView,
  ipcMain: electronMock.ipcMain,
  session: electronMock.session,
  shell: electronMock.shell,
}))

const eventForSender = (): { sender: FakeWebContents } => ({
  sender: electronMock.sender as unknown as FakeWebContents,
})

const platformShortcutModifier = (): { control: boolean; meta: boolean } =>
  process.platform === 'darwin'
    ? { control: false, meta: true }
    : { control: true, meta: false }

const handler = (channel: string): IpcHandler => {
  const registered = electronMock.handlers.get(channel)
  if (!registered) {
    throw new Error(`missing handler ${channel}`)
  }

  return registered as IpcHandler
}

const listenerFor = (viewIndex: number, eventName: string): EventHandler => {
  const found = vi
    .mocked(electronMock.views[viewIndex].webContents.on)
    .mock.calls.find(([name]) => name === eventName)?.[1]

  if (found === undefined) {
    throw new Error(`missing ${eventName} listener`)
  }

  return found
}

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller): void {
      if (bytes.byteLength > 0) {
        controller.enqueue(bytes)
      }
      controller.close()
    },
  })

const imageResponse = (
  type: string,
  bytes: Uint8Array,
  extra: Record<string, string> = {}
): Response =>
  ({
    ok: true,
    headers: new Headers({ 'content-type': type, ...extra }),
    body: streamOf(bytes),
  }) as unknown as Response

const makeDeferred = <T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} => {
  let resolveFn: (value: T) => void = () => undefined

  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve
  })

  return { promise, resolve: resolveFn }
}

const callAllListeners = (
  viewIndex: number,
  eventName: string,
  ...args: unknown[]
): void => {
  vi.mocked(electronMock.views[viewIndex].webContents.on)
    .mock.calls.filter(([name]) => name === eventName)
    .forEach(([, fn]) => (fn as (...a: unknown[]) => void)(...args))
}

interface FaviconHarness {
  emitFavicon: (urls: string[]) => void
  emitNavigate: () => void
  emitNavigateInPage: () => void
  tabsChanged: () => { tabs: { id: string; favicon: string | null }[] }[]
  clearSends: () => void
}

const faviconHarness = async (pageUrl: string): Promise<FaviconHarness> => {
  await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'w',
    initialUrl: pageUrl,
  })
  vi.mocked(electronMock.views[0].webContents.getURL).mockReturnValue(pageUrl)

  return {
    emitFavicon: (urls): void =>
      callAllListeners(0, 'page-favicon-updated', {}, urls),
    emitNavigate: (): void => callAllListeners(0, 'did-navigate'),
    emitNavigateInPage: (): void => callAllListeners(0, 'did-navigate-in-page'),
    tabsChanged: (): { tabs: { id: string; favicon: string | null }[] }[] =>
      vi
        .mocked(electronMock.win.webContents.send)
        .mock.calls.filter(([ch]) => ch === BROWSER_PANE_TABS_CHANGED)
        .map(
          ([, payload]) =>
            payload as { tabs: { id: string; favicon: string | null }[] }
        ),
    clearSends: (): void => {
      vi.mocked(electronMock.win.webContents.send).mockClear()
    },
  }
}

const lastFaviconOf = (h: FaviconHarness): string | null => {
  const calls = h.tabsChanged()

  return calls[calls.length - 1].tabs[0].favicon
}

const requestRawUpgrade = (endpoint: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = new URL(endpoint)
    const socket = connect(Number(url.port), url.hostname)
    let settled = false

    const settle = (callback: () => void): void => {
      if (settled) {
        return
      }

      settled = true
      callback()
      socket.destroy()
    }

    socket.setTimeout(1000, () => {
      settle(() => reject(new Error('timed out waiting for CDP response')))
    })

    socket.on('connect', () => {
      socket.write(
        [
          `GET ${url.pathname}${url.search} HTTP/1.1`,
          `Host: ${url.host}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          '',
          '',
        ].join('\r\n')
      )
    })

    socket.on('data', (chunk) => {
      settle(() => resolve(chunk.toString('utf8')))
    })

    socket.on('error', (error) => {
      settle(() => reject(error))
    })
  })

describe('BrowserPaneController', () => {
  let controller: BrowserPaneController

  beforeEach(() => {
    electronMock.reset()
    controller = new BrowserPaneController()
    controller.install()
  })

  afterEach(() => {
    controller.dispose()
  })

  test('rejects invalid create payloads', async () => {
    await expect(
      handler(BROWSER_PANE_CREATE)(eventForSender(), { paneId: 'p1' })
    ).rejects.toThrow('invalid browser pane create payload')
  })

  test('createPane returns tabs with favicon null initially', async () => {
    const result = (await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })) as { tabs: { favicon: string | null }[] }
    expect(result.tabs[0].favicon).toBe(null)
  })

  test('captureTabsForPane returns per-tab nav history + active index', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'w',
      initialUrl: 'https://a.example/',
    })

    const wc = electronMock.views[0].webContents
    vi.mocked(wc.navigationHistory.getAllEntries).mockReturnValue([
      { url: 'https://a.example/', title: 'A' },
      { url: 'https://a.example/sub', title: 'Sub' },
    ])
    vi.mocked(wc.navigationHistory.getActiveIndex).mockReturnValue(1)

    expect(controller.captureTabsForPane('pty-1', 'p1')).toEqual([
      {
        active: true,
        historyIndex: 1,
        history: [
          { url: 'https://a.example/', title: 'A' },
          { url: 'https://a.example/sub', title: 'Sub' },
        ],
      },
    ])

    expect(controller.captureTabsForPane('nope', 'p1')).toBeNull()
  })

  test('write signals: tab lifecycle is structural, navigation is volatile', async () => {
    const signals = { markStructural: vi.fn(), markVolatile: vi.fn() }
    controller.setWriteSignals(signals)

    const created = (await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'w',
      initialUrl: 'https://a.example/',
    })) as { tabs: { id: string }[] }
    const firstTabId = created.tabs[0].id

    // In-tab navigation → volatile (debounced).
    signals.markVolatile.mockClear()
    callAllListeners(0, 'did-navigate')
    expect(signals.markVolatile).toHaveBeenCalled()

    // Open a tab → structural (immediate).
    signals.markStructural.mockClear()
    await handler(BROWSER_PANE_NEW_TAB)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      url: 'https://b.example/',
    })
    expect(signals.markStructural).toHaveBeenCalled()

    // Switch active tab → structural.
    signals.markStructural.mockClear()
    await handler(BROWSER_PANE_ACTIVATE_TAB)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      tabId: firstTabId,
    })
    expect(signals.markStructural).toHaveBeenCalled()

    // Close a tab (two open) → structural.
    signals.markStructural.mockClear()
    await handler(BROWSER_PANE_CLOSE_TAB)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      tabId: firstTabId,
    })
    expect(signals.markStructural).toHaveBeenCalled()
  })

  test('render-process-gone preserves records for reconnect; destroyed disposes', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'w',
      initialUrl: 'https://a.example/',
    })
    expect(controller.captureTabsForPane('pty-1', 'p1')).not.toBeNull()

    const onceCalls = vi.mocked(electronMock.sender.once).mock.calls
    // A renderer crash/reload must NOT tear the pane down (no such listener).
    expect(onceCalls.map(([event]) => event)).not.toContain(
      'render-process-gone'
    )

    // Genuine teardown (owner WebContents destroyed) still disposes the record.
    const destroyed = onceCalls.find(
      ([event]) => event === 'destroyed'
    )?.[1] as (() => void) | undefined
    expect(destroyed).toBeDefined()
    destroyed?.()
    expect(controller.captureTabsForPane('pty-1', 'p1')).toBeNull()
  })

  test('restore-mode create replays per-tab history before any load', async () => {
    controller.setRestoreTabsProvider((sessionId, paneId) =>
      sessionId === 'pty-1' && paneId === 'p1'
        ? [
            {
              active: true,
              historyIndex: 1,
              history: [
                { url: 'https://a.example/', title: 'A' },
                { url: 'https://a.example/sub', title: null },
              ],
            },
            {
              active: false,
              historyIndex: 0,
              history: [{ url: 'https://b.example/', title: 'B' }],
            },
          ]
        : null
    )

    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'w',
      restore: true,
    })

    // One WebContentsView per persisted tab.
    expect(electronMock.views).toHaveLength(2)

    // History restored (titles null→'') instead of a load (restore-before-load).
    expect(
      electronMock.views[0].webContents.navigationHistory.restore
    ).toHaveBeenCalledWith({
      index: 1,
      entries: [
        { url: 'https://a.example/', title: 'A' },
        { url: 'https://a.example/sub', title: '' },
      ],
    })

    expect(
      electronMock.views[1].webContents.navigationHistory.restore
    ).toHaveBeenCalledWith({
      index: 0,
      entries: [{ url: 'https://b.example/', title: 'B' }],
    })
    expect(electronMock.views[0].webContents.loadURL).not.toHaveBeenCalled()
  })

  test('restore-mode with no persisted tabs falls back to a default load', async () => {
    controller.setRestoreTabsProvider(() => null)

    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'w',
      restore: true,
    })

    expect(electronMock.views).toHaveLength(1)
    expect(electronMock.views[0].webContents.loadURL).toHaveBeenCalled()
    expect(
      electronMock.views[0].webContents.navigationHistory.restore
    ).not.toHaveBeenCalled()
  })

  test('a data: image favicon candidate is stored verbatim', async () => {
    const h = await faviconHarness('https://example.com/')
    h.clearSends()
    h.emitFavicon(['data:image/png;base64,iVBORw0KGgo='])
    await flushMicrotasks()
    expect(lastFaviconOf(h)).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  test('an http image favicon is fetched (no credentials, no redirects) and inlined', async () => {
    const h = await faviconHarness('https://example.com/')
    electronMock.fakeSession.fetch = vi
      .fn()
      .mockResolvedValue(
        imageResponse('image/png', new Uint8Array([1, 2, 3, 4]))
      )
    h.clearSends()
    h.emitFavicon(['https://example.com/favicon.png'])
    await flushMicrotasks()
    expect(lastFaviconOf(h)).toMatch(/^data:image\/png;base64,/)
    expect(electronMock.fakeSession.fetch).toHaveBeenCalledWith(
      'https://example.com/favicon.png',
      expect.objectContaining({ redirect: 'error', credentials: 'omit' })
    )
  })

  test('the new-tab path also resolves favicons (view 1, not only create)', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'w',
      initialUrl: 'https://a.com/',
    })

    await handler(BROWSER_PANE_NEW_TAB)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      url: 'https://b.com/',
    })

    vi.mocked(electronMock.views[1].webContents.getURL).mockReturnValue(
      'https://b.com/'
    )

    electronMock.fakeSession.fetch = vi
      .fn()
      .mockResolvedValue(imageResponse('image/png', new Uint8Array([1])))
    vi.mocked(electronMock.win.webContents.send).mockClear()
    callAllListeners(1, 'page-favicon-updated', {}, [
      'https://b.com/favicon.png',
    ])
    await flushMicrotasks()

    const calls = vi
      .mocked(electronMock.win.webContents.send)
      .mock.calls.filter(([ch]) => ch === BROWSER_PANE_TABS_CHANGED)
      .map(
        ([, payload]) =>
          payload as { tabs: { id: string; favicon: string | null }[] }
      )
    const newTab = calls[calls.length - 1].tabs.find((t) => t.id !== 'tab-0')
    expect(newTab?.favicon).toMatch(/^data:image\/png;base64,/)
  })

  test.each([
    ['non-image content-type', imageResponse('text/html', new Uint8Array([1]))],
    [
      'non-ok response',
      {
        ok: false,
        headers: new Headers(),
        body: streamOf(new Uint8Array()),
      } as unknown as Response,
    ],
    ['zero-byte image body', imageResponse('image/png', new Uint8Array())],
    [
      'over-cap via content-length',
      imageResponse('image/png', new Uint8Array([1]), {
        'content-length': String(40 * 1024),
      }),
    ],
  ])('http favicon %s yields null', async (_label, response) => {
    const h = await faviconHarness('https://example.com/')
    electronMock.fakeSession.fetch = vi.fn().mockResolvedValue(response)
    h.clearSends()
    h.emitFavicon(['https://example.com/favicon.png'])
    await flushMicrotasks()
    expect(lastFaviconOf(h)).toBe(null)
  })

  test('over-cap via streamed bytes yields null', async () => {
    const h = await faviconHarness('https://example.com/')
    electronMock.fakeSession.fetch = vi
      .fn()
      .mockResolvedValue(imageResponse('image/png', new Uint8Array(40 * 1024)))
    h.clearSends()
    h.emitFavicon(['https://example.com/favicon.png'])
    await flushMicrotasks()
    expect(lastFaviconOf(h)).toBe(null)
  })

  test('empty favicons array yields null', async () => {
    const h = await faviconHarness('https://example.com/')
    h.clearSends()
    h.emitFavicon([])
    await flushMicrotasks()
    expect(lastFaviconOf(h)).toBe(null)
  })

  test('candidate fallback: first non-ok, second image wins', async () => {
    const h = await faviconHarness('https://example.com/')
    electronMock.fakeSession.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        headers: new Headers(),
        body: streamOf(new Uint8Array()),
      } as unknown as Response)
      .mockResolvedValueOnce(imageResponse('image/png', new Uint8Array([9, 9])))
    h.clearSends()
    h.emitFavicon(['https://example.com/a.png', 'https://example.com/b.png'])
    await flushMicrotasks()
    expect(lastFaviconOf(h)).toMatch(/^data:image\/png;base64,/)
    expect(electronMock.fakeSession.fetch).toHaveBeenCalledTimes(2)
  })

  test.each([
    '127.0.0.1',
    '10.0.0.5',
    '169.254.169.254',
    'localhost',
    '192.168.1.1',
  ])('public page to private favicon host %s is blocked', async (host) => {
    const h = await faviconHarness('https://example.com/')
    electronMock.fakeSession.fetch = vi.fn()
    h.clearSends()
    h.emitFavicon([`http://${host}/favicon.ico`])
    await flushMicrotasks()
    expect(electronMock.fakeSession.fetch).not.toHaveBeenCalled()
    expect(lastFaviconOf(h)).toBe(null)
  })

  test('localhost page keeps its own localhost favicon (private allowed)', async () => {
    const h = await faviconHarness('http://localhost:3000/')
    electronMock.fakeSession.fetch = vi
      .fn()
      .mockResolvedValue(imageResponse('image/png', new Uint8Array([1, 2])))
    h.clearSends()
    h.emitFavicon(['http://localhost:3000/favicon.png'])
    await flushMicrotasks()
    expect(electronMock.fakeSession.fetch).toHaveBeenCalledTimes(1)
    expect(lastFaviconOf(h)).toMatch(/^data:image\/png;base64,/)
  })

  test('a public domain beginning with fd is not misread as private', async () => {
    const h = await faviconHarness('https://fd-attacker.example/')
    electronMock.fakeSession.fetch = vi.fn()
    h.clearSends()
    h.emitFavicon(['http://127.0.0.1/favicon.ico'])
    await flushMicrotasks()
    expect(electronMock.fakeSession.fetch).not.toHaveBeenCalled()
    expect(lastFaviconOf(h)).toBe(null)
  })

  test('a private-range IPv6 favicon target is blocked from a public page', async () => {
    const h = await faviconHarness('https://example.com/')
    electronMock.fakeSession.fetch = vi.fn()
    h.clearSends()
    h.emitFavicon(['http://[fd00::1]/favicon.ico'])
    await flushMicrotasks()
    expect(electronMock.fakeSession.fetch).not.toHaveBeenCalled()
    expect(lastFaviconOf(h)).toBe(null)
  })

  test('a trailing-dot loopback favicon target is blocked from a public page', async () => {
    const h = await faviconHarness('https://example.com/')
    electronMock.fakeSession.fetch = vi.fn()
    h.clearSends()
    h.emitFavicon(['http://localhost./favicon.ico'])
    await flushMicrotasks()
    expect(electronMock.fakeSession.fetch).not.toHaveBeenCalled()
    expect(lastFaviconOf(h)).toBe(null)
  })

  test('an IPv4-mapped IPv6 loopback favicon target is blocked from a public page', async () => {
    const h = await faviconHarness('https://example.com/')
    electronMock.fakeSession.fetch = vi.fn()
    h.clearSends()
    h.emitFavicon(['http://[::ffff:7f00:1]/favicon.ico'])
    await flushMicrotasks()
    expect(electronMock.fakeSession.fetch).not.toHaveBeenCalled()
    expect(lastFaviconOf(h)).toBe(null)
  })

  test('a link-local IPv6 favicon target (fe90::) is blocked from a public page', async () => {
    const h = await faviconHarness('https://example.com/')
    electronMock.fakeSession.fetch = vi.fn()
    h.clearSends()
    h.emitFavicon(['http://[fe90::1]/favicon.ico'])
    await flushMicrotasks()
    expect(electronMock.fakeSession.fetch).not.toHaveBeenCalled()
    expect(lastFaviconOf(h)).toBe(null)
  })

  test('a public IPv6 favicon target is fetched normally', async () => {
    const h = await faviconHarness('https://example.com/')
    electronMock.fakeSession.fetch = vi
      .fn()
      .mockResolvedValue(imageResponse('image/png', new Uint8Array([1, 2])))
    h.clearSends()
    h.emitFavicon(['http://[2001:4860:4860::8888]/favicon.png'])
    await flushMicrotasks()
    expect(electronMock.fakeSession.fetch).toHaveBeenCalledTimes(1)
    expect(lastFaviconOf(h)).toMatch(/^data:image\/png;base64,/)
  })

  test('a pre-navigation in-flight fetch never overwrites the new tab', async () => {
    const h = await faviconHarness('https://a.com/')
    const deferred = makeDeferred<Response>()
    electronMock.fakeSession.fetch = vi.fn().mockReturnValue(deferred.promise)
    h.emitFavicon(['https://a.com/icon.png'])
    h.emitNavigate()
    h.clearSends()
    deferred.resolve(imageResponse('image/png', new Uint8Array([7])))
    await flushMicrotasks()
    expect(h.tabsChanged().some((e) => e.tabs[0].favicon !== null)).toBe(false)
  })

  test('a newer favicon event supersedes an older in-flight fetch', async () => {
    const h = await faviconHarness('https://a.com/')
    const first = makeDeferred<Response>()
    electronMock.fakeSession.fetch = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(
        imageResponse('image/png', new Uint8Array([2, 2, 2]))
      )
    h.emitFavicon(['https://a.com/icon-a.png'])
    h.emitFavicon(['https://a.com/icon-b.png'])
    await flushMicrotasks()
    const afterB = lastFaviconOf(h)
    expect(afterB).toMatch(/^data:image\/png;base64,/)
    first.resolve(imageResponse('image/png', new Uint8Array([9, 9, 9, 9])))
    await flushMicrotasks()
    expect(lastFaviconOf(h)).toBe(afterB)
  })

  test('dedup: a repeat same-favicon event does not refetch', async () => {
    const h = await faviconHarness('https://a.com/')
    electronMock.fakeSession.fetch = vi
      .fn()
      .mockResolvedValue(imageResponse('image/png', new Uint8Array([3])))
    h.emitFavicon(['https://a.com/icon.png'])
    await flushMicrotasks()
    h.emitFavicon(['https://a.com/icon.png'])
    await flushMicrotasks()
    expect(electronMock.fakeSession.fetch).toHaveBeenCalledTimes(1)
  })

  test('did-navigate clears the favicon in one cleared snapshot', async () => {
    const h = await faviconHarness('https://a.com/')
    electronMock.fakeSession.fetch = vi
      .fn()
      .mockResolvedValue(imageResponse('image/png', new Uint8Array([5])))
    h.emitFavicon(['https://a.com/icon.png'])
    await flushMicrotasks()
    h.clearSends()
    h.emitNavigate()
    await flushMicrotasks()
    expect(h.tabsChanged().length).toBeGreaterThan(0)
    expect(h.tabsChanged().every((e) => e.tabs[0].favicon === null)).toBe(true)
  })

  test('did-navigate-in-page does not reset the favicon', async () => {
    const h = await faviconHarness('https://a.com/')
    electronMock.fakeSession.fetch = vi
      .fn()
      .mockResolvedValue(imageResponse('image/png', new Uint8Array([5])))
    h.emitFavicon(['https://a.com/icon.png'])
    await flushMicrotasks()
    h.clearSends()
    h.emitNavigateInPage()
    await flushMicrotasks()
    expect(lastFaviconOf(h)).toMatch(/^data:image\/png;base64,/)
  })

  test('reconnect createPane returns tabs carrying the current favicon', async () => {
    const h = await faviconHarness('https://a.com/')
    electronMock.fakeSession.fetch = vi
      .fn()
      .mockResolvedValue(imageResponse('image/png', new Uint8Array([2])))
    h.emitFavicon(['https://a.com/icon.png'])
    await flushMicrotasks()

    const reconnect = (await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'w',
      initialUrl: 'https://a.com/',
    })) as { tabs: { favicon: string | null }[] }
    expect(reconnect.tabs[0].favicon).toMatch(/^data:image\/png;base64,/)
  })

  test('creates persistent app-scoped panes and resolves before page load settles', async () => {
    const createPromise = Promise.resolve(
      handler(BROWSER_PANE_CREATE)(eventForSender(), {
        sessionId: 'pty 1',
        paneId: 'p1',
        workspaceId: 'proj 1',
        initialUrl: 'https://example.com/',
      })
    )

    await expect(
      Promise.race([
        createPromise.then(() => 'resolved' as const),
        new Promise<'pending'>((resolve) => {
          setTimeout(() => resolve('pending'), 20)
        }),
      ])
    ).resolves.toBe('resolved')

    await expect(createPromise).resolves.toMatchObject({
      url: 'https://example.com/',
      partition:
        'persist:vimeflow-browser:proj-1-U4YTnQstCLGyLkls:pty-1-_aMy5oEC2UDG6i_k',
    })

    expect(electronMock.session.fromPartition).toHaveBeenCalledWith(
      'persist:vimeflow-browser:proj-1-U4YTnQstCLGyLkls:pty-1-_aMy5oEC2UDG6i_k',
      { cache: true }
    )

    expect(electronMock.WebContentsView).toHaveBeenCalledWith({
      webPreferences: {
        session: electronMock.fakeSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })

    expect(electronMock.win.contentView.addChildView).toHaveBeenCalledWith(
      electronMock.views[0]
    )

    expect(electronMock.views[0]?.webContents.loadURL).toHaveBeenCalledWith(
      'https://example.com/'
    )

    expect(electronMock.fakeSession.on).toHaveBeenCalledWith(
      'select-webauthn-account',
      expect.any(Function)
    )
  })

  test('open-external opens the active tab loaded URL in the system browser', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    await handler(BROWSER_PANE_OPEN_EXTERNAL)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
    })

    expect(electronMock.shell.openExternal).toHaveBeenCalledWith(
      'https://example.com/'
    )
  })

  test('open-external no-ops for a non-http(s) loaded URL', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    vi.mocked(electronMock.views[0]?.webContents.getURL).mockReturnValue(
      'about:blank'
    )

    await handler(BROWSER_PANE_OPEN_EXTERNAL)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
    })

    expect(electronMock.shell.openExternal).not.toHaveBeenCalled()
  })

  test('open-external rejects a malformed payload', () => {
    expect(() =>
      handler(BROWSER_PANE_OPEN_EXTERNAL)(eventForSender(), { paneId: 'p1' })
    ).toThrow('invalid browser pane open-external payload')
  })

  test('open-external handler is removed on dispose', () => {
    expect(electronMock.handlers.has(BROWSER_PANE_OPEN_EXTERNAL)).toBe(true)
    controller.dispose()
    expect(electronMock.handlers.has(BROWSER_PANE_OPEN_EXTERNAL)).toBe(false)
  })

  test('nav-action reload reloads the active tab', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    await handler(BROWSER_PANE_NAV_ACTION)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      action: 'reload',
    })
    expect(electronMock.views[0]?.webContents.reload).toHaveBeenCalledOnce()
  })

  test('nav-action back goes back only when history allows', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })
    const wc = electronMock.views[0].webContents
    vi.mocked(wc.navigationHistory.canGoBack).mockReturnValue(false)
    await handler(BROWSER_PANE_NAV_ACTION)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      action: 'back',
    })
    expect(wc.navigationHistory.goBack).not.toHaveBeenCalled()

    vi.mocked(wc.navigationHistory.canGoBack).mockReturnValue(true)
    await handler(BROWSER_PANE_NAV_ACTION)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      action: 'back',
    })
    expect(wc.navigationHistory.goBack).toHaveBeenCalledOnce()
  })

  test('nav-action forward goes forward only when history allows', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })
    const wc = electronMock.views[0].webContents
    vi.mocked(wc.navigationHistory.canGoForward).mockReturnValue(false)
    await handler(BROWSER_PANE_NAV_ACTION)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      action: 'forward',
    })
    expect(wc.navigationHistory.goForward).not.toHaveBeenCalled()

    vi.mocked(wc.navigationHistory.canGoForward).mockReturnValue(true)
    await handler(BROWSER_PANE_NAV_ACTION)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      action: 'forward',
    })
    expect(wc.navigationHistory.goForward).toHaveBeenCalledOnce()
  })

  test('nav-action stop stops the active tab', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    await handler(BROWSER_PANE_NAV_ACTION)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      action: 'stop',
    })
    expect(electronMock.views[0]?.webContents.stop).toHaveBeenCalledOnce()
  })

  test('nav-action with an unknown action no-ops', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    await handler(BROWSER_PANE_NAV_ACTION)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      action: 'sideways',
    })
    const wc = electronMock.views[0].webContents
    expect(wc.reload).not.toHaveBeenCalled()
    expect(wc.stop).not.toHaveBeenCalled()
  })

  test('nav-action handler is removed on dispose', () => {
    expect(electronMock.handlers.has(BROWSER_PANE_NAV_ACTION)).toBe(true)
    controller.dispose()
    expect(electronMock.handlers.has(BROWSER_PANE_NAV_ACTION)).toBe(false)
  })

  test('did-stop-loading on the active tab emits nav-state', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })
    const wc = electronMock.views[0].webContents
    vi.mocked(wc.navigationHistory.canGoBack).mockReturnValue(true)
    vi.mocked(wc.isLoading).mockReturnValue(false)
    vi.mocked(electronMock.win.webContents.send).mockClear()

    listenerFor(0, 'did-stop-loading')()

    expect(electronMock.win.webContents.send).toHaveBeenCalledWith(
      BROWSER_PANE_NAV_STATE_CHANGED,
      {
        sessionId: 'pty-1',
        paneId: 'p1',
        tabId: 'tab-0',
        canGoBack: true,
        canGoForward: false,
        isLoading: false,
      }
    )
  })

  test('did-start-loading on the active tab emits isLoading true', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })
    vi.mocked(electronMock.views[0].webContents.isLoading).mockReturnValue(true)
    vi.mocked(electronMock.win.webContents.send).mockClear()

    listenerFor(0, 'did-start-loading')()

    expect(electronMock.win.webContents.send).toHaveBeenCalledWith(
      BROWSER_PANE_NAV_STATE_CHANGED,
      expect.objectContaining({ tabId: 'tab-0', isLoading: true })
    )
  })

  test('nav-state emit no-ops for a non-active tab', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    await handler(BROWSER_PANE_NEW_TAB)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      url: 'https://second.example/',
    })
    vi.mocked(electronMock.win.webContents.send).mockClear()

    listenerFor(0, 'did-stop-loading')()

    expect(electronMock.win.webContents.send).not.toHaveBeenCalledWith(
      BROWSER_PANE_NAV_STATE_CHANGED,
      expect.anything()
    )
  })

  test('activating a tab emits its nav-state', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    await handler(BROWSER_PANE_NEW_TAB)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      url: 'https://second.example/',
    })
    vi.mocked(electronMock.win.webContents.send).mockClear()

    await handler(BROWSER_PANE_ACTIVATE_TAB)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      tabId: 'tab-0',
    })

    expect(electronMock.win.webContents.send).toHaveBeenCalledWith(
      BROWSER_PANE_NAV_STATE_CHANGED,
      expect.objectContaining({ paneId: 'p1', tabId: 'tab-0' })
    )
  })

  test('destroying the active tab emits the fallback tab nav-state', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    await handler(BROWSER_PANE_NEW_TAB)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      url: 'https://second.example/',
    })
    vi.mocked(electronMock.win.webContents.send).mockClear()

    listenerFor(1, 'destroyed')()

    expect(electronMock.win.webContents.send).toHaveBeenCalledWith(
      BROWSER_PANE_NAV_STATE_CHANGED,
      expect.objectContaining({ paneId: 'p1', tabId: 'tab-0' })
    )
  })

  test('create returns the active tab nav-state snapshot', async () => {
    const result = await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    expect(result).toMatchObject({
      navState: { canGoBack: false, canGoForward: false, isLoading: false },
    })
  })

  test('reconnect returns the existing tab nav-state snapshot', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    vi.mocked(
      electronMock.views[0].webContents.navigationHistory.canGoBack
    ).mockReturnValue(true)

    const reconnect = await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    expect(reconnect).toMatchObject({ navState: { canGoBack: true } })
  })

  test('Cmd/Ctrl+L on a focused page emits a pane-targeted focus-address event', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    const beforeInputHandler = vi
      .mocked(electronMock.views[0]?.webContents.on)
      .mock.calls.find(([eventName]) => eventName === 'before-input-event')?.[1]

    if (beforeInputHandler === undefined) {
      throw new Error('missing before-input-event handler')
    }

    const preventDefault = vi.fn()
    beforeInputHandler(
      { preventDefault },
      {
        type: 'keyDown',
        key: 'l',
        code: 'KeyL',
        ...platformShortcutModifier(),
        alt: false,
      }
    )

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(electronMock.win.webContents.send).toHaveBeenCalledWith(
      BROWSER_PANE_FOCUS_ADDRESS,
      { sessionId: 'pty-1', paneId: 'p1' }
    )
  })

  test('a non-L keystroke does not emit a focus-address event', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    const beforeInputHandler = vi
      .mocked(electronMock.views[0]?.webContents.on)
      .mock.calls.find(([eventName]) => eventName === 'before-input-event')?.[1]

    if (beforeInputHandler === undefined) {
      throw new Error('missing before-input-event handler')
    }

    beforeInputHandler(
      { preventDefault: vi.fn() },
      {
        type: 'keyDown',
        key: 'j',
        code: 'KeyJ',
        ...platformShortcutModifier(),
        alt: false,
      }
    )

    expect(electronMock.win.webContents.send).not.toHaveBeenCalledWith(
      BROWSER_PANE_FOCUS_ADDRESS,
      expect.anything()
    )
  })

  test('isFocusAddressShortcut matches the platform modifier only', () => {
    const keyL = {
      type: 'keyDown',
      key: 'l',
      code: 'KeyL',
      control: false,
      meta: false,
      alt: false,
    }

    expect(isFocusAddressShortcut({ ...keyL, meta: true }, 'darwin')).toBe(true)
    expect(isFocusAddressShortcut({ ...keyL, control: true }, 'darwin')).toBe(
      false
    )

    expect(isFocusAddressShortcut({ ...keyL, control: true }, 'linux')).toBe(
      true
    )
    expect(isFocusAddressShortcut({ ...keyL, meta: true }, 'linux')).toBe(false)
    expect(
      isFocusAddressShortcut({ ...keyL, meta: true, alt: true }, 'darwin')
    ).toBe(false)

    expect(
      isFocusAddressShortcut({ ...keyL, meta: true, shift: true }, 'darwin')
    ).toBe(false)

    expect(
      isFocusAddressShortcut(
        { ...keyL, meta: true, isAutoRepeat: true },
        'darwin'
      )
    ).toBe(false)

    expect(
      isFocusAddressShortcut({ ...keyL, meta: true, type: 'keyUp' }, 'darwin')
    ).toBe(false)

    expect(
      isFocusAddressShortcut(
        {
          type: 'keyDown',
          key: 'j',
          code: 'KeyJ',
          control: false,
          meta: true,
          alt: false,
        },
        'darwin'
      )
    ).toBe(false)
  })

  test('reconnect returns existing pane without creating a new WebContentsView', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    const callsAfterFirst = electronMock.WebContentsView.mock.calls.length

    const result = (await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })) as { tabs: { id: string; active: boolean }[] }

    expect(result).toMatchObject({
      tabs: [{ id: 'tab-0', active: true }],
    })

    expect(electronMock.WebContentsView.mock.calls.length).toBe(callsAfterFirst)
  })

  test('applies bounds and destroys the native view', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    handler(BROWSER_PANE_SET_BOUNDS)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      bounds: { x: 1, y: 2, width: 300, height: 200 },
      visible: true,
    })

    expect(electronMock.views[0]?.setBounds).toHaveBeenCalledWith({
      x: 1,
      y: 2,
      width: 300,
      height: 200,
    })

    handler(BROWSER_PANE_DESTROY)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
    })

    expect(electronMock.win.contentView.removeChildView).toHaveBeenCalledWith(
      electronMock.views[0]
    )
    expect(electronMock.views[0]?.webContents.close).toHaveBeenCalledOnce()
  })

  test('tab-0 destroyed after teardown does not emit a spurious empty tabs-changed', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    // Capture tab-0's destroyed handler before teardown clears the record.
    const destroyedHandler = vi
      .mocked(electronMock.views[0]?.webContents.on)
      .mock.calls.find(([eventName]) => eventName === 'destroyed')?.[1] as
      | (() => void)
      | undefined
    expect(destroyedHandler).toBeDefined()

    // Explicit teardown: removeRecord clears record.tabs and deletes the entry.
    handler(BROWSER_PANE_DESTROY)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
    })

    vi.mocked(electronMock.win.webContents.send).mockClear()

    // Chromium delivers `destroyed` AFTER teardown — the handler must be a
    // no-op, not emit a phantom tabs-changed with an empty list.
    destroyedHandler?.()

    expect(electronMock.win.webContents.send).not.toHaveBeenCalledWith(
      BROWSER_PANE_TABS_CHANGED,
      expect.anything()
    )
  })

  test('rejects non-finite native view bounds', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    expect(() =>
      handler(BROWSER_PANE_SET_BOUNDS)(eventForSender(), {
        sessionId: 'pty-1',
        paneId: 'p1',
        bounds: { x: Number.NaN, y: 2, width: 300, height: 200 },
        visible: true,
      })
    ).toThrow('invalid browser pane bounds payload')
  })

  test('CDP list endpoint requires the local capability token', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p2',
      workspaceId: 'proj-1',
      initialUrl: 'https://other.example/',
    })

    const info = (await handler(BROWSER_PANE_CDP_INFO)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
    })) as { url: string; token: string }

    const denied = await fetch(`${info.url}/json/list`)

    expect(denied.status).toBe(401)

    const allowed = await fetch(`${info.url}/json/list?token=${info.token}`)

    expect(allowed.status).toBe(200)

    await expect(allowed.json()).resolves.toEqual([
      expect.objectContaining({
        id: 'pty-1:p1',
        type: 'page',
        url: 'https://example.com/',
      }),
    ])
  })

  test('CDP info requires a registered pane id', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    await expect(
      handler(BROWSER_PANE_CDP_INFO)(eventForSender())
    ).rejects.toThrow('invalid browser pane CDP info payload')

    await expect(
      handler(BROWSER_PANE_CDP_INFO)(eventForSender(), {
        sessionId: 'pty-1',
        paneId: 'p2',
      })
    ).rejects.toThrow('no browser pane registered for CDP')
  })

  test('CDP upgrade rejects malformed encoded page ids without crashing', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    const info = (await handler(BROWSER_PANE_CDP_INFO)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
    })) as { url: string; token: string }

    const response = await requestRawUpgrade(
      `${info.url}/devtools/page/%E0%A4%A?token=${info.token}`
    )

    expect(response).toContain('400 Bad Request')

    const alive = await fetch(`${info.url}/json/list?token=${info.token}`)

    expect(alive.status).toBe(200)
  })

  test('opens window.open requests as docked browser tabs', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    const windowOpenHandler = vi.mocked(
      electronMock.views[0]?.webContents.setWindowOpenHandler
    ).mock.calls[0]?.[0] as
      | ((details: { url: string; disposition: string }) => {
          action: string
        })
      | undefined

    if (windowOpenHandler === undefined) {
      throw new Error('missing window open handler')
    }

    const response = windowOpenHandler({
      url: 'https://accounts.google.com/',
      disposition: 'foreground-tab',
    })

    expect(response.action).toBe('deny')
    expect(electronMock.win.contentView.addChildView).toHaveBeenCalledWith(
      electronMock.views[1]
    )

    handler(BROWSER_PANE_SET_BOUNDS)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      bounds: { x: 1, y: 2, width: 300, height: 200 },
      visible: true,
    })

    expect(electronMock.views[1]?.setBounds).toHaveBeenLastCalledWith({
      x: 1,
      y: 2,
      width: 300,
      height: 200,
    })

    handler(BROWSER_PANE_ACTIVATE_TAB)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      tabId: 'tab-0',
    })

    expect(electronMock.views[0]?.setBounds).toHaveBeenLastCalledWith({
      x: 1,
      y: 2,
      width: 300,
      height: 200,
    })

    expect(electronMock.views[1]?.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    })

    handler(BROWSER_PANE_CLOSE_TAB)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      tabId: 'tab-1',
    })

    expect(electronMock.win.contentView.removeChildView).toHaveBeenCalledWith(
      electronMock.views[1]
    )
    expect(electronMock.views[1]?.webContents.close).toHaveBeenCalledOnce()
  })

  test('permission handlers allow mediaKeySystem, storage-access, and top-level-storage-access only', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    const requestHandler = electronMock.fakeSession.setPermissionRequestHandler
      .mock.calls[0][0] as
      | ((
          wc: unknown,
          permission: string,
          callback: (allow: boolean) => void
        ) => void)
      | undefined

    const checkHandler = electronMock.fakeSession.setPermissionCheckHandler.mock
      .calls[0][0] as ((wc: unknown, permission: string) => boolean) | undefined

    const allowedPermissions = [
      'mediaKeySystem',
      'storage-access',
      'top-level-storage-access',
    ]
    const deniedPermissions = ['media', 'geolocation', 'notifications']

    if (requestHandler === undefined) {
      throw new Error('missing permission request handler')
    }

    if (checkHandler === undefined) {
      throw new Error('missing permission check handler')
    }

    for (const permission of allowedPermissions) {
      const requestCallback = vi.fn()
      requestHandler({}, permission, requestCallback)
      expect(requestCallback).toHaveBeenCalledWith(true)

      expect(checkHandler({}, permission)).toBe(true)
    }

    for (const permission of deniedPermissions) {
      const requestCallback = vi.fn()
      requestHandler({}, permission, requestCallback)
      expect(requestCallback).toHaveBeenCalledWith(false)

      expect(checkHandler({}, permission)).toBe(false)
    }
  })

  test('selects the single WebAuthn account or falls back to null for multiple', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    const webAuthnHandler = electronMock.fakeSession.on.mock.calls.find(
      (c) => c[0] === 'select-webauthn-account'
    )?.[1] as
      | ((
          event: unknown,
          details: { accounts: { credentialId: string }[] },
          callback: (credentialId: string | null) => void
        ) => void)
      | undefined

    if (webAuthnHandler === undefined) {
      throw new Error('missing WebAuthn account handler')
    }

    const callbackOne = vi.fn()
    webAuthnHandler({}, { accounts: [{ credentialId: 'cred-1' }] }, callbackOne)
    expect(callbackOne).toHaveBeenCalledWith('cred-1')

    const callbackTwo = vi.fn()
    webAuthnHandler(
      {},
      {
        accounts: [{ credentialId: 'cred-1' }, { credentialId: 'cred-2' }],
      },
      callbackTwo
    )
    expect(callbackTwo).toHaveBeenCalledWith(null)
  })

  test('does not suppress digit shortcuts unless they target another pane', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
      shortcutContext: { paneIds: ['p1'], activePaneId: 'p1' },
    })

    const beforeInputHandler = vi
      .mocked(electronMock.views[0]?.webContents.on)
      .mock.calls.find(([eventName]) => eventName === 'before-input-event')?.[1]

    if (beforeInputHandler === undefined) {
      throw new Error('missing before-input-event handler')
    }

    const preventActivePaneDefault = vi.fn()
    beforeInputHandler(
      { preventDefault: preventActivePaneDefault },
      {
        type: 'keyDown',
        key: '1',
        code: 'Digit1',
        ...platformShortcutModifier(),
        alt: false,
      }
    )

    const preventOutOfRangeDefault = vi.fn()
    beforeInputHandler(
      { preventDefault: preventOutOfRangeDefault },
      {
        type: 'keyDown',
        key: '2',
        code: 'Digit2',
        ...platformShortcutModifier(),
        alt: false,
      }
    )

    expect(preventActivePaneDefault).not.toHaveBeenCalled()
    expect(preventOutOfRangeDefault).not.toHaveBeenCalled()
    expect(
      electronMock.win.webContents.executeJavaScript
    ).not.toHaveBeenCalled()

    handler(BROWSER_PANE_SET_BOUNDS)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      bounds: { x: 0, y: 0, width: 640, height: 360 },
      visible: true,
      shortcutContext: { paneIds: ['p1', 'p2'], activePaneId: 'p1' },
    })

    const preventSwitchDefault = vi.fn()
    beforeInputHandler(
      { preventDefault: preventSwitchDefault },
      {
        type: 'keyDown',
        key: '2',
        code: 'Digit2',
        ...platformShortcutModifier(),
        alt: false,
      }
    )

    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(preventSwitchDefault).toHaveBeenCalledOnce()
    expect(
      electronMock.win.webContents.executeJavaScript
    ).toHaveBeenCalledOnce()
  })

  test('refocuses the native pane when a forwarded shortcut leaves it active', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    vi.mocked(electronMock.win.webContents.executeJavaScript).mockResolvedValue(
      true
    )

    const beforeInputHandler = vi
      .mocked(electronMock.views[0]?.webContents.on)
      .mock.calls.find(([eventName]) => eventName === 'before-input-event')?.[1]

    if (beforeInputHandler === undefined) {
      throw new Error('missing before-input-event handler')
    }

    beforeInputHandler(
      { preventDefault: vi.fn() },
      {
        type: 'keyDown',
        key: '\\',
        code: 'Backslash',
        ...platformShortcutModifier(),
        alt: false,
      }
    )

    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    const forwardedScript = vi.mocked(
      electronMock.win.webContents.executeJavaScript
    ).mock.calls[0]?.[0]

    expect(forwardedScript).toContain('data-browser-session-id')
    expect(electronMock.win.webContents.focus).toHaveBeenCalled()
    expect(electronMock.views[0]?.webContents.focus).toHaveBeenCalled()
  })

  test('does not refocus the native pane after a forwarded dock shortcut', async () => {
    await handler(BROWSER_PANE_CREATE)(eventForSender(), {
      sessionId: 'pty-1',
      paneId: 'p1',
      workspaceId: 'proj-1',
      initialUrl: 'https://example.com/',
    })

    vi.mocked(electronMock.win.webContents.executeJavaScript).mockResolvedValue(
      true
    )

    const beforeInputHandler = vi
      .mocked(electronMock.views[0]?.webContents.on)
      .mock.calls.find(([eventName]) => eventName === 'before-input-event')?.[1]

    if (beforeInputHandler === undefined) {
      throw new Error('missing before-input-event handler')
    }

    beforeInputHandler(
      { preventDefault: vi.fn() },
      {
        type: 'keyDown',
        key: 'e',
        code: 'KeyE',
        ...platformShortcutModifier(),
        alt: false,
      }
    )

    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(electronMock.win.webContents.executeJavaScript).toHaveBeenCalled()
    expect(electronMock.views[0]?.webContents.focus).not.toHaveBeenCalled()
  })
})
