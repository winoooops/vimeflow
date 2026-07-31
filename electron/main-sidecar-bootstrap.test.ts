// cspell:ignore ghostty
import { describe, expect, test, vi } from 'vitest'
import { spawnSidecarWithPtyTransport } from './main-sidecar-bootstrap'
import type { Sidecar } from './sidecar'

describe('spawnSidecarWithPtyTransport', () => {
  test('creates transport before sidecar spawn and notifies after spawn', () => {
    const order: string[] = []

    const sidecar = {
      invoke: vi.fn(),
      onEvent: vi.fn(),
      shutdown: vi.fn(),
    } as unknown as Sidecar

    const createTransport = vi.fn(() => {
      order.push('create')

      return {
        transportFd: 7,
        onSpawned: (): void => {
          order.push('notify')
        },
      }
    })

    const spawn = vi.fn(() => {
      order.push('spawn')

      return sidecar
    })

    expect(
      spawnSidecarWithPtyTransport({
        binary: '/bin/backend',
        appDataDir: '/tmp/app',
        ghosttyNativeParentEnabled: true,
        isPackaged: true,
        resourcesPath: '/resources',
        createTransport,
        spawn,
      })
    ).toBe(sidecar)

    expect(order).toEqual(['create', 'spawn', 'notify'])
    expect(createTransport).toHaveBeenCalledWith(true, '/resources')
    expect(spawn).toHaveBeenCalledWith({
      binary: '/bin/backend',
      appDataDir: '/tmp/app',
      transportFd: 7,
    })
  })

  test('skips transport bootstrap when native parent is disabled', () => {
    const sidecar = {
      invoke: vi.fn(),
      onEvent: vi.fn(),
      shutdown: vi.fn(),
    } as unknown as Sidecar
    const createTransport = vi.fn()
    const spawn = vi.fn(() => sidecar)

    spawnSidecarWithPtyTransport({
      binary: '/bin/backend',
      appDataDir: '/tmp/app',
      ghosttyNativeParentEnabled: false,
      isPackaged: false,
      resourcesPath: '',
      createTransport,
      spawn,
    })

    expect(createTransport).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenCalledWith({
      binary: '/bin/backend',
      appDataDir: '/tmp/app',
    })
  })
})
