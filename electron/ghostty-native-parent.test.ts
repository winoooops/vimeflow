// cspell:ignore ghostty Ghostty GHOSTTY
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  GHOSTTY_NATIVE_DATA,
  GHOSTTY_NATIVE_DESTROY,
  GHOSTTY_NATIVE_FOCUS,
  GHOSTTY_NATIVE_SECONDARY_ATTACH,
  GHOSTTY_NATIVE_SECONDARY_DATA,
  GHOSTTY_NATIVE_SECONDARY_REMOVE,
  GHOSTTY_NATIVE_SECONDARY_VISIBLE,
  GHOSTTY_NATIVE_UPDATE,
} from './ghostty-native-channels'
import { BACKEND_EVENT, COMMAND_PALETTE_TOGGLE } from './ipc-channels'
import type { Sidecar } from './sidecar'
import {
  isGhosttyNativeParentEnabled,
  setupGhosttyNativeParent,
} from './ghostty-native-parent'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const nativeHandle = Buffer.alloc(8)
nativeHandle.writeBigUInt64LE(1n)

const {
  existsSync,
  browserWindowState,
  browserWindowOnce,
  isDestroyed,
  webContentsExecuteJavaScript,
  webContentsFocus,
  webContentsIsDestroyed,
  webContentsSend,
} = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  browserWindowState: { id: 1 },
  browserWindowOnce: vi.fn(),
  isDestroyed: vi.fn(() => false),
  webContentsExecuteJavaScript: vi.fn(
    (script: string, gesture?: boolean): Promise<unknown> => {
      void script
      void gesture

      return Promise.resolve(false)
    }
  ),
  webContentsFocus: vi.fn(),
  webContentsIsDestroyed: vi.fn(() => false),
  webContentsSend: vi.fn(),
}))

vi.mock('node:fs', () => ({
  default: { existsSync },
  existsSync,
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => ({
      id: browserWindowState.id,
      getNativeWindowHandle: (): Buffer => nativeHandle,
      isDestroyed,
      once: browserWindowOnce,
      webContents: {
        executeJavaScript: webContentsExecuteJavaScript,
        focus: webContentsFocus,
        isDestroyed: webContentsIsDestroyed,
        send: webContentsSend,
      },
    })),
  },
  ipcMain: {
    handle: vi.fn(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }
    ),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
  },
}))

