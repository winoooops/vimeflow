// cspell:ignore ghostty
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  GHOSTTY_RENDER_STATE_CREATE,
  GHOSTTY_RENDER_STATE_DISPOSE,
  GHOSTTY_RENDER_STATE_READ_SNAPSHOT,
  GHOSTTY_RENDER_STATE_RESET,
  GHOSTTY_RENDER_STATE_RESIZE,
  GHOSTTY_RENDER_STATE_STATUS,
  GHOSTTY_RENDER_STATE_WRITE_BYTES,
} from './ghostty-render-state-channels'

const electronMock = vi.hoisted(() => ({
  ipcRenderer: {
    sendSync: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  ipcRenderer: electronMock.ipcRenderer,
}))

const importPreloadBridge = async (): Promise<
  typeof import('./ghostty-render-state-preload')
> => import('./ghostty-render-state-preload')

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('ghostty render-state preload bridge', () => {
  test('exposes a bridge only when main reports native state is available', async () => {
    electronMock.ipcRenderer.sendSync.mockReturnValueOnce({
      ok: true,
      result: null,
    })

    const { loadOptionalGhosttyRenderStateBridge } = await importPreloadBridge()

    expect(loadOptionalGhosttyRenderStateBridge()).toEqual({
      bridge: expect.objectContaining({
        createDriver: expect.any(Function),
      }),
    })

    expect(electronMock.ipcRenderer.sendSync).toHaveBeenCalledWith(
      GHOSTTY_RENDER_STATE_STATUS,
      undefined
    )
  })

  test('returns the main-process load error when native state is unavailable', async () => {
    electronMock.ipcRenderer.sendSync.mockReturnValueOnce({
      ok: false,
      error: 'native prebuild missing',
    })

    const { loadOptionalGhosttyRenderStateBridge } = await importPreloadBridge()

    expect(loadOptionalGhosttyRenderStateBridge()).toEqual({
      error: 'native prebuild missing',
    })
  })

  test('proxies driver lifecycle and emits cwd effects synchronously', async () => {
    electronMock.ipcRenderer.sendSync.mockImplementation((channel) => {
      if (channel === GHOSTTY_RENDER_STATE_CREATE) {
        return { ok: true, result: { driverId: 'driver-1' } }
      }

      if (channel === GHOSTTY_RENDER_STATE_WRITE_BYTES) {
        return {
          ok: true,
          result: {
            events: [{ type: 'cwd', uri: 'file://localhost/tmp' }],
          },
        }
      }

      if (channel === GHOSTTY_RENDER_STATE_READ_SNAPSHOT) {
        return {
          ok: true,
          result: {
            rows: ['prompt'],
            cursor: { rowIndex: 0, columnOffset: 6 },
          },
        }
      }

      return { ok: true, result: null }
    })

    const { createGhosttyRenderStateBridgeFromIpc } =
      await importPreloadBridge()
    const onCwdChange = vi.fn()

    const driver = createGhosttyRenderStateBridgeFromIpc().createDriver({
      onCwdChange,
    })
    const bytes = new Uint8Array([0x68])

    driver.writeBytes(bytes)
    driver.resize({ cols: 120, rows: 32 })
    driver.reset()
    expect(driver.readSnapshot()).toEqual({
      rows: ['prompt'],
      cursor: { rowIndex: 0, columnOffset: 6 },
    })
    driver.dispose()
    driver.dispose()

    expect(onCwdChange).toHaveBeenCalledWith('file://localhost/tmp')
    expect(electronMock.ipcRenderer.sendSync).toHaveBeenCalledWith(
      GHOSTTY_RENDER_STATE_WRITE_BYTES,
      {
        driverId: 'driver-1',
        bytes,
      }
    )

    expect(electronMock.ipcRenderer.sendSync).toHaveBeenCalledWith(
      GHOSTTY_RENDER_STATE_RESIZE,
      {
        driverId: 'driver-1',
        size: { cols: 120, rows: 32 },
      }
    )

    expect(electronMock.ipcRenderer.sendSync).toHaveBeenCalledWith(
      GHOSTTY_RENDER_STATE_RESET,
      { driverId: 'driver-1' }
    )

    expect(electronMock.ipcRenderer.sendSync).toHaveBeenCalledWith(
      GHOSTTY_RENDER_STATE_READ_SNAPSHOT,
      { driverId: 'driver-1' }
    )

    expect(electronMock.ipcRenderer.sendSync).toHaveBeenCalledWith(
      GHOSTTY_RENDER_STATE_DISPOSE,
      { driverId: 'driver-1' }
    )

    expect(
      electronMock.ipcRenderer.sendSync.mock.calls.filter(
        ([channel]) => channel === GHOSTTY_RENDER_STATE_DISPOSE
      )
    ).toHaveLength(1)
  })
})
