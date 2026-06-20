// cspell:ignore ghostty
import { describe, expect, test, vi } from 'vitest'
import {
  GhosttyRenderStateMainBridge,
  setupGhosttyRenderStateIpc,
  type GhosttyNativeBindings,
  type IpcMainEventLike,
} from './ghostty-render-state-main'
import {
  GHOSTTY_RENDER_STATE_CREATE,
  GHOSTTY_RENDER_STATE_DISPOSE,
  GHOSTTY_RENDER_STATE_READ_SNAPSHOT,
  GHOSTTY_RENDER_STATE_RESET,
  GHOSTTY_RENDER_STATE_RESIZE,
  GHOSTTY_RENDER_STATE_STATUS,
  GHOSTTY_RENDER_STATE_WRITE_BYTES,
} from './ghostty-render-state-channels'

interface TestNativeTerminal {
  feed: ReturnType<typeof vi.fn<(bytes: Uint8Array) => void>>
  resize: ReturnType<typeof vi.fn<(cols: number, rows: number) => void>>
  snapshot: ReturnType<
    typeof vi.fn<
      () => {
        rows: number
        cursorRow: number
        cursorCol: number
        visibleLines: readonly { row: number; text: string }[]
        cells?: readonly {
          row: number
          col: number
          text: string
          width: number
          foreground?: string
          background?: string
          bold?: boolean
        }[]
      }
    >
  >
  dispose: ReturnType<typeof vi.fn<() => void>>
}

interface TestIpcMain {
  readonly handlers: Map<
    string,
    (event: IpcMainEventLike, payload?: unknown) => void
  >
  on: ReturnType<
    typeof vi.fn<
      (
        channel: string,
        listener: (event: IpcMainEventLike, payload?: unknown) => void
      ) => void
    >
  >
  removeListener: ReturnType<
    typeof vi.fn<
      (
        channel: string,
        listener: (event: IpcMainEventLike, payload?: unknown) => void
      ) => void
    >
  >
}

const createNativeBindings = (): {
  bindings: GhosttyNativeBindings
  terminals: TestNativeTerminal[]
} => {
  const terminals: TestNativeTerminal[] = []

  const bindings: GhosttyNativeBindings = {
    createTerminal: vi.fn(({ rows }) => {
      const terminal: TestNativeTerminal = {
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: vi.fn(() => ({
          rows,
          cursorRow: 1,
          cursorCol: 2,
          visibleLines: [
            { row: 0, text: 'prompt' },
            { row: 1, text: 'output' },
          ],
          cells: [
            {
              row: 0,
              col: 0,
              text: 'p',
              width: 1,
              foreground: '#f38ba8',
              background: '#181825',
              bold: true,
            },
          ],
        })),
        dispose: vi.fn(),
      }

      terminals.push(terminal)

      return terminal
    }),
  }

  return { bindings, terminals }
}

const createEvent = (): IpcMainEventLike => ({
  returnValue: undefined,
  sender: {
    id: 42,
    once: vi.fn(),
    removeListener: vi.fn(),
  },
})

const requireResult = <T>(
  value:
    | {
        ok: true
        result: T
      }
    | {
        ok: false
        error: string
      }
): T => {
  if (!value.ok) {
    throw new Error(value.error)
  }

  return value.result
}

const createIpcMain = (): TestIpcMain => {
  const handlers = new Map<
    string,
    (event: IpcMainEventLike, payload?: unknown) => void
  >()

  return {
    handlers,
    on: vi.fn((channel, listener) => {
      handlers.set(channel, listener)
    }),
    removeListener: vi.fn((channel, listener) => {
      if (handlers.get(channel) === listener) {
        handlers.delete(channel)
      }
    }),
  }
}

