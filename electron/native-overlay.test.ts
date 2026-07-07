import { beforeEach, describe, expect, test, vi } from 'vitest'
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
  NATIVE_OVERLAY_RESUME,
} from './native-overlay-channels'
import { COMMAND_PALETTE_TOGGLE } from './ipc-channels'
import { NativeOverlayController } from './native-overlay'

type IpcHandler = (
  event: { sender: FakeWebContents },
  payload: unknown
) => unknown
type EventHandler = (...args: unknown[]) => void

interface FakeBounds {
  x: number
  y: number
  width: number
  height: number
}

interface FakeWebContents {
  id: number
  send: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  executeJavaScript: ReturnType<typeof vi.fn>
  setWindowOpenHandler: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
  once: (event: string, handler: EventHandler) => void
  emit: (event: string, ...args: unknown[]) => void
  reset: () => void
}

interface FakeWindow {
  id: number
  webContents: FakeWebContents
  getContentBounds: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  setAlwaysOnTop: ReturnType<typeof vi.fn>
  setIgnoreMouseEvents: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  showInactive: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  moveTop: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
  isFocused: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
  emit: (event: string) => void
  reset: () => void
}

const electronMock = vi.hoisted(() => {
  const createWebContents = (id: number): FakeWebContents => {
    const onceHandlers = new Map<string, EventHandler[]>()
    const handlersByEvent = new Map<string, EventHandler[]>()

    return {
      id,
      send: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      executeJavaScript: vi.fn(() => Promise.resolve(undefined)),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, handler: EventHandler): void => {
        handlersByEvent.set(event, [
          ...(handlersByEvent.get(event) ?? []),
          handler,
        ])
      }),
      removeListener: vi.fn((event: string, handler: EventHandler): void => {
        handlersByEvent.set(
          event,
          (handlersByEvent.get(event) ?? []).filter(
            (candidate) => candidate !== handler
          )
        )
      }),
      once: (event, handler): void => {
        onceHandlers.set(event, [...(onceHandlers.get(event) ?? []), handler])
      },
      emit: (event, ...args): void => {
        const persistentHandlersForEvent = handlersByEvent.get(event) ?? []
        persistentHandlersForEvent.forEach((handler) => handler(...args))
        const handlersForEvent = onceHandlers.get(event) ?? []
        onceHandlers.delete(event)
        handlersForEvent.forEach((handler) => handler(...args))
      },
      reset: (): void => {
        handlersByEvent.clear()
        onceHandlers.clear()
      },
    }
  }

  const createWindowRecord = (
    id: number,
    webContentsId: number
  ): FakeWindow => {
    const handlersByEvent = new Map<string, EventHandler[]>()
    const webContents = createWebContents(webContentsId)
    let destroyed = false

    return {
      id,
      webContents,
      getContentBounds: vi.fn(
        (): FakeBounds => ({ x: 5, y: 6, width: 700, height: 500 })
      ),
      setBounds: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      show: vi.fn(),
      showInactive: vi.fn(),
      hide: vi.fn(),
      moveTop: vi.fn(),
      close: vi.fn((): void => {
        destroyed = true
      }),
      loadURL: vi.fn(() => Promise.resolve(undefined)),
      on: vi.fn((event: string, handler: EventHandler): void => {
        handlersByEvent.set(event, [
          ...(handlersByEvent.get(event) ?? []),
          handler,
        ])
      }),
      removeListener: vi.fn((event: string, handler: EventHandler): void => {
        handlersByEvent.set(
          event,
          (handlersByEvent.get(event) ?? []).filter(
            (candidate) => candidate !== handler
          )
        )
      }),
      isFocused: vi.fn((): boolean => false),
      isDestroyed: (): boolean => destroyed,
      emit: (event: string): void => {
        const handlersForEvent = handlersByEvent.get(event) ?? []
        handlersForEvent.forEach((handler) => handler())
      },
      reset(): void {
        destroyed = false
        handlersByEvent.clear()
        webContents.send.mockClear()
        webContents.focus.mockClear()
        webContents.isDestroyed.mockClear()
        webContents.executeJavaScript.mockClear()
        webContents.setWindowOpenHandler.mockClear()
        webContents.on.mockClear()
        webContents.removeListener.mockClear()
        webContents.reset()
        this.getContentBounds.mockClear()
        this.setBounds.mockClear()
        this.setAlwaysOnTop.mockClear()
        this.setIgnoreMouseEvents.mockClear()
        this.show.mockClear()
        this.showInactive.mockClear()
        this.hide.mockClear()
        this.moveTop.mockClear()
        this.close.mockClear()
        this.loadURL.mockClear()
        this.on.mockClear()
        this.removeListener.mockClear()
        this.isFocused.mockClear()
      },
    } as FakeWindow
  }

  const handlers = new Map<string, IpcHandler>()
  const overlayWindows: FakeWindow[] = []

  const owner = createWindowRecord(1, 10)
  let nextWebContentsId = 20

  const BrowserWindow = Object.assign(
    vi.fn(function createBrowserWindow(): FakeWindow {
      const overlayWindow = createWindowRecord(
        overlayWindows.length + 2,
        nextWebContentsId
      )
      nextWebContentsId += 1
      overlayWindows.push(overlayWindow)

      return overlayWindow
    }),
    {
      fromWebContents: vi.fn((webContents: FakeWebContents) =>
        webContents === owner.webContents ? owner : null
      ),
    }
  )

  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler): void => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string): void => {
      handlers.delete(channel)
    }),
  }

  return {
    BrowserWindow,
    handlers,
    ipcMain,
    owner,
    overlayWindows,
    reset(): void {
      overlayWindows.splice(0, overlayWindows.length)
      handlers.clear()
      nextWebContentsId = 20
      owner.reset()
      BrowserWindow.mockClear()
      BrowserWindow.fromWebContents.mockClear()
      ipcMain.handle.mockClear()
      ipcMain.removeHandler.mockClear()
    },
  }
})

