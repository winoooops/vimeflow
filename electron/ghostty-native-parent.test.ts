// cspell:ignore ghostty Ghostty GHOSTTY
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  GHOSTTY_NATIVE_DATA,
  GHOSTTY_NATIVE_DESTROY,
  GHOSTTY_NATIVE_FOCUS,
  GHOSTTY_NATIVE_UPDATE,
} from './ghostty-native-channels'
import { BACKEND_EVENT } from './ipc-channels'
import type { Sidecar } from './sidecar'
import {
  isGhosttyNativeParentEnabled,
  setupGhosttyNativeParent,
} from './ghostty-native-parent'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const nativeHandle = Buffer.alloc(8)
nativeHandle.writeBigUInt64LE(1n)

const { existsSync, isDestroyed, webContentsSend } = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  isDestroyed: vi.fn(() => false),
  webContentsSend: vi.fn(),
}))

vi.mock('node:fs', () => ({
  default: { existsSync },
  existsSync,
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => ({
      getNativeWindowHandle: (): Buffer => nativeHandle,
      isDestroyed,
      webContents: { send: webContentsSend },
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
    isDestroyed.mockReset()
    isDestroyed.mockReturnValue(false)
    webContentsSend.mockClear()
  })

  test('enables only on macOS with the parent feature flag', () => {
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
    expect(isGhosttyNativeParentEnabled('darwin', {})).toBe(false)
  })

  test('rejects invalid native data payload', () => {
    const addon = {
      create: vi.fn(),
      setFrame: vi.fn(),
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

  test('rounds fractional parent frame bounds before forwarding to AppKit', () => {
    const surface = {}

    const addon = {
      create: vi.fn(() => surface),
      setFrame: vi.fn(),
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
        bounds: { x: 10.4, y: 20.5, width: 300.49, height: 200.51 },
      }
    )

    expect(addon.setFrame).toHaveBeenCalledWith(surface, 10, 21, 300, 201)

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: false,
        bounds: { x: 10.6, y: 20.4, width: 300.51, height: 200.49 },
      }
    )

    expect(addon.setFrame).toHaveBeenLastCalledWith(surface, 11, 20, 0, 0)

    controller.dispose()
  })

  test('suppresses visible zero-area frames', () => {
    const surface = {}

    const addon = {
      create: vi.fn(() => surface),
      setFrame: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
      dispose: vi.fn(),
    }

    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      shutdown: vi.fn(() => Promise.resolve()),
    } satisfies GhosttyNativeSidecar

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
        bounds: { x: 10, y: 20, width: 0, height: 200 },
      }
    )

    expect(addon.setFrame).toHaveBeenCalledWith(surface, 10, 20, 0, 0)

    handlers.get(GHOSTTY_NATIVE_UPDATE)?.(
      { sender: {} },
      {
        sessionId: 'pty-1',
        paneId: 'pane-1',
        cwd: '/tmp',
        visible: true,
        bounds: { x: 10, y: 20, width: 300, height: 0 },
      }
    )

    expect(addon.setFrame).toHaveBeenLastCalledWith(surface, 10, 20, 0, 0)

    controller.dispose()
  })

  test('creates parented surface and forwards native input plus resize', () => {
    const callbacks: {
      onInput?: (data: string) => void
      onResize?: (cols: number, rows: number) => void
    } = {}
    const surface = {}

    const addon = {
      create: vi.fn((_bridge, _handle, input, resize) => {
        callbacks.onInput = input
        callbacks.onResize = resize

        return surface
      }),
      setFrame: vi.fn(),
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
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )

    expect(addon.create).toHaveBeenCalledWith(
      expect.stringContaining('libGhosttyElectronBridge.dylib'),
      nativeHandle,
      expect.any(Function),
      expect.any(Function)
    )
    expect(addon.setFrame).toHaveBeenCalledWith(surface, 10, 20, 300, 200)

    callbacks.onInput?.('a')
    callbacks.onResize?.(80, 24)
    callbacks.onResize?.(80, 24)

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
    expect(sidecar.invoke).toHaveBeenCalledTimes(2)

    controller.dispose()
  })

  test('ignores late native callbacks after BrowserWindow destruction', () => {
    const callbacks: {
      onInput?: (data: string) => void
      onResize?: (cols: number, rows: number) => void
    } = {}
    const surface = { id: 'surface-1' }

    const addon = {
      create: vi.fn((_bridge, _handle, input, resize) => {
        callbacks.onInput = input
        callbacks.onResize = resize

        return surface
      }),
      setFrame: vi.fn(),
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

  test('keeps separate surfaces for split panes', () => {
    const callbacks: {
      onInput: (data: string) => void
      onResize: (cols: number, rows: number) => void
    }[] = []
    const surfaces = [{ id: 'surface-1' }, { id: 'surface-2' }]

    const addon = {
      create: vi.fn((_bridge, _handle, input, resize) => {
        callbacks.push({ onInput: input, onResize: resize })

        return surfaces[callbacks.length - 1]
      }),
      setFrame: vi.fn(),
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
        bounds: { x: 400, y: 20, width: 300, height: 200 },
      }
    )

    expect(addon.create).toHaveBeenCalledTimes(2)
    expect(addon.destroy).not.toHaveBeenCalled()
    expect(addon.setFrame).toHaveBeenCalledWith(surfaces[0], 10, 20, 300, 200)
    expect(addon.setFrame).toHaveBeenCalledWith(surfaces[1], 400, 20, 300, 200)

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