describe('ghostty render-state main bridge', () => {
  test('feeds bytes into the native terminal and normalizes snapshots', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))
    const bytes = new Uint8Array([0x68, 0x69])

    expect(
      bridge.writeBytes({ driverId: createResult.driverId, bytes })
    ).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })

    expect(terminals[0]?.feed).toHaveBeenCalledWith(bytes)
    expect(bridge.readSnapshot({ driverId: createResult.driverId })).toEqual({
      ok: true,
      result: {
        rows: ['prompt', 'output', ...Array.from({ length: 22 }, () => '')],
        cursor: {
          rowIndex: 1,
          columnOffset: 2,
        },
        cells: [
          {
            row: 0,
            col: 0,
            text: 'p',
            width: 1,
            foreground: '#f38ba8',
            background: '#181825',
            bold: true,
          },
        ],
      },
    })
    expect(terminals[0]?.snapshot).toHaveBeenCalledWith({ includeCells: true })
  })

  test('returns OSC7 cwd effects across byte chunks before feeding native state', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const createResult = requireResult(bridge.createDriver(createEvent()))
    const encoder = new TextEncoder()

    expect(
      bridge.writeBytes({
        driverId: createResult.driverId,
        bytes: encoder.encode('\u001b]7;file://localhost/Users'),
      })
    ).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })

    expect(
      bridge.writeBytes({
        driverId: createResult.driverId,
        bytes: encoder.encode('/user/project\u0007prompt'),
      })
    ).toEqual({
      ok: true,
      result: {
        events: [
          {
            type: 'cwd',
            uri: 'file://localhost/Users/user/project',
          },
        ],
      },
    })
    expect(terminals[0]?.feed).toHaveBeenCalledTimes(2)
  })

  test('resizes native state and resets by recreating the terminal at the current size', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const createResult = requireResult(bridge.createDriver(createEvent()))

    expect(
      bridge.resize({
        driverId: createResult.driverId,
        size: { cols: 120, rows: 32 },
      })
    ).toEqual({ ok: true, result: null })

    expect(bridge.reset({ driverId: createResult.driverId })).toEqual({
      ok: true,
      result: null,
    })

    expect(terminals[0]?.resize).toHaveBeenCalledWith(120, 32)
    expect(terminals[0]?.dispose).toHaveBeenCalledOnce()
    expect(bindings.createTerminal).toHaveBeenLastCalledWith({
      cols: 120,
      rows: 32,
      scrollbackLimit: 10_000,
    })
    expect(terminals).toHaveLength(2)
  })

  test('keeps the existing terminal when reset recreation fails', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const createResult = requireResult(bridge.createDriver(createEvent()))

    vi.mocked(bindings.createTerminal).mockImplementationOnce(() => {
      throw new Error('native allocation failed')
    })

    expect(bridge.reset({ driverId: createResult.driverId })).toEqual({
      ok: false,
      error: 'native allocation failed',
    })
    expect(terminals[0]?.dispose).not.toHaveBeenCalled()

    expect(
      bridge.writeBytes({
        driverId: createResult.driverId,
        bytes: new Uint8Array([0x68]),
      })
    ).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })
    expect(terminals[0]?.feed).toHaveBeenCalledWith(new Uint8Array([0x68]))
  })

  test('preserves fallback row text around sparse styled cells', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 9,
          visibleLines: [{ row: 0, text: 'plain red' }],
          cells: [
            {
              row: 0,
              col: 6,
              text: 'red',
              width: 3,
              foreground: '#f38ba8',
            },
          ],
        }),
        dispose: vi.fn(),
      }),
    })
    const createResult = requireResult(bridge.createDriver(createEvent()))

    expect(bridge.readSnapshot({ driverId: createResult.driverId })).toEqual({
      ok: true,
      result: {
        rows: ['plain red'],
        cursor: {
          rowIndex: 0,
          columnOffset: 9,
        },
        cells: [
          {
            row: 0,
            col: 6,
            text: 'red',
            width: 3,
            foreground: '#f38ba8',
          },
        ],
      },
    })
  })

  test('rejects oversized native terminal dimensions before resize', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const createResult = requireResult(bridge.createDriver(createEvent()))

    expect(
      bridge.resize({
        driverId: createResult.driverId,
        size: { cols: 1001, rows: 24 },
      })
    ).toEqual({
      ok: false,
      error: 'Ghostty native render-state size is invalid',
    })
    expect(terminals[0]?.resize).not.toHaveBeenCalled()
  })

  test('returns ipc failures when cached native callback throws', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<GhosttyNativeBindings['createTerminal']> => {
        throw new Error('native create failed')
      },
    })

    expect(bridge.createDriver(createEvent())).toEqual({
      ok: false,
      error: 'native create failed',
    })
  })

  test('removes the web contents destroyed listener when disposing a driver', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))
    const once = event.sender.once

    if (!once) {
      throw new Error('Expected test event to support destroyed listeners')
    }

    const listener = vi.mocked(once).mock.calls[0]?.[1]

    expect(listener).toBeDefined()

    expect(bridge.dispose({ driverId: createResult.driverId })).toEqual({
      ok: true,
      result: null,
    })

    expect(event.sender.removeListener).toHaveBeenCalledWith(
      'destroyed',
      listener
    )
    expect(terminals[0]?.dispose).toHaveBeenCalledOnce()
  })

  test('rejects invalid native snapshots at the bridge boundary', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: (): {
          rows: number
          cursorRow: number
          cursorCol: number
          visibleLines: readonly { row: number; text: string }[]
        } => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 0,
          visibleLines: [{ row: 4, text: 'outside viewport' }],
        }),
        dispose: vi.fn(),
      }),
    })
    const createResult = requireResult(bridge.createDriver(createEvent()))

    expect(bridge.readSnapshot({ driverId: createResult.driverId })).toEqual({
      ok: false,
      error: 'Ghostty native render-state snapshot rows are invalid',
    })
  })

  test('installs and removes synchronous IPC handlers', () => {
    const { bindings } = createNativeBindings()
    const ipcMain = createIpcMain()

    const dispose = setupGhosttyRenderStateIpc({
      appRoot: '/app',
      ipcMain,
      nativeBindings: bindings,
    })
    const event = createEvent()

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_STATUS)?.(event)
    expect(event.returnValue).toEqual({ ok: true, result: null })

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_CREATE)?.(event)

    const createResult = event.returnValue as {
      ok: true
      result: { driverId: string }
    }
    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_WRITE_BYTES)?.(event, {
      driverId: createResult.result.driverId,
      bytes: new Uint8Array([0x68]),
    })

    expect(event.returnValue).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_READ_SNAPSHOT)?.(event, {
      driverId: createResult.result.driverId,
    })

    expect(event.returnValue).toEqual(expect.objectContaining({ ok: true }))

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_RESIZE)?.(event, {
      driverId: createResult.result.driverId,
      size: { cols: 100, rows: 30 },
    })
    expect(event.returnValue).toEqual({ ok: true, result: null })
    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_RESET)?.(event, {
      driverId: createResult.result.driverId,
    })
    expect(event.returnValue).toEqual({ ok: true, result: null })
    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_DISPOSE)?.(event, {
      driverId: createResult.result.driverId,
    })
    expect(event.returnValue).toEqual({ ok: true, result: null })

    dispose()

    expect(ipcMain.handlers.size).toBe(0)
  })
})
