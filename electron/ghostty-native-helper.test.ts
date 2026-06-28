// cspell:ignore ghostty GHOSTTY
import { PassThrough, Writable } from 'node:stream'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GHOSTTY_NATIVE_UPDATE } from './ghostty-native-channels'
import {
  isGhosttyNativeEnabled,
  setupGhosttyNativeHelper,
  toGhosttyScreenFrame,
} from './ghostty-native-helper'
import { BACKEND_EVENT } from './ipc-channels'
import type { Sidecar } from './sidecar'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const webContentsSend = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => ({
      getContentBounds: (): {
        x: number
        y: number
        width: number
        height: number
      } => ({ x: 0, y: 0, width: 800, height: 600 }),
    })),
    getAllWindows: vi.fn(() => [{ webContents: { send: webContentsSend } }]),
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

describe('ghostty native helper', () => {
  beforeEach(() => {
    handlers.clear()
    webContentsSend.mockClear()
  })

  test('enables only on macOS with the feature flag', () => {
    expect(
      isGhosttyNativeEnabled('darwin', { VITE_GHOSTTY_NATIVE_MACOS: '1' })
    ).toBe(true)

    expect(
      isGhosttyNativeEnabled('linux', { VITE_GHOSTTY_NATIVE_MACOS: '1' })
    ).toBe(false)

    expect(isGhosttyNativeEnabled('darwin', {})).toBe(false)
  })

  test('projects renderer pane bounds into window screen bounds', () => {
    expect(
      toGhosttyScreenFrame(
        { x: 100, y: 50, width: 900, height: 700 },
        { x: 10.2, y: 20.6, width: 300.4, height: 200.5 },
        true
      )
    ).toEqual({
      x: 110,
      y: 71,
      width: 300,
      height: 201,
      visible: true,
    })

    expect(
      toGhosttyScreenFrame(
        { x: 100, y: 50, width: 900, height: 700 },
        { x: 10, y: 20, width: 0, height: 200 },
        true
      ).visible
    ).toBe(false)
  })

  test('mirrors helper input to renderer command tracking before writing to pty', () => {
    const stdout = new PassThrough()
    const stdin = new Writable({
      write(_chunk, _encoding, callback): void {
        callback()
      },
    })
    const helper: {
      stdin: Writable
      stdout: PassThrough
      stderr: null
      on: ReturnType<typeof vi.fn>
      kill: ReturnType<typeof vi.fn>
    } = {
      stdin,
      stdout,
      stderr: null,
      on: vi.fn(() => helper),
      kill: vi.fn(() => true),
    }
    const sidecar = {
      invoke: vi.fn(() => Promise.resolve(undefined)),
      onEvent: vi.fn(() => vi.fn()),
      shutdown: vi.fn(() => Promise.resolve()),
    } as unknown as Sidecar
    const controller = setupGhosttyNativeHelper({
      sidecar,
      platform: 'darwin',
      env: { VITE_GHOSTTY_NATIVE_MACOS: '1' },
      spawnFn: vi.fn(() => helper),
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
    const body = Buffer.from(
      JSON.stringify({
        kind: 'event',
        event: 'pty-input',
        payload: { data: '/clear\r' },
      }),
      'utf8'
    )
    stdout.emit(
      'data',
      Buffer.concat([
        Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'),
        body,
      ])
    )

    expect(webContentsSend).toHaveBeenCalledWith(BACKEND_EVENT, {
      event: 'ghostty-native-input',
      payload: { sessionId: 'pty-1', paneId: 'pane-1', data: '/clear\r' },
    })
    expect(sidecar.invoke).toHaveBeenCalledWith('write_pty', {
      request: { sessionId: 'pty-1', data: '/clear\r' },
    })

    controller.dispose()
  })
})
