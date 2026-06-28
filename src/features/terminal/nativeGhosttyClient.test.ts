// cspell:ignore Ghostty ghostty
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ITerminalService } from './services/terminalService'
import {
  attachNativeGhosttyOutput,
  type NativeGhosttyApi,
} from './nativeGhosttyClient'

type DataListener = (
  sessionId: string,
  data: string,
  offsetStart: number,
  byteLen: number
) => void

const createService = (): {
  listener: { current: DataListener | null }
  service: ITerminalService
  unsubscribe: ReturnType<typeof vi.fn>
} => {
  const listener: { current: DataListener | null } = { current: null }
  const unsubscribe = vi.fn()

  const service = {
    onData: vi.fn((nextListener: DataListener) => {
      listener.current = nextListener

      return Promise.resolve(unsubscribe)
    }),
  } as unknown as ITerminalService

  return { listener, service, unsubscribe }
}

describe('nativeGhosttyClient', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  test('reports unavailable when output forwarding IPC rejects', async () => {
    const api: NativeGhosttyApi = {
      update: vi.fn(() => Promise.resolve({})),
      data: vi.fn(() => Promise.reject(new Error('ipc unavailable'))),
      focus: vi.fn(() => Promise.resolve({})),
      destroy: vi.fn(() => Promise.resolve({})),
    }
    vi.stubGlobal('window', { vimeflow: { ghosttyNative: api } })
    const { listener, service } = createService()
    const onUnavailable = vi.fn()

    await attachNativeGhosttyOutput(
      service,
      { sessionId: 'pty-1', paneId: 'pane-1' },
      { onUnavailable }
    )

    listener.current?.('pty-1', 'live output', 0, 11)

    await vi.waitFor(() => {
      expect(onUnavailable).toHaveBeenCalledTimes(1)
    })
  })
})