vi.mock('electron', () => ({
  BrowserWindow: electronMock.BrowserWindow,
  ipcMain: electronMock.ipcMain,
}))

const request = {
  surfaceId: 'surface-1',
  kind: 'menu',
  anchorRect: { x: 50, y: 60, width: 0, height: 0 },
  placement: 'bottom-start',
  payload: {
    kind: 'menu',
    ariaLabel: 'Terminal actions',
    items: [{ id: 'copy', label: 'Copy', shortcut: '⌘C' }],
  },
} as const

const tooltipRequest = {
  surfaceId: 'tooltip-1',
  kind: 'tooltip',
  anchorRect: { x: 90, y: 100, width: 30, height: 20 },
  placement: 'top',
  payload: {
    kind: 'tooltip',
    text: 'collapse status',
    maxWidth: 320,
  },
} as const

const dialogRequest = {
  surfaceId: 'dialog-1',
  kind: 'dialog',
  anchorRect: { x: 0, y: 0, width: 900, height: 600 },
  placement: 'top',
  payload: {
    kind: 'dialog',
    dialog: 'command-palette',
    ariaLabel: 'Command palette',
    query: ':',
    selectedIndex: 0,
    results: [
      {
        id: 'help',
        label: ':help',
        description: 'Show command reference',
        icon: 'help',
      },
    ],
    actions: {
      selectIndex: 'command-palette:select-index',
      executeIndex: 'command-palette:execute-index',
    },
  },
} as const

const menuOverlayUrl = 'vimeflow://app/index.html?nativeOverlay=menu'
const tooltipOverlayUrl = 'vimeflow://app/index.html?nativeOverlay=tooltip'

const handler = (channel: string): IpcHandler => {
  const registered = electronMock.handlers.get(channel)
  if (!registered) {
    throw new Error(`missing handler ${channel}`)
  }

  return registered
}

const finishOverlayLoad = (index = 0): FakeWindow => {
  const overlayWindow = electronMock.overlayWindows[index]
  overlayWindow.webContents.emit('did-finish-load')

  return overlayWindow
}

const acknowledgeOverlayReady = async (
  overlayWindow: FakeWindow,
  surfaceId: string = request.surfaceId
): Promise<void> => {
  await Promise.resolve()
  handler(NATIVE_OVERLAY_READY)(
    { sender: overlayWindow.webContents },
    { surfaceId }
  )
}