describe('ghostty native parent', () => {
  beforeEach(() => {
    handlers.clear()
    existsSync.mockReset()
    existsSync.mockReturnValue(false)
    browserWindowState.id = 1
    browserWindowOnce.mockClear()
    isDestroyed.mockReset()
    isDestroyed.mockReturnValue(false)
    webContentsExecuteJavaScript.mockReset()
    webContentsExecuteJavaScript.mockResolvedValue(false)
    webContentsFocus.mockClear()
    webContentsIsDestroyed.mockReset()
    webContentsIsDestroyed.mockReturnValue(false)
    webContentsSend.mockClear()
  })

  test('enables on macOS when packaged or when the parent feature flag is set', () => {
    expect(
      isGhosttyNativeParentEnabled('darwin', {
        VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1',
      })
    ).toBe(true)

    expect(
      isGhosttyNativeParentEnabled('linux', {
        VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1',
      })
    ).toBe(false)
    expect(isGhosttyNativeParentEnabled('darwin', {}, true)).toBe(true)
    expect(isGhosttyNativeParentEnabled('linux', {}, true)).toBe(false)
    expect(isGhosttyNativeParentEnabled('darwin', {})).toBe(false)
  })

  test('rejects invalid native data payload', () => {
    const addon = {
      create: vi.fn(),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })
    const data = handlers.get(GHOSTTY_NATIVE_DATA)

    expect(() => data?.({}, { sessionId: 'pty-1', paneId: 'pane-1' })).toThrow(
      'invalid ghostty native parent data payload'
    )
  })

  test('rejects invalid native update background color', () => {
    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon: {
        create: vi.fn(),
        setFrame: vi.fn(),
        setFontFamily: vi.fn(),
        write: vi.fn(),
        focus: vi.fn(),
        destroy: vi.fn(),
      },
    })

    expect(() =>
      handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
        { sender: {} },
        {
          sessionId: 'pty-1',
          paneId: 'pane-1',
          cwd: '/tmp',
          backgroundColor: 'not-a-color',
          visible: true,
          parentHeight: 900,
          bounds: { x: 10, y: 20, width: 300, height: 200 },
        }
      )
    ).toThrow('invalid ghostty native parent update payload')
  })

  test('rejects invalid native update foreground color', () => {
    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon: {
        create: vi.fn(),
        setFrame: vi.fn(),
        setFontFamily: vi.fn(),
        write: vi.fn(),
        focus: vi.fn(),
        destroy: vi.fn(),
      },
    })

    expect(() =>
      handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
        { sender: {} },
        {
          sessionId: 'pty-1',
          paneId: 'pane-1',
          cwd: '/tmp',
          foregroundColor: 'not-a-color',
          visible: true,
          parentHeight: 900,
          bounds: { x: 10, y: 20, width: 300, height: 200 },
        }
      )
    ).toThrow('invalid ghostty native parent update payload')
  })

  test('returns disabled instead of throwing when addon artifacts are missing', () => {
    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
    })

    expect(
      handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
        { sender: {} },
        {
          sessionId: 'pty-1',
          paneId: 'pane-1',
          cwd: '/tmp',
          visible: true,
          parentHeight: 900,
          bounds: { x: 10, y: 20, width: 300, height: 200 },
        }
      )
    ).toEqual({ enabled: false })

    expect(
      handlers.get(GHOSTTY_NATIVE_DATA)?.(
        {},
        { sessionId: 'pty-1', paneId: 'pane-1', data: 'a' }
      )
    ).toEqual({ enabled: false })

    expect(
      handlers.get(GHOSTTY_NATIVE_FOCUS)?.(
        {},
        { sessionId: 'pty-1', paneId: 'pane-1' }
      )
    ).toEqual({ enabled: false })

    expect(
      handlers.get(GHOSTTY_NATIVE_DESTROY)?.(
        {},
        { sessionId: 'pty-1', paneId: 'pane-1' }
      )
    ).toEqual({ enabled: false })
    expect(existsSync).toHaveBeenCalledTimes(1)
  })

  test('resolves packaged native artifacts from Electron resources', () => {
    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      packaged: true,
      resourcesPath: '/Applications/Vimeflow.app/Contents/Resources',
    })

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    expect(existsSync).toHaveBeenCalledWith(
      '/Applications/Vimeflow.app/Contents/Resources/ghostty-parent/ghostty_native_parent.node'
    )
  })

  test('rounds fractional parent frame bounds before forwarding to AppKit', () => {
    const surface = {}

    const addon = {
      create: vi.fn(() => surface),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10.4, y: 20.5, width: 300.49, height: 200.51 },
      }
    )

    expect(addon.setFrame).toHaveBeenCalledWith(
      surface,
      10,
      21,
      300,
      201,
      0,
      900
    )

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: false,
        parentHeight: 900,
        bounds: { x: 10.6, y: 20.4, width: 300.51, height: 200.49 },
      }
    )

    expect(addon.setFrame).toHaveBeenLastCalledWith(
      surface,
      11,
      20,
      0,
      0,
      0,
      900
    )

    controller.dispose()
  })

  test('forwards native theme color updates to AppKit', () => {
    const surface = {}

    const addon = {
      create: vi.fn(() => surface),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      setBackgroundColor: vi.fn(),
      setForegroundColor: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: <T>(): Promise<T> => Promise.resolve(undefined as T),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } satisfies Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        backgroundColor: '#fffcf0',
        foregroundColor: '#100f0f',
        fontFamily: 'Iosevka',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    expect(addon.setBackgroundColor).toHaveBeenCalledWith(surface, '#fffcf0')
    expect(addon.setForegroundColor).toHaveBeenCalledWith(surface, '#100f0f')
    expect(addon.setFontFamily).toHaveBeenCalledWith(surface, 'Iosevka')

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        backgroundColor: '#fffcf0',
        foregroundColor: '#100f0f',
        fontFamily: 'Iosevka',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    expect(addon.setBackgroundColor).toHaveBeenCalledTimes(1)
    expect(addon.setForegroundColor).toHaveBeenCalledTimes(1)
    expect(addon.setFontFamily).toHaveBeenCalledTimes(1)

    controller.dispose()
  })

  test('replays surface-scoped state after preserving secondary on destroy', () => {
    const firstSurface = { id: 'surface-1' }
    const secondSurface = { id: 'surface-2' }
    let createCount = 0

    const addon = {
      create: vi.fn(() => {
        const surface = createCount === 0 ? firstSurface : secondSurface
        createCount += 1

        return surface
      }),
      addSecondary: vi.fn(),
      setFrame: vi.fn(),
      setBackgroundColor: vi.fn(),
      setForegroundColor: vi.fn(),
      setFontFamily: vi.fn(),
      setShortcutDigits: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: <T>(): Promise<T> => Promise.resolve(undefined as T),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } satisfies Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    handlers.get(GHOSTTY_NATIVE_SECONDARY_ATTACH)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        secondarySessionId: 'burner-pty',
      }
    )

    const updatePayload = {
      sessionId: 'pty-1',
      paneId: 'pane-1',
      cwd: '/tmp',
      backgroundColor: '#fffcf0',
      foregroundColor: '#100f0f',
      visible: true,
      parentHeight: 900,
      bounds: { x: 10, y: 20, width: 300, height: 200 },
      shortcutContext: {
        paneIds: ['pane-1', 'pane-2', 'pane-3'],
        activePaneId: 'pane-1',
      },
    }

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.({ sender: {} }, updatePayload)

    handlers.get(GHOSTTY_NATIVE_DESTROY)?.(
      {},
      { sessionId: 'pty-1', paneId: 'pane-1' }
    )

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.({ sender: {} }, updatePayload)

    expect(addon.destroy).toHaveBeenCalledWith(firstSurface)
    expect(addon.setBackgroundColor).toHaveBeenNthCalledWith(
      2,
      secondSurface,
      '#fffcf0'
    )

    expect(addon.setForegroundColor).toHaveBeenNthCalledWith(
      2,
      secondSurface,
      '#100f0f'
    )

    expect(addon.setShortcutDigits).toHaveBeenNthCalledWith(
      2,
      secondSurface,
      '23'
    )

    controller.dispose()
  })

  test('flushes pending data once when the parented surface is created', () => {
    const surface = {}

    const addon = {
      create: vi.fn(() => surface),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: <T>(): Promise<T> => Promise.resolve(undefined as T),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } satisfies Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })
    const update = handlers.get(GHOSTTY_NATIVE_UPDATE)

    expect(
      handlers.get(GHOSTTY_NATIVE_DATA)?.(
        {},
        { sessionId: 'pty-1', paneId: 'pane-1', data: 'boot' }
      )
    ).toEqual({ enabled: true })
    expect(addon.write).not.toHaveBeenCalled()

    update?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    expect(addon.write).toHaveBeenCalledWith(surface, 'boot')

    update?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    expect(addon.write).toHaveBeenCalledTimes(1)

    controller.dispose()
  })

  test('destroys parented surfaces when their BrowserWindow closes', () => {
    const firstSurface = {}
    const secondSurface = {}

    const addon = {
      create: vi
        .fn()
        .mockReturnValueOnce(firstSurface)
        .mockReturnValueOnce(secondSurface),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: <T>(): Promise<T> => Promise.resolve(undefined as T),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } satisfies Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })
    const update = handlers.get(GHOSTTY_NATIVE_UPDATE)

    update?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    const closedHandler = browserWindowOnce.mock.calls[0]?.[1] as
      | (() => void)
      | undefined

    if (closedHandler === undefined) {
      throw new Error('expected BrowserWindow closed handler')
    }

    closedHandler()

    expect(addon.destroy).toHaveBeenCalledWith(firstSurface)

    browserWindowState.id = 2
    update?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    expect(addon.create).toHaveBeenCalledTimes(2)
    expect(addon.setFrame).toHaveBeenLastCalledWith(
      secondSurface,
      10,
      20,
      300,
      200,
      0,
      900
    )

    controller.dispose()
  })

  test('clears pending primary resize when moving a surface between windows', () => {
    vi.useFakeTimers()

    try {
      const firstSurface = {}
      const secondSurface = {}

      const addon = {
        create: vi
          .fn()
          .mockReturnValueOnce(firstSurface)
          .mockReturnValueOnce(secondSurface),
        setFrame: vi.fn(),
        setFontFamily: vi.fn(),
        write: vi.fn(),
        focus: vi.fn(),
        destroy: vi.fn(),
      }

      const invoke = vi.fn()

      const sidecar = {
        invoke: <T>(
          method: string,
          args?: Record<string, unknown>
        ): Promise<T> => {
          invoke(method, args)

          return Promise.resolve(undefined as T)
        },
        onEvent: vi.fn(() => vi.fn()),
        shutdown: vi.fn(() => Promise.resolve()),
      } satisfies Sidecar

      const controller = setupGhosttyNativeParent({
        sidecar,
        platform: 'darwin',
        env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
        addon,
      })
      const update = handlers.get(GHOSTTY_NATIVE_UPDATE)

      update?.(
        { sender: {} },
        {
          sessionId: 'pty-1',
          paneId: 'pane-1',
          cwd: '/tmp',
          visible: true,
          parentHeight: 900,
          bounds: { x: 10, y: 20, width: 300, height: 200 },
        }
      )

      const firstResize = addon.create.mock.calls[0]?.[3] as
        | ((cols: number, rows: number) => void)
        | undefined

      if (firstResize === undefined) {
        throw new Error('expected native resize callback')
      }

      firstResize(80, 24)
      firstResize(100, 30)

      browserWindowState.id = 2
      update?.(
        { sender: {} },
        {
          sessionId: 'pty-1',
          paneId: 'pane-1',
          cwd: '/tmp',
          visible: true,
          parentHeight: 900,
          bounds: { x: 10, y: 20, width: 300, height: 200 },
        }
      )

      vi.advanceTimersByTime(120)

      expect(addon.destroy).toHaveBeenCalledWith(firstSurface)
      expect(addon.create).toHaveBeenCalledTimes(2)
      expect(invoke).toHaveBeenCalledTimes(1)
      expect(invoke).toHaveBeenCalledWith('resize_pty', {
        request: {
          sessionId: 'pty-1',
          cols: 80,
          rows: 24,
        },
      })

      controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test('caps renderer-created pane state before allocating unbounded surfaces', () => {
    const addon = {
      create: vi.fn(),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: <T>(): Promise<T> => Promise.resolve(undefined as T),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } satisfies Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })
    const data = handlers.get(GHOSTTY_NATIVE_DATA)

    for (let index = 0; index < 128; index += 1) {
      expect(
        data?.(
          {},
          {
            sessionId: `pty-${index}`,
            paneId: `pane-${index}`,
            data: 'boot',
          }
        )
      ).toEqual({ enabled: true })
    }

    expect(() =>
      data?.(
        {},
        {
          sessionId: 'pty-overflow',
          paneId: 'pane-overflow',
          data: 'boot',
        }
      )
    ).toThrow('ghostty native parent surface limit exceeded')

    expect(addon.create).not.toHaveBeenCalled()

    controller.dispose()
  })

  test('forwards collapsed bottom corner radius to AppKit', () => {
    const surface = {}

    const addon = {
      create: vi.fn(() => surface),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: <T>(): Promise<T> => Promise.resolve(undefined as T),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } satisfies Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        bottomCornerRadius: 10,
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    expect(addon.setFrame).toHaveBeenCalledWith(
      surface,
      10,
      20,
      300,
      200,
      10,
      900
    )

    controller.dispose()
  })

  test('forwards same-snapshot parent height to AppKit', () => {
    const surface = {}

    const addon = {
      create: vi.fn(() => surface),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: <T>(): Promise<T> => Promise.resolve(undefined as T),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } satisfies Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        parentHeight: 900.4,
        visible: true,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    expect(addon.setFrame).toHaveBeenCalledWith(
      surface,
      10,
      20,
      300,
      200,
      0,
      900
    )

    controller.dispose()
  })

  test('suppresses visible zero-area frames', () => {
    const surface = {}

    const addon = {
      create: vi.fn(() => surface),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
      dispose: vi.fn(),
    }

    const sidecar = {
      invoke: <T>(): Promise<T> => Promise.resolve(undefined as T),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } satisfies Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 0, height: 200 },
      }
    )

    expect(addon.setFrame).toHaveBeenCalledWith(surface, 10, 20, 0, 0, 0, 900)

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 0 },
      }
    )

    expect(addon.setFrame).toHaveBeenLastCalledWith(
      surface,
      10,
      20,
      0,
      0,
      0,
      900
    )

    controller.dispose()
  })

  test('updates native shortcut digits only for real pane switches', () => {
    const surface = {}

    const addon = {
      create: vi.fn(() => surface),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      setShortcutDigits: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: <T>(): Promise<T> => Promise.resolve(undefined as T),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } satisfies Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
        shortcutContext: {
          paneIds: ['pane-1', 'pane-2', 'pane-3'],
          activePaneId: 'pane-1',
        },
      }
    )

    expect(addon.setShortcutDigits).toHaveBeenLastCalledWith(surface, '23')

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
        shortcutContext: {
          paneIds: ['pane-1', 'pane-2', 'pane-3'],
          activePaneId: 'pane-1',
        },
      }
    )

    expect(addon.setShortcutDigits).toHaveBeenCalledTimes(1)

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
        shortcutContext: {
          paneIds: ['pane-1', 'pane-2', 'pane-3'],
          activePaneId: 'pane-2',
        },
      }
    )

    expect(addon.setShortcutDigits).toHaveBeenLastCalledWith(surface, '')

    controller.dispose()
  })

  test('creates parented surface and forwards native input plus resize', () => {
    const callbacks: {
      onInput?: (data: string) => void
      onResize?: (cols: number, rows: number) => void
      onFocus?: () => void
      onRenamePane?: () => void
    } = {}
    const surface = {}

    const addon = {
      create: vi.fn(
        (_bridge, _handle, input, resize, focus, _shortcut, renamePane) => {
          callbacks.onInput = input
          callbacks.onResize = resize
          callbacks.onFocus = focus
          callbacks.onRenamePane = renamePane

          return surface
        }
      ),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })
    const update = handlers.get(GHOSTTY_NATIVE_UPDATE)
    expect(update).toBeDefined()

    update?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    expect(addon.create).toHaveBeenCalledWith(
      expect.stringContaining('libGhosttyElectronBridge.dylib'),
      nativeHandle,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    )

    expect(addon.setFrame).toHaveBeenCalledWith(
      surface,
      10,
      20,
      300,
      200,
      0,
      900
    )

    callbacks.onInput?.('a')
    callbacks.onResize?.(80, 24)
    callbacks.onResize?.(80, 24)
    callbacks.onFocus?.()
    callbacks.onRenamePane?.()

    expect(sidecar.invoke).toHaveBeenCalledWith('write_pty', {
      request: { sessionId: 'pty-1', data: 'a' },
    })

    expect(webContentsSend).toHaveBeenCalledWith(BACKEND_EVENT, {
      event: 'ghostty-native-input',
      payload: { sessionId: 'pty-1', paneId: 'pane-1', data: 'a' },
    })

    expect(sidecar.invoke).toHaveBeenCalledWith('resize_pty', {
      request: { sessionId: 'pty-1', cols: 80, rows: 24 },
    })

    expect(webContentsSend).toHaveBeenCalledWith(BACKEND_EVENT, {
      event: 'ghostty-native-focus',
      payload: { sessionId: 'pty-1', paneId: 'pane-1' },
    })

    expect(webContentsSend).toHaveBeenCalledWith(BACKEND_EVENT, {
      event: 'ghostty-native-rename-pane',
      payload: { sessionId: 'pty-1', paneId: 'pane-1' },
    })
    expect(webContentsFocus).toHaveBeenCalledOnce()
    expect(sidecar.invoke).toHaveBeenCalledTimes(2)

    controller.dispose()
  })

  test('coalesces native resize bursts before resizing the PTY again', () => {
    vi.useFakeTimers()
    let controller: ReturnType<typeof setupGhosttyNativeParent> | null = null

    try {
      const callbacks: {
        onResize?: (cols: number, rows: number) => void
      } = {}
      const surface = {}

      const addon = {
        create: vi.fn(
          (
            _bridge,
            _handle,
            _input,
            resize,
            _focus,
            _shortcut,
            _renamePane
          ) => {
            void _bridge
            void _handle
            void _input
            void _focus
            void _shortcut
            void _renamePane
            callbacks.onResize = resize

            return surface
          }
        ),
        setFrame: vi.fn(),
        setFontFamily: vi.fn(),
        write: vi.fn(),
        focus: vi.fn(),
        destroy: vi.fn(),
      }

      const sidecar = {
        invoke: vi.fn(() => Promise.resolve(undefined)),
        onEvent: vi.fn(() => vi.fn()),
        shutdown: vi.fn(() => Promise.resolve()),
      } as unknown as Sidecar

      controller = setupGhosttyNativeParent({
        sidecar,
        platform: 'darwin',
        env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
        addon,
      })

      handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
        { sender: {} },
        {
          sessionId: 'pty-1',
          paneId: 'pane-1',
          cwd: '/tmp',
          visible: true,
          parentHeight: 900,
          bounds: { x: 10, y: 20, width: 300, height: 200 },
        }
      )

      callbacks.onResize?.(80, 24)
      callbacks.onResize?.(81, 24)
      callbacks.onResize?.(82, 24)

      expect(sidecar.invoke).toHaveBeenCalledTimes(1)
      expect(sidecar.invoke).toHaveBeenCalledWith('resize_pty', {
        request: { sessionId: 'pty-1', cols: 80, rows: 24 },
      })

      vi.advanceTimersByTime(200)

      expect(sidecar.invoke).toHaveBeenCalledTimes(2)
      expect(sidecar.invoke).toHaveBeenLastCalledWith('resize_pty', {
        request: { sessionId: 'pty-1', cols: 82, rows: 24 },
      })

      callbacks.onResize?.(83, 24)
      callbacks.onResize?.(82, 24)
      vi.advanceTimersByTime(200)

      expect(sidecar.invoke).toHaveBeenCalledTimes(2)
    } finally {
      controller?.dispose()
      vi.useRealTimers()
    }
  })

  test('drops native Ghostty input while an interactive overlay is active', () => {
    const callbacks: {
      onInput?: (data: string) => void
      onFocus?: () => void
      onShortcut?: (
        key: string,
        code: string,
        control: boolean,
        meta: boolean,
        alt: boolean,
        shift: boolean,
        repeat: boolean
      ) => void
      onRenamePane?: () => void
    } = {}
    const surface = {}

    const addon = {
      create: vi.fn(
        (_bridge, _handle, input, _resize, focus, shortcut, renamePane) => {
          void _resize
          callbacks.onInput = input
          callbacks.onFocus = focus
          callbacks.onShortcut = shortcut
          callbacks.onRenamePane = renamePane

          return surface
        }
      ),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const inputBlocked = vi.fn(() => true)

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
      inputBlocked,
    })

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    callbacks.onInput?.('secret')
    callbacks.onFocus?.()
    callbacks.onShortcut?.('n', 'KeyN', false, true, false, false, false)
    callbacks.onRenamePane?.()

    expect(inputBlocked).toHaveBeenCalled()
    expect(sidecar.invoke).not.toHaveBeenCalled()
    expect(webContentsSend).not.toHaveBeenCalled()
    expect(webContentsFocus).not.toHaveBeenCalled()
    expect(webContentsExecuteJavaScript).not.toHaveBeenCalled()
    expect(addon.focus).not.toHaveBeenCalled()

    controller.dispose()
  })

  test('attaches secondary child and routes input plus resize to its PTY', () => {
    const callbacks: {
      onInput?: (data: string) => void
      onResize?: (cols: number, rows: number) => void
      onFocus?: () => void
    } = {}
    const surface = {}

    const addon = {
      create: vi.fn(() => surface),
      addSecondary: vi.fn((_surface, input, resize, focus) => {
        callbacks.onInput = input
        callbacks.onResize = resize
        callbacks.onFocus = focus
      }),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      writeSecondary: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    expect(
      handlers.get(GHOSTTY_NATIVE_SECONDARY_ATTACH)?.(
        { sender: {} },
        {
          sessionId: 'host-pty',
          paneId: 'pane-1',
          secondarySessionId: 'burner-pty',
        }
      )
    ).toEqual({ enabled: true })

    expect(addon.create).toHaveBeenCalledOnce()
    expect(addon.addSecondary).toHaveBeenCalledWith(
      surface,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    )

    callbacks.onInput?.('a')
    callbacks.onResize?.(80, 24)
    callbacks.onResize?.(80, 24)
    callbacks.onFocus?.()

    expect(sidecar.invoke).toHaveBeenCalledWith('write_pty', {
      request: { sessionId: 'burner-pty', data: 'a' },
    })

    expect(sidecar.invoke).toHaveBeenCalledWith('resize_pty', {
      request: { sessionId: 'burner-pty', cols: 80, rows: 24 },
    })

    expect(webContentsSend).toHaveBeenCalledWith(BACKEND_EVENT, {
      event: 'ghostty-native-focus',
      payload: { sessionId: 'host-pty', paneId: 'pane-1' },
    })
    expect(sidecar.invoke).toHaveBeenCalledTimes(2)

    controller.dispose()
  })

  test('keeps secondary resize active while overlay blocks input', () => {
    const callbacks: {
      onInput?: (data: string) => void
      onResize?: (cols: number, rows: number) => void
      onFocus?: () => void
    } = {}
    const surface = {}

    const addon = {
      create: vi.fn(() => surface),
      addSecondary: vi.fn((_surface, input, resize, focus) => {
        callbacks.onInput = input
        callbacks.onResize = resize
        callbacks.onFocus = focus
      }),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      writeSecondary: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
      inputBlocked: vi.fn(() => true),
    })

    handlers.get(GHOSTTY_NATIVE_SECONDARY_ATTACH)?.(
      { sender: {} },
      {
        sessionId: 'host-pty',
        paneId: 'pane-1',
        secondarySessionId: 'burner-pty',
      }
    )

    callbacks.onInput?.('blocked')
    callbacks.onResize?.(100, 30)
    callbacks.onFocus?.()

    expect(sidecar.invoke).toHaveBeenCalledOnce()
    expect(sidecar.invoke).toHaveBeenCalledWith('resize_pty', {
      request: { sessionId: 'burner-pty', cols: 100, rows: 30 },
    })
    expect(webContentsSend).not.toHaveBeenCalled()

    controller.dispose()
  })

  test('buffers capped secondary output until the child is attached', () => {
    const surface = {}

    const addon = {
      create: vi.fn(() => surface),
      addSecondary: vi.fn(),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      writeSecondary: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    for (let index = 0; index < 70; index += 1) {
      expect(
        handlers.get(GHOSTTY_NATIVE_SECONDARY_DATA)?.(
          {},
          {
            sessionId: 'host-pty',
            paneId: 'pane-1',
            secondarySessionId: 'burner-pty',
            data: `boot-${index}`,
          }
        )
      ).toEqual({ enabled: true })
    }
    expect(addon.writeSecondary).not.toHaveBeenCalled()

    handlers.get(GHOSTTY_NATIVE_SECONDARY_ATTACH)?.(
      { sender: {} },
      {
        sessionId: 'host-pty',
        paneId: 'pane-1',
        secondarySessionId: 'burner-pty',
      }
    )

    expect(addon.writeSecondary).toHaveBeenCalledTimes(64)
    expect(addon.writeSecondary).toHaveBeenNthCalledWith(1, surface, 'boot-6')
    expect(addon.writeSecondary).toHaveBeenLastCalledWith(surface, 'boot-69')

    controller.dispose()
  })

  test('hides and removes secondary child without destroying primary surface', () => {
    const surface = {}

    const addon = {
      create: vi.fn(() => surface),
      addSecondary: vi.fn(),
      setSecondaryVisible: vi.fn(),
      removeSecondary: vi.fn(),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      writeSecondary: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    handlers.get(GHOSTTY_NATIVE_SECONDARY_ATTACH)?.(
      { sender: {} },
      {
        sessionId: 'host-pty',
        paneId: 'pane-1',
        secondarySessionId: 'burner-pty',
      }
    )

    expect(
      handlers.get(GHOSTTY_NATIVE_SECONDARY_VISIBLE)?.(
        {},
        {
          sessionId: 'host-pty',
          paneId: 'pane-1',
          secondarySessionId: 'burner-pty',
          visible: false,
        }
      )
    ).toEqual({ enabled: true })

    expect(addon.setSecondaryVisible).toHaveBeenCalledWith(surface, false)

    expect(
      handlers.get(GHOSTTY_NATIVE_SECONDARY_REMOVE)?.(
        {},
        {
          sessionId: 'host-pty',
          paneId: 'pane-1',
          secondarySessionId: 'burner-pty',
        }
      )
    ).toEqual({ enabled: true })

    expect(addon.removeSecondary).toHaveBeenCalledWith(surface)
    expect(addon.destroy).not.toHaveBeenCalled()

    controller.dispose()
  })

  test('reattaches secondary child after primary surface recreation', () => {
    const callbacks: {
      onInput?: (data: string) => void
      onResize?: (cols: number, rows: number) => void
      onFocus?: () => void
    }[] = []
    const firstSurface = { id: 'surface-1' }
    const secondSurface = { id: 'surface-2' }

    const addon = {
      create: vi.fn(() =>
        callbacks.length === 0 ? firstSurface : secondSurface
      ),
      addSecondary: vi.fn((_surface, input, resize, focus) => {
        callbacks.push({
          onInput: input,
          onResize: resize,
          onFocus: focus,
        })
      }),
      setSecondaryVisible: vi.fn(),
      removeSecondary: vi.fn(),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      writeSecondary: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    handlers.get(GHOSTTY_NATIVE_SECONDARY_ATTACH)?.(
      { sender: {} },
      {
        sessionId: 'host-pty',
        paneId: 'pane-1',
        secondarySessionId: 'burner-pty',
      }
    )

    handlers.get(GHOSTTY_NATIVE_SECONDARY_VISIBLE)?.(
      {},
      {
        sessionId: 'host-pty',
        paneId: 'pane-1',
        secondarySessionId: 'burner-pty',
        visible: false,
      }
    )

    handlers.get(GHOSTTY_NATIVE_DESTROY)?.(
      {},
      { sessionId: 'host-pty', paneId: 'pane-1' }
    )

    handlers.get(GHOSTTY_NATIVE_SECONDARY_DATA)?.(
      {},
      {
        sessionId: 'host-pty',
        paneId: 'pane-1',
        secondarySessionId: 'burner-pty',
        data: 'after-destroy',
      }
    )

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'host-pty',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    expect(addon.destroy).toHaveBeenCalledWith(firstSurface)
    expect(addon.create).toHaveBeenCalledTimes(2)
    expect(addon.addSecondary).toHaveBeenNthCalledWith(
      2,
      secondSurface,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    )

    expect(addon.setSecondaryVisible).toHaveBeenLastCalledWith(
      secondSurface,
      false
    )

    expect(addon.writeSecondary).toHaveBeenCalledWith(
      secondSurface,
      'after-destroy'
    )

    callbacks[1]?.onInput?.('b')
    expect(sidecar.invoke).toHaveBeenCalledWith('write_pty', {
      request: { sessionId: 'burner-pty', data: 'b' },
    })

    controller.dispose()
  })

  test('does not reattach stale secondary before replacing it', () => {
    const firstSurface = { id: 'surface-1' }
    const secondSurface = { id: 'surface-2' }
    let createCount = 0

    const addon = {
      create: vi.fn(() => {
        const surface = createCount === 0 ? firstSurface : secondSurface
        createCount += 1

        return surface
      }),
      addSecondary: vi.fn(),
      removeSecondary: vi.fn(),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    handlers.get(GHOSTTY_NATIVE_SECONDARY_ATTACH)?.(
      { sender: {} },
      {
        sessionId: 'host-pty',
        paneId: 'pane-1',
        secondarySessionId: 'old-burner-pty',
      }
    )

    handlers.get(GHOSTTY_NATIVE_DESTROY)?.(
      {},
      { sessionId: 'host-pty', paneId: 'pane-1' }
    )

    handlers.get(GHOSTTY_NATIVE_SECONDARY_ATTACH)?.(
      { sender: {} },
      {
        sessionId: 'host-pty',
        paneId: 'pane-1',
        secondarySessionId: 'new-burner-pty',
      }
    )

    expect(addon.addSecondary).toHaveBeenCalledTimes(2)
    expect(addon.addSecondary).toHaveBeenNthCalledWith(
      1,
      firstSurface,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    )

    expect(addon.addSecondary).toHaveBeenNthCalledWith(
      2,
      secondSurface,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    )
    expect(addon.removeSecondary).not.toHaveBeenCalled()

    controller.dispose()
  })

  test('forwards native app shortcuts into the app renderer', async () => {
    const callbacks: {
      onShortcut?: (
        key: string,
        code: string,
        control: boolean,
        meta: boolean,
        alt: boolean,
        shift: boolean,
        repeat: boolean
      ) => void
    } = {}
    const surface = { id: 'surface-1' }

    const addon = {
      create: vi.fn(
        (_bridge, _handle, _input, _resize, _focus, shortcut, _renamePane) => {
          void _renamePane
          callbacks.onShortcut = shortcut

          return surface
        }
      ),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    webContentsExecuteJavaScript.mockResolvedValue({
      activeGhosttyPane: true,
      dockHasFocus: false,
    })
    callbacks.onShortcut?.('2', 'Digit2', false, true, false, false, false)

    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(webContentsFocus).toHaveBeenCalledOnce()
    expect(webContentsExecuteJavaScript).toHaveBeenCalledOnce()
    expect(webContentsExecuteJavaScript.mock.calls[0]?.[0]).toContain(
      '"key":"2"'
    )

    expect(webContentsExecuteJavaScript.mock.calls[0]?.[0]).toContain(
      '"code":"Digit2"'
    )
    expect(webContentsExecuteJavaScript.mock.calls[0]?.[0]).toContain('Digit2')
    expect(webContentsExecuteJavaScript.mock.calls[0]?.[0]).toContain('metaKey')
    expect(webContentsExecuteJavaScript.mock.calls[0]?.[0]).toContain(
      'data-vimeflow-shortcut-proxy'
    )

    expect(webContentsExecuteJavaScript.mock.calls[0]?.[0]).toContain(
      'data-workspace-overlay-id="pane-rename"'
    )
    expect(addon.focus).toHaveBeenCalledWith(surface)

    webContentsFocus.mockClear()
    webContentsExecuteJavaScript.mockClear()
    addon.focus.mockClear()

    webContentsExecuteJavaScript.mockResolvedValueOnce({
      activeGhosttyPane: true,
      dockHasFocus: true,
    })
    callbacks.onShortcut?.('g', 'KeyG', false, true, false, false, false)

    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(webContentsFocus).toHaveBeenCalledOnce()
    expect(webContentsExecuteJavaScript).toHaveBeenCalledOnce()
    expect(webContentsExecuteJavaScript.mock.calls[0]?.[0]).toContain('KeyG')
    expect(addon.focus).not.toHaveBeenCalled()

    webContentsFocus.mockClear()
    webContentsExecuteJavaScript.mockClear()
    addon.focus.mockClear()

    callbacks.onShortcut?.('b', 'KeyB', false, true, false, false, false)

    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(webContentsFocus).toHaveBeenCalledOnce()
    expect(webContentsExecuteJavaScript).toHaveBeenCalledOnce()
    expect(webContentsExecuteJavaScript.mock.calls[0]?.[0]).toContain('KeyB')
    expect(addon.focus).toHaveBeenCalledWith(surface)

    webContentsFocus.mockClear()
    webContentsExecuteJavaScript.mockClear()
    addon.focus.mockClear()

    webContentsExecuteJavaScript.mockResolvedValueOnce({
      activeGhosttyPane: true,
      dockHasFocus: true,
    })
    callbacks.onShortcut?.('0', 'Digit0', false, true, false, false, false)

    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(webContentsFocus).toHaveBeenCalledOnce()
    expect(webContentsExecuteJavaScript).toHaveBeenCalledOnce()
    expect(webContentsExecuteJavaScript.mock.calls[0]?.[0]).toContain('Digit0')
    expect(addon.focus).not.toHaveBeenCalled()

    webContentsFocus.mockClear()
    webContentsExecuteJavaScript.mockClear()
    addon.focus.mockClear()

    webContentsExecuteJavaScript.mockResolvedValueOnce({
      activeGhosttyPane: true,
      dockHasFocus: false,
    })
    callbacks.onShortcut?.('e', 'KeyE', false, true, false, false, false)

    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(webContentsFocus).toHaveBeenCalledOnce()
    expect(webContentsExecuteJavaScript).toHaveBeenCalledOnce()
    expect(webContentsExecuteJavaScript.mock.calls[0]?.[0]).toContain('KeyE')
    expect(addon.focus).toHaveBeenCalledWith(surface)

    webContentsFocus.mockClear()
    webContentsExecuteJavaScript.mockClear()
    addon.focus.mockClear()

    callbacks.onShortcut?.('n', 'KeyN', false, true, false, false, true)

    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(webContentsFocus).toHaveBeenCalledOnce()
    expect(webContentsExecuteJavaScript).toHaveBeenCalledOnce()
    expect(webContentsExecuteJavaScript.mock.calls[0]?.[0]).toContain('repeat')
    expect(webContentsExecuteJavaScript.mock.calls[0]?.[0]).toContain(
      '"repeat":true'
    )

    controller.dispose()
  })

  test('does not refocus a surface destroyed while shortcut dispatch is pending', async () => {
    const callbacks: {
      onShortcut?: (
        key: string,
        code: string,
        control: boolean,
        meta: boolean,
        alt: boolean,
        shift: boolean,
        repeat: boolean
      ) => void
    } = {}
    const surface = { id: 'surface-1' }
    let resolveDispatch: (value: unknown) => void = () => {
      throw new Error('Shortcut dispatch resolver was not initialized')
    }

    const pendingDispatch = new Promise<unknown>((resolve) => {
      resolveDispatch = resolve
    })

    const addon = {
      create: vi.fn(
        (_bridge, _handle, _input, _resize, _focus, shortcut, _renamePane) => {
          void _renamePane
          callbacks.onShortcut = shortcut

          return surface
        }
      ),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    webContentsExecuteJavaScript.mockReturnValueOnce(pendingDispatch)
    callbacks.onShortcut?.('b', 'KeyB', false, true, false, false, false)

    expect(webContentsExecuteJavaScript).toHaveBeenCalledOnce()
    handlers.get(GHOSTTY_NATIVE_DESTROY)?.(
      {},
      { sessionId: 'pty-1', paneId: 'pane-1' }
    )

    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    resolveDispatch({ activeGhosttyPane: true, dockHasFocus: false })
    await pendingDispatch
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(addon.destroy).toHaveBeenCalledWith(surface)
    expect(addon.focus).not.toHaveBeenCalled()

    controller.dispose()
  })

  test('does not refocus when an overlay opens during shortcut dispatch', async () => {
    const callbacks: {
      onShortcut?: (
        key: string,
        code: string,
        control: boolean,
        meta: boolean,
        alt: boolean,
        shift: boolean,
        repeat: boolean
      ) => void
    } = {}
    const surface = { id: 'surface-1' }
    let overlayOpen = false
    let resolveDispatch: (value: unknown) => void = () => {
      throw new Error('Shortcut dispatch resolver was not initialized')
    }

    const pendingDispatch = new Promise<unknown>((resolve) => {
      resolveDispatch = resolve
    })

    const addon = {
      create: vi.fn(
        (_bridge, _handle, _input, _resize, _focus, shortcut, _renamePane) => {
          void _renamePane
          callbacks.onShortcut = shortcut

          return surface
        }
      ),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar
    const inputBlocked = vi.fn(() => overlayOpen)

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
      inputBlocked,
    })

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    webContentsExecuteJavaScript.mockReturnValueOnce(pendingDispatch)
    callbacks.onShortcut?.('n', 'KeyN', false, true, false, false, false)

    expect(webContentsExecuteJavaScript).toHaveBeenCalledOnce()
    overlayOpen = true

    resolveDispatch({ activeGhosttyPane: true, dockHasFocus: false })
    await pendingDispatch
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(inputBlocked).toHaveBeenCalledTimes(2)
    expect(addon.focus).not.toHaveBeenCalled()

    controller.dispose()
  })

  test('opens command palette directly from native Ghostty shortcut', () => {
    const callbacks: {
      onShortcut?: (
        key: string,
        code: string,
        control: boolean,
        meta: boolean,
        alt: boolean,
        shift: boolean,
        repeat: boolean
      ) => void
    } = {}
    const surface = { id: 'surface-1' }

    const addon = {
      create: vi.fn(
        (_bridge, _handle, _input, _resize, _focus, shortcut, _renamePane) => {
          void _renamePane
          callbacks.onShortcut = shortcut

          return surface
        }
      ),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    const isMac = process.platform === 'darwin'
    callbacks.onShortcut?.(';', 'Semicolon', !isMac, isMac, false, false, false)

    expect(webContentsFocus).toHaveBeenCalledOnce()
    expect(webContentsSend).toHaveBeenCalledWith(
      COMMAND_PALETTE_TOGGLE,
      'leader'
    )
    expect(webContentsExecuteJavaScript).not.toHaveBeenCalled()
    expect(addon.focus).not.toHaveBeenCalled()

    controller.dispose()
  })

  test('ignores late native callbacks after BrowserWindow destruction', () => {
    const callbacks: {
      onInput?: (data: string) => void
      onResize?: (cols: number, rows: number) => void
    } = {}
    const surface = { id: 'surface-1' }

    const addon = {
      create: vi.fn(
        (_bridge, _handle, input, resize, _focus, _shortcut, _renamePane) => {
          void _focus
          void _shortcut
          void _renamePane
          callbacks.onInput = input
          callbacks.onResize = resize

          return surface
        }
      ),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })
    const update = handlers.get(GHOSTTY_NATIVE_UPDATE)

    update?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    isDestroyed.mockReturnValue(true)

    callbacks.onInput?.('ignored')
    callbacks.onResize?.(80, 24)

    expect(webContentsSend).not.toHaveBeenCalled()
    expect(sidecar.invoke).not.toHaveBeenCalledWith('write_pty', {
      request: { sessionId: 'pty-1', data: 'ignored' },
    })

    expect(sidecar.invoke).not.toHaveBeenCalledWith('resize_pty', {
      request: { sessionId: 'pty-1', cols: 80, rows: 24 },
    })

    controller.dispose()
  })

  test('contains native callback sidecar rejections', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)

    const callbacks: {
      onInput?: (data: string) => void
      onResize?: (cols: number, rows: number) => void
    } = {}
    const surface = { id: 'surface-1' }

    const addon = {
      create: vi.fn(
        (_bridge, _handle, input, resize, _focus, _shortcut, _renamePane) => {
          void _focus
          void _shortcut
          void _renamePane
          callbacks.onInput = input
          callbacks.onResize = resize

          return surface
        }
      ),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.reject(new Error('sidecar unavailable'))),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })
    const update = handlers.get(GHOSTTY_NATIVE_UPDATE)

    update?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    callbacks.onInput?.('a')
    callbacks.onResize?.(80, 24)
    await Promise.resolve()

    expect(warnSpy).toHaveBeenCalledWith(
      'Ghostty native sidecar invoke failed',
      expect.any(Error)
    )
    expect(warnSpy).toHaveBeenCalledTimes(2)

    controller.dispose()
    warnSpy.mockRestore()
  })

  test('keeps separate surfaces for split panes', () => {
    const callbacks: {
      onInput: (data: string) => void
      onResize: (cols: number, rows: number) => void
    }[] = []
    const surfaces = [{ id: 'surface-1' }, { id: 'surface-2' }]

    const addon = {
      create: vi.fn(
        (_bridge, _handle, input, resize, _focus, _shortcut, _renamePane) => {
          void _focus
          void _shortcut
          void _renamePane
          callbacks.push({ onInput: input, onResize: resize })

          return surfaces[callbacks.length - 1]
        }
      ),
      setFrame: vi.fn(),
      setFontFamily: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar

    const controller = setupGhosttyNativeParent({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS_PARENT: '1' },
      addon,
    })
    const update = handlers.get(GHOSTTY_NATIVE_UPDATE)
    const destroy = handlers.get(GHOSTTY_NATIVE_DESTROY)

    update?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    update?.(
      { sender: {} },
      {
        sessionId: 'pty-2',
        paneId: 'pane-2',
        cwd: '/tmp',
        visible: true,
        parentHeight: 900,
        bounds: { x: 400, y: 20, width: 300, height: 200 },
      }
    )

    expect(addon.create).toHaveBeenCalledTimes(2)
    expect(addon.destroy).not.toHaveBeenCalled()
    expect(addon.setFrame).toHaveBeenCalledWith(
      surfaces[0],
      10,
      20,
      300,
      200,
      0,
      900
    )

    expect(addon.setFrame).toHaveBeenCalledWith(
      surfaces[1],
      400,
      20,
      300,
      200,
      0,
      900
    )

    callbacks[0]?.onInput('a')
    callbacks[1]?.onInput('b')
    callbacks[0]?.onResize(80, 24)
    callbacks[1]?.onResize(100, 30)
    callbacks[1]?.onResize(100, 30)

    expect(sidecar.invoke).toHaveBeenCalledWith('write_pty', {
      request: { sessionId: 'pty-1', data: 'a' },
    })

    expect(sidecar.invoke).toHaveBeenCalledWith('write_pty', {
      request: { sessionId: 'pty-2', data: 'b' },
    })

    expect(sidecar.invoke).toHaveBeenCalledWith('resize_pty', {
      request: { sessionId: 'pty-1', cols: 80, rows: 24 },
    })

    expect(sidecar.invoke).toHaveBeenCalledWith('resize_pty', {
      request: { sessionId: 'pty-2', cols: 100, rows: 30 },
    })
    expect(sidecar.invoke).toHaveBeenCalledTimes(4)

    destroy?.({}, { sessionId: 'pty-1', paneId: 'pane-1' })

    expect(addon.destroy).toHaveBeenCalledWith(surfaces[0])
    expect(addon.destroy).not.toHaveBeenCalledWith(surfaces[1])

    callbacks[0]?.onInput('ignored')
    callbacks[1]?.onInput('c')

    expect(sidecar.invoke).toHaveBeenCalledWith('write_pty', {
      request: { sessionId: 'pty-2', data: 'c' },
    })

    expect(sidecar.invoke).not.toHaveBeenCalledWith('write_pty', {
      request: { sessionId: 'pty-1', data: 'ignored' },
    })

    controller.dispose()
  })
})
