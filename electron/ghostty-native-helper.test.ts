// cspell:ignore ghostty GHOSTTY
import { PassThrough, Writable } from 'node:stream'
import { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  GHOSTTY_NATIVE_DATA,
  GHOSTTY_NATIVE_DESTROY,
  GHOSTTY_NATIVE_FOCUS,
  GHOSTTY_NATIVE_UPDATE,
} from './ghostty-native-channels'
import {
  isGhosttyNativeEnabled,
  setupGhosttyNativeHelper,
  toGhosttyScreenFrame,
} from './ghostty-native-helper'
import { BACKEND_EVENT } from './ipc-channels'
import type { Sidecar } from './sidecar'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const webContentsSend = vi.fn()
const otherWebContentsSend = vi.fn()

const ownerWindow = {
  getContentBounds: (): {
    x: number
    y: number
    width: number
    height: number
  } => ({ x: 0, y: 0, width: 800, height: 600 }),
  isDestroyed: vi.fn(() => false),
  webContents: { send: webContentsSend },
}

const otherWindow = {
  isDestroyed: vi.fn(() => false),
  webContents: { send: otherWebContentsSend },
}

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => ownerWindow),
    getAllWindows: vi.fn(() => [ownerWindow, otherWindow]),
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
    otherWebContentsSend.mockClear()
    ownerWindow.isDestroyed.mockReturnValue(false)
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(
      ownerWindow as unknown as BrowserWindow
    )
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

  test('mirrors helper input only to the owning renderer before writing to pty', () => {
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
    expect(otherWebContentsSend).not.toHaveBeenCalled()

    expect(sidecar.invoke).toHaveBeenCalledWith('write_pty', {
      request: { sessionId: 'pty-1', data: '/clear\r' },
    })

    controller.dispose()
  })

  test('accepts an empty cwd while validating native updates', () => {
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

    expect(
      update?.(
        { sender: {} },
        {
          sessionId: 'pty-1',
          paneId: 'pane-1',
          cwd: '',
          visible: true,
          bounds: { x: 10, y: 20, width: 300, height: 200 },
        }
      )
    ).toEqual({ enabled: true })

    controller.dispose()
  })

  test('handles helper stdin errors during shutdown', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
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

    expect(() => {
      stdin.emit('error', new Error('EPIPE'))
      controller.dispose()
    }).not.toThrow()
    expect(helper.kill).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  test('does not mirror helper input after the owning window is destroyed', () => {
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
    ownerWindow.isDestroyed.mockReturnValue(true)

    const body = Buffer.from(
      JSON.stringify({
        kind: 'event',
        event: 'pty-input',
        payload: { data: 'secret' },
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

    expect(webContentsSend).not.toHaveBeenCalled()
    expect(otherWebContentsSend).not.toHaveBeenCalled()
    expect(sidecar.invoke).toHaveBeenCalledWith('write_pty', {
      request: { sessionId: 'pty-1', data: 'secret' },
    })

    controller.dispose()
  })

  test('parses helper events when frame headers arrive across stdout chunks', () => {
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
        event: 'pty-resize',
        payload: { cols: 100, rows: 30 },
      }),
      'utf8'
    )

    const frame = Buffer.concat([
      Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'),
      body,
    ])

    stdout.emit('data', frame.subarray(0, 4))
    stdout.emit('data', frame.subarray(4, 21))
    stdout.emit('data', frame.subarray(21))

    expect(sidecar.invoke).toHaveBeenCalledWith('resize_pty', {
      request: { sessionId: 'pty-1', cols: 100, rows: 30 },
    })

    controller.dispose()
  })

  test('reports disabled for non-current pane data and focus requests', () => {
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
    const data = handlers.get(GHOSTTY_NATIVE_DATA)
    const focus = handlers.get(GHOSTTY_NATIVE_FOCUS)

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

    expect(
      data?.({}, { sessionId: 'pty-2', paneId: 'pane-2', data: 'ignored' })
    ).toEqual({ enabled: false })

    expect(focus?.({}, { sessionId: 'pty-2', paneId: 'pane-2' })).toEqual({
      enabled: false,
    })

    controller.dispose()
  })

  test('clears partial helper stdout when destroying the current pane', () => {
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

    const body = Buffer.from(
      JSON.stringify({
        kind: 'event',
        event: 'pty-input',
        payload: { data: 'old-pane-input' },
      }),
      'utf8'
    )

    const frame = Buffer.concat([
      Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'),
      body,
    ])

    stdout.emit('data', frame.subarray(0, 12))
    destroy?.({}, { sessionId: 'pty-1', paneId: 'pane-1' })
    update?.(
      { sender: {} },
      {
        sessionId: 'pty-2',
        paneId: 'pane-2',
        cwd: '/tmp',
        visible: true,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }
    )
    stdout.emit('data', frame.subarray(12))

    expect(webContentsSend).not.toHaveBeenCalled()
    expect(sidecar.invoke).not.toHaveBeenCalledWith('write_pty', {
      request: { sessionId: 'pty-2', data: 'old-pane-input' },
    })

    controller.dispose()
  })
})