describe('NativeOverlayController', () => {
  let controller: NativeOverlayController

  beforeEach(() => {
    electronMock.reset()
    controller = new NativeOverlayController({
      menuOverlayUrl,
      tooltipOverlayUrl,
      platform: 'darwin',
    })
    controller.register()
  })

  test('opens a transparent overlay BrowserWindow and renders the request', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const overlayWindow = finishOverlayLoad()

    await Promise.resolve()
    expect(overlayWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_RENDER,
      request
    )

    await acknowledgeOverlayReady(overlayWindow)
    await expect(openPromise).resolves.toEqual({ accepted: true })
    expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(2)

    expect(electronMock.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptFirstMouse: true,
        backgroundColor: '#00000000',
        frame: false,
        hasShadow: false,
        focusable: false,
        parent: electronMock.owner,
        show: false,
        skipTaskbar: true,
        transparent: true,
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
          preload: expect.stringContaining('preload.mjs'),
          sandbox: true,
        }),
      })
    )

    expect(electronMock.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptFirstMouse: false,
        focusable: false,
        parent: electronMock.owner,
        transparent: true,
      })
    )

    expect(overlayWindow.setIgnoreMouseEvents).toHaveBeenCalledWith(true)
    expect(overlayWindow.setIgnoreMouseEvents).toHaveBeenCalledWith(false)
    expect(overlayWindow.setAlwaysOnTop).toHaveBeenCalledWith(
      true,
      'screen-saver'
    )
    expect(overlayWindow.moveTop).toHaveBeenCalledOnce()

    expect(
      overlayWindow.webContents.setWindowOpenHandler
    ).toHaveBeenCalledOnce()

    expect(overlayWindow.loadURL).toHaveBeenCalledWith(menuOverlayUrl)
    expect(electronMock.overlayWindows[1]?.loadURL).toHaveBeenCalledWith(
      tooltipOverlayUrl
    )

    expect(overlayWindow.setBounds).toHaveBeenCalledWith({
      x: 5,
      y: 6,
      width: 700,
      height: 500,
    })
    expect(overlayWindow.showInactive).toHaveBeenCalledOnce()
    expect(overlayWindow.webContents.focus).not.toHaveBeenCalled()
  })

  test('opens passive tooltip layer without replacing an active menu', async () => {
    const menuOpenPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const menuWindow = finishOverlayLoad()
    const tooltipWindow = finishOverlayLoad(1)
    await acknowledgeOverlayReady(menuWindow)
    await menuOpenPromise

    menuWindow.webContents.send.mockClear()
    menuWindow.hide.mockClear()
    menuWindow.setIgnoreMouseEvents.mockClear()

    const tooltipOpenPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      tooltipRequest
    )
    await Promise.resolve()

    expect(tooltipWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_RENDER,
      tooltipRequest
    )

    await acknowledgeOverlayReady(tooltipWindow, tooltipRequest.surfaceId)
    await expect(tooltipOpenPromise).resolves.toEqual({ accepted: true })

    expect(menuWindow.webContents.send).not.toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLEAR
    )
    expect(menuWindow.hide).not.toHaveBeenCalled()
    expect(menuWindow.setIgnoreMouseEvents).not.toHaveBeenCalledWith(true)
    expect(tooltipWindow.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true)
    expect(tooltipWindow.webContents.focus).not.toHaveBeenCalled()
    expect(tooltipWindow.setAlwaysOnTop).toHaveBeenCalledWith(
      true,
      'screen-saver'
    )

    handler(NATIVE_OVERLAY_CLOSE)(
      { sender: electronMock.owner.webContents },
      { surfaceId: tooltipRequest.surfaceId, reason: 'renderer' }
    )

    expect(tooltipWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLEAR
    )
    expect(tooltipWindow.hide).toHaveBeenCalledOnce()
    expect(menuWindow.hide).not.toHaveBeenCalled()
  })

  test('closes active tooltip before opening an interactive menu', async () => {
    const tooltipOpenPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      tooltipRequest
    )
    const menuWindow = finishOverlayLoad()
    const tooltipWindow = finishOverlayLoad(1)

    await Promise.resolve()
    await acknowledgeOverlayReady(tooltipWindow, tooltipRequest.surfaceId)
    await tooltipOpenPromise

    tooltipWindow.webContents.send.mockClear()
    tooltipWindow.hide.mockClear()
    electronMock.owner.webContents.send.mockClear()

    const menuOpenPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )

    await Promise.resolve()
    expect(tooltipWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLEAR
    )
    expect(tooltipWindow.hide).toHaveBeenCalledOnce()
    expect(electronMock.owner.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLOSED,
      { surfaceId: tooltipRequest.surfaceId, reason: 'replaced' }
    )

    expect(menuWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_RENDER,
      request
    )

    await acknowledgeOverlayReady(menuWindow)
    await expect(menuOpenPromise).resolves.toEqual({ accepted: true })
  })

  test('settles a pending tooltip open before opening an interactive menu', async () => {
    const tooltipOpenPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      tooltipRequest
    )
    const menuWindow = finishOverlayLoad()
    const tooltipWindow = finishOverlayLoad(1)

    await Promise.resolve()
    expect(tooltipWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_RENDER,
      tooltipRequest
    )

    const menuOpenPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )

    await Promise.resolve()
    await expect(tooltipOpenPromise).resolves.toEqual({
      accepted: false,
      reason: 'render-timeout',
    })

    expect(tooltipWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLEAR
    )
    expect(tooltipWindow.hide).toHaveBeenCalledOnce()
    expect(menuWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_RENDER,
      request
    )

    await acknowledgeOverlayReady(menuWindow)
    await expect(menuOpenPromise).resolves.toEqual({ accepted: true })
  })

  test('updates the active tooltip surface without closing its owner session', async () => {
    const tooltipOpenPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      tooltipRequest
    )
    const tooltipWindow = finishOverlayLoad(1)

    await Promise.resolve()
    await acknowledgeOverlayReady(tooltipWindow, tooltipRequest.surfaceId)
    await tooltipOpenPromise

    const refreshedTooltipRequest = {
      ...tooltipRequest,
      anchorRect: { ...tooltipRequest.anchorRect, width: 32 },
    }

    tooltipWindow.webContents.send.mockClear()
    tooltipWindow.hide.mockClear()
    electronMock.owner.webContents.send.mockClear()

    const refreshPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      refreshedTooltipRequest
    )

    await Promise.resolve()
    expect(tooltipWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_RENDER,
      refreshedTooltipRequest
    )

    await acknowledgeOverlayReady(tooltipWindow, tooltipRequest.surfaceId)
    await expect(refreshPromise).resolves.toEqual({ accepted: true })

    expect(tooltipWindow.webContents.send).not.toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLEAR
    )
    expect(tooltipWindow.hide).not.toHaveBeenCalled()
    expect(electronMock.owner.webContents.send).not.toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLOSED,
      expect.objectContaining({ surfaceId: tooltipRequest.surfaceId })
    )
  })

  test('resolves a pending active tooltip open before refreshing the same surface', async () => {
    const tooltipOpenPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      tooltipRequest
    )
    const tooltipWindow = finishOverlayLoad(1)

    const refreshedTooltipRequest = {
      ...tooltipRequest,
      anchorRect: { ...tooltipRequest.anchorRect, width: 32 },
    }

    await Promise.resolve()
    expect(tooltipWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_RENDER,
      tooltipRequest
    )

    const refreshPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      refreshedTooltipRequest
    )

    await Promise.resolve()
    await expect(tooltipOpenPromise).resolves.toEqual({ accepted: true })
    await expect(refreshPromise).resolves.toEqual({ accepted: true })

    expect(tooltipWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_RENDER,
      refreshedTooltipRequest
    )

    expect(tooltipWindow.webContents.send).not.toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLEAR
    )
    expect(tooltipWindow.hide).not.toHaveBeenCalled()
  })

  test('opens dialog requests on the interactive menu layer', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      dialogRequest
    )
    const menuWindow = finishOverlayLoad()
    finishOverlayLoad(1)

    await Promise.resolve()
    expect(menuWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_RENDER,
      dialogRequest
    )

    await acknowledgeOverlayReady(menuWindow, dialogRequest.surfaceId)
    await expect(openPromise).resolves.toEqual({ accepted: true })
    expect(menuWindow.loadURL).toHaveBeenCalledWith(menuOverlayUrl)
    expect(menuWindow.setIgnoreMouseEvents).toHaveBeenCalledWith(false)
    expect(menuWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
  })

  test('accepts command palette dialog payloads with no results', async () => {
    const emptyResultsRequest = {
      ...dialogRequest,
      surfaceId: 'dialog-empty-results',
      payload: {
        ...dialogRequest.payload,
        query: 'missing',
        selectedIndex: -1,
        results: [],
      },
    } as const

    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      emptyResultsRequest
    )
    const menuWindow = finishOverlayLoad()
    finishOverlayLoad(1)

    await Promise.resolve()
    expect(menuWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_RENDER,
      emptyResultsRequest
    )

    await acknowledgeOverlayReady(menuWindow, emptyResultsRequest.surfaceId)
    await expect(openPromise).resolves.toEqual({ accepted: true })
  })

  test('relays owner menu keydown events to the non-focusable menu layer', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const menuWindow = finishOverlayLoad()
    await acknowledgeOverlayReady(menuWindow)
    await openPromise

    menuWindow.webContents.send.mockClear()
    const event = { preventDefault: vi.fn() }

    electronMock.owner.webContents.emit('before-input-event', event, {
      type: 'keyDown',
      key: 'ArrowDown',
      code: 'ArrowDown',
      isAutoRepeat: true,
      isComposing: false,
      shift: true,
      control: false,
      alt: false,
      meta: false,
      location: 0,
      modifiers: ['shift', 'isAutoRepeat'],
    })

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(menuWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_KEYDOWN,
      {
        surfaceId: request.surfaceId,
        key: 'ArrowDown',
        code: 'ArrowDown',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        repeat: true,
      }
    )
  })

  test('dispatches command palette shortcut instead of menu key forwarding', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const menuWindow = finishOverlayLoad()
    await acknowledgeOverlayReady(menuWindow)
    await openPromise

    menuWindow.webContents.send.mockClear()
    electronMock.owner.webContents.send.mockClear()
    electronMock.owner.webContents.focus.mockClear()
    const event = { preventDefault: vi.fn() }
    const isMac = process.platform === 'darwin'

    electronMock.owner.webContents.emit('before-input-event', event, {
      type: 'keyDown',
      key: ';',
      code: 'Semicolon',
      isAutoRepeat: false,
      isComposing: false,
      shift: false,
      control: !isMac,
      alt: false,
      meta: isMac,
      location: 0,
      modifiers: [],
    })

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(electronMock.owner.webContents.focus).toHaveBeenCalledOnce()
    expect(electronMock.owner.webContents.send).toHaveBeenCalledWith(
      COMMAND_PALETTE_TOGGLE
    )

    expect(menuWindow.webContents.send).not.toHaveBeenCalledWith(
      NATIVE_OVERLAY_KEYDOWN,
      expect.anything()
    )
  })

  test('parent close tears down active menu and tooltip layers together', async () => {
    const menuOpenPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const menuWindow = finishOverlayLoad()
    const tooltipWindow = finishOverlayLoad(1)
    await acknowledgeOverlayReady(menuWindow)
    await menuOpenPromise

    const tooltipOpenPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      tooltipRequest
    )
    await acknowledgeOverlayReady(tooltipWindow, tooltipRequest.surfaceId)
    await tooltipOpenPromise

    electronMock.owner.webContents.focus.mockClear()
    electronMock.owner.emit('close')

    expect(menuWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLEAR
    )

    expect(tooltipWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLEAR
    )
    expect(menuWindow.hide).toHaveBeenCalledOnce()
    expect(tooltipWindow.hide).toHaveBeenCalledOnce()
    expect(menuWindow.close).toHaveBeenCalledOnce()
    expect(tooltipWindow.close).toHaveBeenCalledOnce()
    expect(electronMock.owner.webContents.focus).not.toHaveBeenCalled()
  })

  test('accepts sectioned menu payloads with composite rows', async () => {
    const sectionRequest = {
      surfaceId: 'surface-2',
      kind: 'menu',
      anchorRect: { x: 1080, y: 12, width: 24, height: 20 },
      placement: 'bottom-end',
      payload: {
        kind: 'menu',
        ariaLabel: 'Displayed layouts',
        sections: [
          {
            label: 'Displayed layouts',
            items: [
              {
                type: 'checkbox',
                id: 'layout-single',
                label: 'Single',
                checked: true,
                disabled: true,
              },
              { type: 'separator' },
              {
                id: 'layout-custom',
                label: 'Create custom layout',
                icon: 'dashboard_customize',
              },
              {
                type: 'composite',
                id: 'custom-main-bottom',
                label: 'Main + bottom',
                icon: 'dashboard',
                active: true,
                actions: [
                  {
                    id: 'duplicate-main-bottom',
                    label: 'Duplicate Main + bottom',
                    icon: 'content_copy',
                  },
                ],
              },
            ],
          },
        ],
      },
    } as const

    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      sectionRequest
    )
    const overlayWindow = finishOverlayLoad()

    await Promise.resolve()
    expect(overlayWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_RENDER,
      sectionRequest
    )

    handler(NATIVE_OVERLAY_READY)(
      { sender: overlayWindow.webContents },
      { surfaceId: sectionRequest.surfaceId }
    )

    await expect(openPromise).resolves.toEqual({ accepted: true })
  })

  test('accepts themed menu payloads for the overlay renderer', async () => {
    const themedRequest = {
      ...request,
      surfaceId: 'surface-themed',
      payload: {
        ...request.payload,
        surfaceTone: 'primary-container-soft',
      },
      theme: {
        id: 'flexoki',
        colorScheme: 'light',
        variables: {
          '--color-surface-container-high': 'var(--color-test-surface-high)',
          '--shadow-menu': 'var(--shadow-test-menu)',
        },
      },
    } as const

    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      themedRequest
    )
    const overlayWindow = finishOverlayLoad()

    await Promise.resolve()
    expect(overlayWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_RENDER,
      themedRequest
    )

    await acknowledgeOverlayReady(overlayWindow, themedRequest.surfaceId)
    await expect(openPromise).resolves.toEqual({ accepted: true })
  })

  test('rejects oversized overlay payload collections before rendering', async () => {
    const oversizedRequest = {
      ...request,
      payload: {
        kind: 'menu',
        items: Array.from({ length: 201 }, (_value, index) => ({
          id: `item-${index}`,
          label: `Item ${index}`,
        })),
      },
    }

    await expect(
      handler(NATIVE_OVERLAY_OPEN)(
        { sender: electronMock.owner.webContents },
        oversizedRequest
      )
    ).resolves.toEqual({ accepted: false, reason: 'invalid-payload' })
    expect(electronMock.BrowserWindow).not.toHaveBeenCalled()
  })

  test('rejects oversized optional menu collections even with valid items', async () => {
    const oversizedRequest = {
      ...request,
      payload: {
        kind: 'menu',
        items: [{ id: 'copy', label: 'Copy' }],
        sections: Array.from({ length: 51 }, (_value, index) => ({
          label: `Section ${index}`,
          items: [{ id: `item-${index}`, label: `Item ${index}` }],
        })),
      },
    }

    await expect(
      handler(NATIVE_OVERLAY_OPEN)(
        { sender: electronMock.owner.webContents },
        oversizedRequest
      )
    ).resolves.toEqual({ accepted: false, reason: 'invalid-payload' })
    expect(electronMock.BrowserWindow).not.toHaveBeenCalled()
  })

  test('rejects oversized theme variable records before rendering', async () => {
    const oversizedThemeRequest = {
      ...request,
      theme: {
        variables: Object.fromEntries(
          Array.from({ length: 513 }, (_value, index) => [
            `--color-${index}`,
            '#000000',
          ])
        ),
      },
    }

    await expect(
      handler(NATIVE_OVERLAY_OPEN)(
        { sender: electronMock.owner.webContents },
        oversizedThemeRequest
      )
    ).resolves.toEqual({ accepted: false, reason: 'invalid-payload' })
    expect(electronMock.BrowserWindow).not.toHaveBeenCalled()
  })

  test('falls back locally and hides the overlay window when render is never acknowledged', async () => {
    vi.useFakeTimers()
    try {
      const openPromise = handler(NATIVE_OVERLAY_OPEN)(
        { sender: electronMock.owner.webContents },
        request
      )
      const overlayWindow = finishOverlayLoad()
      await Promise.resolve()

      expect(overlayWindow.webContents.send).toHaveBeenCalledWith(
        NATIVE_OVERLAY_RENDER,
        request
      )

      await vi.advanceTimersByTimeAsync(1000)

      await expect(openPromise).resolves.toEqual({
        accepted: false,
        reason: 'render-timeout',
      })
      expect(overlayWindow.hide).toHaveBeenCalledOnce()
      expect(overlayWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(false)
      expect(overlayWindow.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true)
    } finally {
      vi.useRealTimers()
    }
  })

  test('accepts ready when the overlay acknowledges during render delivery', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const overlayWindow = electronMock.overlayWindows[0]
    overlayWindow.webContents.send.mockImplementationOnce(
      (channel: string): void => {
        expect(channel).toBe(NATIVE_OVERLAY_RENDER)
        handler(NATIVE_OVERLAY_READY)(
          { sender: overlayWindow.webContents },
          { surfaceId: request.surfaceId }
        )
      }
    )

    overlayWindow.webContents.emit('did-finish-load')

    await expect(openPromise).resolves.toEqual({ accepted: true })
    expect(overlayWindow.showInactive).toHaveBeenCalledOnce()
    expect(overlayWindow.webContents.focus).not.toHaveBeenCalled()
  })

  test('does not hide a newer active overlay when an older render times out', async () => {
    vi.useFakeTimers()
    try {
      const nextRequest = {
        ...request,
        surfaceId: 'surface-2',
      }

      const firstOpenPromise = handler(NATIVE_OVERLAY_OPEN)(
        { sender: electronMock.owner.webContents },
        request
      )

      const secondOpenPromise = handler(NATIVE_OVERLAY_OPEN)(
        { sender: electronMock.owner.webContents },
        nextRequest
      )
      const overlayWindow = finishOverlayLoad()

      await Promise.resolve()
      expect(overlayWindow.webContents.send).toHaveBeenCalledWith(
        NATIVE_OVERLAY_RENDER,
        request
      )

      expect(overlayWindow.webContents.send).toHaveBeenCalledWith(
        NATIVE_OVERLAY_RENDER,
        nextRequest
      )

      handler(NATIVE_OVERLAY_READY)(
        { sender: overlayWindow.webContents },
        { surfaceId: nextRequest.surfaceId }
      )

      await expect(secondOpenPromise).resolves.toEqual({ accepted: true })

      overlayWindow.hide.mockClear()
      overlayWindow.setAlwaysOnTop.mockClear()
      overlayWindow.setIgnoreMouseEvents.mockClear()
      overlayWindow.webContents.send.mockClear()

      await vi.advanceTimersByTimeAsync(1000)

      await expect(firstOpenPromise).resolves.toEqual({
        accepted: false,
        reason: 'render-timeout',
      })
      expect(overlayWindow.hide).not.toHaveBeenCalled()
      expect(overlayWindow.setAlwaysOnTop).not.toHaveBeenCalledWith(false)
      expect(overlayWindow.setIgnoreMouseEvents).not.toHaveBeenCalledWith(true)
      expect(overlayWindow.webContents.send).not.toHaveBeenCalledWith(
        NATIVE_OVERLAY_CLEAR
      )
      expect(electronMock.owner.webContents.focus).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  test('syncs bounds when the parent moves or resizes', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const overlayWindow = finishOverlayLoad()
    await acknowledgeOverlayReady(overlayWindow)
    await openPromise
    overlayWindow.setBounds.mockClear()

    electronMock.owner.emit('resize')
    electronMock.owner.emit('move')

    expect(overlayWindow.setBounds).toHaveBeenCalledTimes(2)
    expect(overlayWindow.setBounds).toHaveBeenCalledWith({
      x: 5,
      y: 6,
      width: 700,
      height: 500,
    })
  })

  test('outside close hides the overlay and notifies the owner renderer', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const overlayWindow = finishOverlayLoad()
    await acknowledgeOverlayReady(overlayWindow)
    await openPromise

    handler(NATIVE_OVERLAY_CLOSE)(
      { sender: overlayWindow.webContents },
      { surfaceId: request.surfaceId, reason: 'outside' }
    )

    expect(overlayWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLEAR
    )
    expect(overlayWindow.hide).toHaveBeenCalledOnce()
    expect(overlayWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(false)
    expect(overlayWindow.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true)
    expect(electronMock.owner.webContents.focus).toHaveBeenCalledOnce()
    expect(electronMock.owner.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLOSED,
      { surfaceId: request.surfaceId, reason: 'outside' }
    )
  })

  test('owner close hides the overlay without notifying the owner renderer', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const overlayWindow = finishOverlayLoad()
    await acknowledgeOverlayReady(overlayWindow)
    await openPromise

    handler(NATIVE_OVERLAY_CLOSE)(
      { sender: electronMock.owner.webContents },
      { surfaceId: request.surfaceId, reason: 'renderer' }
    )

    expect(overlayWindow.hide).toHaveBeenCalledOnce()
    expect(electronMock.owner.webContents.send).not.toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLOSED,
      expect.anything()
    )
  })

  test('owner close without reason defaults to renderer close without notifying the owner renderer', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const overlayWindow = finishOverlayLoad()
    await acknowledgeOverlayReady(overlayWindow)
    await openPromise

    handler(NATIVE_OVERLAY_CLOSE)(
      { sender: electronMock.owner.webContents },
      { surfaceId: request.surfaceId }
    )

    expect(overlayWindow.hide).toHaveBeenCalledOnce()
    expect(electronMock.owner.webContents.send).not.toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLOSED,
      expect.anything()
    )
  })

  test.each(['blur', 'hide', 'minimize'])(
    'parent window %s dismisses the overlay without refocusing the owner',
    async (eventName) => {
      const openPromise = handler(NATIVE_OVERLAY_OPEN)(
        { sender: electronMock.owner.webContents },
        request
      )
      const overlayWindow = finishOverlayLoad()
      await acknowledgeOverlayReady(overlayWindow)
      await openPromise

      electronMock.owner.webContents.focus.mockClear()
      electronMock.owner.emit(eventName)

      expect(overlayWindow.webContents.send).toHaveBeenCalledWith(
        NATIVE_OVERLAY_CLEAR
      )
      expect(overlayWindow.hide).toHaveBeenCalledOnce()
      expect(overlayWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(false)
      expect(overlayWindow.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true)
      expect(electronMock.owner.webContents.focus).not.toHaveBeenCalled()
      expect(electronMock.owner.webContents.send).toHaveBeenCalledWith(
        NATIVE_OVERLAY_CLOSED,
        { surfaceId: request.surfaceId, reason: 'outside' }
      )
    }
  )

  test('parent window close tears down the overlay before it can stand alone', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const overlayWindow = finishOverlayLoad()
    await acknowledgeOverlayReady(overlayWindow)
    await openPromise

    electronMock.owner.webContents.focus.mockClear()
    electronMock.owner.emit('close')

    expect(overlayWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLEAR
    )
    expect(overlayWindow.hide).toHaveBeenCalledOnce()
    expect(overlayWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(false)
    expect(overlayWindow.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true)
    expect(overlayWindow.close).toHaveBeenCalledOnce()
    expect(electronMock.owner.webContents.focus).not.toHaveBeenCalled()
    expect(electronMock.owner.removeListener).toHaveBeenCalledWith(
      'close',
      expect.any(Function)
    )

    expect(electronMock.owner.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLOSED,
      { surfaceId: request.surfaceId, reason: 'owner-closed' }
    )
  })

  test('close after overlay window destruction updates owner without calling destroyed window methods', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const overlayWindow = finishOverlayLoad()
    await acknowledgeOverlayReady(overlayWindow)
    await openPromise

    overlayWindow.close()
    overlayWindow.webContents.send.mockClear()
    overlayWindow.hide.mockClear()
    overlayWindow.setAlwaysOnTop.mockClear()
    overlayWindow.setIgnoreMouseEvents.mockClear()

    expect(() =>
      handler(NATIVE_OVERLAY_CLOSE)(
        { sender: electronMock.owner.webContents },
        { surfaceId: request.surfaceId, reason: 'outside' }
      )
    ).not.toThrow()

    expect(overlayWindow.webContents.send).not.toHaveBeenCalled()
    expect(overlayWindow.hide).not.toHaveBeenCalled()
    expect(overlayWindow.setAlwaysOnTop).not.toHaveBeenCalled()
    expect(overlayWindow.setIgnoreMouseEvents).not.toHaveBeenCalled()
    expect(electronMock.owner.webContents.focus).toHaveBeenCalledOnce()
    expect(electronMock.owner.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLOSED,
      { surfaceId: request.surfaceId, reason: 'outside' }
    )
  })

  test('rejects close requests from unrelated renderers', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const overlayWindow = finishOverlayLoad()
    await acknowledgeOverlayReady(overlayWindow)
    await openPromise

    const unrelated = {
      ...electronMock.owner.webContents,
      id: 999,
      send: vi.fn(),
      focus: vi.fn(),
    }

    handler(NATIVE_OVERLAY_CLOSE)(
      { sender: unrelated },
      { surfaceId: request.surfaceId, reason: 'outside' }
    )

    expect(overlayWindow.hide).not.toHaveBeenCalled()
    expect(overlayWindow.webContents.send).not.toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLEAR
    )

    expect(electronMock.owner.webContents.send).not.toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLOSED,
      expect.anything()
    )
  })

  test('action closes the overlay and forwards the action once', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const overlayWindow = finishOverlayLoad()
    await acknowledgeOverlayReady(overlayWindow)
    await openPromise

    handler(NATIVE_OVERLAY_ACTION)(
      { sender: overlayWindow.webContents },
      { surfaceId: request.surfaceId, actionId: 'copy' }
    )

    handler(NATIVE_OVERLAY_ACTION)(
      { sender: overlayWindow.webContents },
      { surfaceId: request.surfaceId, actionId: 'copy' }
    )

    expect(overlayWindow.hide).toHaveBeenCalledOnce()
    expect(overlayWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(false)
    expect(electronMock.owner.webContents.send).toHaveBeenCalledOnce()
    expect(electronMock.owner.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_ACTION,
      { surfaceId: request.surfaceId, actionId: 'copy' }
    )
  })

  test('action can keep the overlay open for copy feedback', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const overlayWindow = finishOverlayLoad()
    await acknowledgeOverlayReady(overlayWindow)
    await openPromise

    handler(NATIVE_OVERLAY_ACTION)(
      { sender: overlayWindow.webContents },
      {
        surfaceId: request.surfaceId,
        actionId: 'copy',
        closeOnSelect: false,
        feedback: 'copy',
      }
    )

    handler(NATIVE_OVERLAY_ACTION)(
      { sender: overlayWindow.webContents },
      {
        surfaceId: request.surfaceId,
        actionId: 'copy',
        closeOnSelect: false,
        feedback: 'copy',
      }
    )

    expect(overlayWindow.hide).not.toHaveBeenCalled()
    expect(overlayWindow.webContents.send).not.toHaveBeenCalledWith(
      NATIVE_OVERLAY_CLEAR
    )

    expect(electronMock.owner.webContents.send).toHaveBeenCalledTimes(2)
    expect(electronMock.owner.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_ACTION,
      {
        surfaceId: request.surfaceId,
        actionId: 'copy',
        closeOnSelect: false,
        feedback: 'copy',
      }
    )

    const result = {
      surfaceId: request.surfaceId,
      actionId: 'copy',
      feedback: 'copy',
      ok: true,
    } as const

    handler(NATIVE_OVERLAY_ACTION_RESULT)(
      { sender: overlayWindow.webContents },
      result
    )

    expect(overlayWindow.webContents.send).not.toHaveBeenCalledWith(
      NATIVE_OVERLAY_ACTION_RESULT,
      result
    )

    handler(NATIVE_OVERLAY_ACTION_RESULT)(
      { sender: electronMock.owner.webContents },
      result
    )

    expect(overlayWindow.webContents.send).toHaveBeenCalledWith(
      NATIVE_OVERLAY_ACTION_RESULT,
      result
    )
  })

  test('action can suspend and resume an interactive overlay for native modal work', async () => {
    const openPromise = handler(NATIVE_OVERLAY_OPEN)(
      { sender: electronMock.owner.webContents },
      request
    )
    const overlayWindow = finishOverlayLoad()
    await acknowledgeOverlayReady(overlayWindow)
    await openPromise

    overlayWindow.setAlwaysOnTop.mockClear()
    overlayWindow.setIgnoreMouseEvents.mockClear()
    overlayWindow.showInactive.mockClear()
    overlayWindow.moveTop.mockClear()
    overlayWindow.hide.mockClear()
    overlayWindow.webContents.executeJavaScript.mockClear()

    handler(NATIVE_OVERLAY_ACTION)(
      { sender: overlayWindow.webContents },
      {
        surfaceId: request.surfaceId,
        actionId: 'browse',
        closeOnSelect: false,
        suspendOnSelect: true,
      }
    )

    expect(overlayWindow.hide).not.toHaveBeenCalled()
    expect(overlayWindow.webContents.executeJavaScript).toHaveBeenCalledOnce()
    expect(overlayWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(false)
    expect(overlayWindow.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true)

    handler(NATIVE_OVERLAY_RESUME)(
      { sender: electronMock.owner.webContents },
      { surfaceId: request.surfaceId }
    )

    expect(overlayWindow.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false)
    expect(overlayWindow.showInactive).toHaveBeenCalledOnce()
    expect(overlayWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(
      true,
      'screen-saver'
    )
    expect(overlayWindow.moveTop).toHaveBeenCalledOnce()
    expect(overlayWindow.webContents.executeJavaScript).toHaveBeenCalledTimes(2)
  })

  test('rejects native overlay on non-macOS platforms', async () => {
    controller.unregister()
    controller = new NativeOverlayController({
      menuOverlayUrl,
      tooltipOverlayUrl,
      platform: 'linux',
    })
    controller.register()

    await expect(
      handler(NATIVE_OVERLAY_OPEN)(
        { sender: electronMock.owner.webContents },
        request
      )
    ).resolves.toEqual({
      accepted: false,
      reason: 'unsupported-platform',
    })
    expect(electronMock.BrowserWindow).not.toHaveBeenCalled()
  })
})
