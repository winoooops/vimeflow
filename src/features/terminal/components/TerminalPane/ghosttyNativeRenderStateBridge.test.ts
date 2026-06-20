// cspell:ignore ghostty libghostty
import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  BackendApi,
  GhosttyRenderStateBridgeEffects,
  GhosttyRenderStateBridgeDriver,
} from '../../../../lib/backend'
import {
  assertGhosttyNativeRenderStateBridgeAvailable,
  createGhosttyNativeRenderStateDriver,
  GHOSTTY_NATIVE_RENDER_STATE_DRIVER_PROVIDER_ID,
} from './ghosttyNativeRenderStateBridge'

const TRUE_COLOR_PINK_HEX = ['#', 'f38ba8'].join('')
const TRUE_COLOR_BASE_HEX = ['#', '181825'].join('')

const installBridge = (
  bridge: NonNullable<BackendApi['ghosttyRenderState']>,
  loadError?: string
): void => {
  Object.defineProperty(window, 'vimeflow', {
    configurable: true,
    value: {
      invoke: vi.fn(),
      listen: vi.fn(),
      ghosttyRenderState: bridge,
      ...(loadError === undefined
        ? {}
        : { ghosttyRenderStateLoadError: loadError }),
    } satisfies BackendApi,
  })
}

interface TestNativeBridgeDriver extends GhosttyRenderStateBridgeDriver {
  emitCwd: () => void
}

afterEach(() => {
  Reflect.deleteProperty(window, 'vimeflow')
  vi.clearAllMocks()
})

describe('ghosttyNativeRenderStateBridge', () => {
  test('uses the native provider id selected by the environment gate', () => {
    expect(GHOSTTY_NATIVE_RENDER_STATE_DRIVER_PROVIDER_ID).toBe('native')
  })

  test('fails closed when the preload bridge is unavailable', () => {
    expect(assertGhosttyNativeRenderStateBridgeAvailable).toThrow(
      'Ghostty native render-state bridge is unavailable'
    )
  })

  test('includes preload bridge load errors in the fail-closed message', () => {
    Object.defineProperty(window, 'vimeflow', {
      configurable: true,
      value: {
        invoke: vi.fn(),
        listen: vi.fn(),
        ghosttyRenderStateLoadError: 'dlopen failed',
      } satisfies BackendApi,
    })

    expect(assertGhosttyNativeRenderStateBridgeAvailable).toThrow(
      'dlopen failed'
    )
  })

  test('adapts native bytes, snapshots, lifecycle, and OSC7 effects', () => {
    const writeBytes = vi.fn()
    const reset = vi.fn()
    const resize = vi.fn()
    const dispose = vi.fn()
    const onCwdChange = vi.fn()
    let createdNativeDriver: TestNativeBridgeDriver | null = null

    const requireCreatedNativeDriver = (): TestNativeBridgeDriver => {
      if (!createdNativeDriver) {
        throw new Error('Expected native driver to be created')
      }

      return createdNativeDriver
    }

    const bridgeCreateDriver = vi.fn(
      (effects: GhosttyRenderStateBridgeEffects): TestNativeBridgeDriver => {
        const nativeDriver: TestNativeBridgeDriver = {
          writeBytes,
          readSnapshot: (): unknown => ({
            rows: ['native prompt', 'native output'],
            cursor: {
              rowIndex: 1,
              columnOffset: 6,
            },
            cells: [
              {
                row: 0,
                col: 0,
                text: 'n',
                width: 1,
                foreground: TRUE_COLOR_PINK_HEX,
                background: TRUE_COLOR_BASE_HEX,
              },
            ],
          }),
          reset,
          resize,
          dispose,
          emitCwd: (): void => {
            effects.onCwdChange('file://localhost/tmp/native-ghostty')
          },
        }

        createdNativeDriver = nativeDriver

        return nativeDriver
      }
    )

    installBridge({
      createDriver: bridgeCreateDriver,
    })

    const driver = createGhosttyNativeRenderStateDriver({ onCwdChange })
    const bytes = new Uint8Array([0xff, 0xfe, 0x67])

    driver.writeBytes(bytes)
    driver.resize?.({ cols: 120, rows: 32 })
    driver.reset?.()
    driver.dispose?.()

    requireCreatedNativeDriver().emitCwd()

    expect(writeBytes).toHaveBeenCalledWith(bytes)
    expect(driver.readSnapshot()).toEqual({
      rows: ['native prompt', 'native output'],
      cursor: {
        rowIndex: 1,
        columnOffset: 6,
      },
      cells: [
        {
          row: 0,
          col: 0,
          text: 'n',
          width: 1,
          foreground: TRUE_COLOR_PINK_HEX,
          background: TRUE_COLOR_BASE_HEX,
        },
      ],
    })
    expect(resize).toHaveBeenCalledWith({ cols: 120, rows: 32 })
    expect(reset).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(onCwdChange).toHaveBeenCalledWith(
      'file://localhost/tmp/native-ghostty'
    )
  })

  test('rejects malformed native render snapshots', () => {
    installBridge({
      createDriver: () => ({
        writeBytes: vi.fn(),
        readSnapshot: (): unknown => ({
          rows: ['native prompt'],
          cursor: {
            rowIndex: -1,
            columnOffset: 0,
          },
        }),
      }),
    })

    const driver = createGhosttyNativeRenderStateDriver({
      onCwdChange: vi.fn(),
    })

    expect(() => driver.readSnapshot()).toThrow(
      'Ghostty native render-state snapshot cursor is invalid'
    )
  })

  test('rejects cursor rows outside the normalized rows', () => {
    installBridge({
      createDriver: () => ({
        writeBytes: vi.fn(),
        readSnapshot: (): unknown => ({
          rows: ['native prompt'],
          cursor: {
            rowIndex: 1,
            columnOffset: 0,
          },
        }),
      }),
    })

    const driver = createGhosttyNativeRenderStateDriver({
      onCwdChange: vi.fn(),
    })

    expect(() => driver.readSnapshot()).toThrow(
      'Ghostty native render-state snapshot cursor is invalid'
    )
  })

  test('rejects malformed native render snapshot cells', () => {
    installBridge({
      createDriver: () => ({
        writeBytes: vi.fn(),
        readSnapshot: (): unknown => ({
          rows: ['native prompt'],
          cells: [
            {
              row: 4,
              col: 0,
              text: 'x',
              width: 1,
            },
          ],
        }),
      }),
    })

    const driver = createGhosttyNativeRenderStateDriver({
      onCwdChange: vi.fn(),
    })

    expect(() => driver.readSnapshot()).toThrow(
      'Ghostty native render-state snapshot cells are invalid'
    )
  })
})
