import { describe, expect, test, vi } from 'vitest'
import { GHOSTTY_NATIVE_UPDATE } from './ghostty-native-channels'
import type { Sidecar } from './sidecar'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const nativeHandle = Buffer.alloc(8)
nativeHandle.writeBigUInt64LE(1n)

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => ({
      getNativeWindowHandle: () => nativeHandle,
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

import {
  isGhosttyNativeParentEnabled,
  setupGhosttyNativeParent,
} from './ghostty-native-parent'

describe('ghostty native parent', () => {
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
    expect(sidecar.invoke).toHaveBeenCalledWith('resize_pty', {
      request: { sessionId: 'pty-1', cols: 80, rows: 24 },
    })
    expect(sidecar.invoke).toHaveBeenCalledTimes(2)

    controller.dispose()
  })
})
