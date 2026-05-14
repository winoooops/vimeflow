import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'
import { invoke, listen, type BackendApi } from './backend'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

const mockedTauriInvoke = vi.mocked(tauriInvoke)
const mockedTauriListen = vi.mocked(tauriListen)
const noop = (): void => undefined

const observeResolution = async (
  promise: Promise<unknown>,
  onResolve: () => void
): Promise<void> => {
  await promise
  onResolve()
}

describe('backend (window.vimeflow path)', () => {
  let mockInvoke: ReturnType<typeof vi.fn>
  let mockListen: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockedTauriInvoke.mockReset()
    mockedTauriListen.mockReset()
    mockInvoke = vi.fn()
    mockListen = vi.fn()
    window.vimeflow = {
      invoke: mockInvoke,
      listen: mockListen,
    } as unknown as BackendApi
  })

  afterEach(() => {
    delete window.vimeflow
  })

  test('invoke delegates to window.vimeflow.invoke with same args', async () => {
    mockInvoke.mockResolvedValueOnce({ id: 'abc' })

    const result = await invoke<{ id: string }>('spawn_pty', {
      sessionId: 's1',
    })

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith('spawn_pty', { sessionId: 's1' })
    expect(result).toEqual({ id: 'abc' })
    expect(mockedTauriInvoke).not.toHaveBeenCalled()
  })

  test('invoke rejection passes through unchanged', async () => {
    mockInvoke.mockRejectedValueOnce('sidecar error')

    await expect(invoke('git_status', { cwd: '/x' })).rejects.toBe(
      'sidecar error'
    )
  })

  test('listen delegates to window.vimeflow.listen', async () => {
    const rawUnlisten = vi.fn()
    mockListen.mockResolvedValueOnce(rawUnlisten)

    const unlisten = await listen<{ a: number }>('agent-status', noop)

    expect(mockListen).toHaveBeenCalledTimes(1)
    expect(mockListen).toHaveBeenCalledWith(
      'agent-status',
      expect.any(Function)
    )
    expect(typeof unlisten).toBe('function')
  })

  test('listen callback receives bare payload', async () => {
    mockListen.mockImplementationOnce(
      (
        _event: string,
        cb: (payload: { sessionId: string; data: string }) => void
      ): Promise<() => void> => {
        cb({ sessionId: 's1', data: 'hi' })

        return Promise.resolve(vi.fn())
      }
    )
    const cb = vi.fn()

    await listen<{ sessionId: string; data: string }>('pty-data', cb)

    expect(cb).toHaveBeenCalledWith({ sessionId: 's1', data: 'hi' })
  })

  test('listen resolves only after window.vimeflow.listen resolves', async () => {
    let resolveTransport!: (unlisten: () => void) => void
    mockListen.mockReturnValueOnce(
      new Promise<() => void>((resolve) => {
        resolveTransport = resolve
      })
    )

    const bridgePromise = listen('x', noop)
    let resolved = false

    const resolutionPromise = observeResolution(bridgePromise, () => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)
    resolveTransport(vi.fn())
    await bridgePromise
    await resolutionPromise
    expect(resolved).toBe(true)
  })

  test('UnlistenFn from window.vimeflow path is idempotent', async () => {
    const rawUnlisten = vi.fn()
    mockListen.mockResolvedValueOnce(rawUnlisten)

    const unlisten = await listen('x', noop)
    unlisten()
    unlisten()

    expect(rawUnlisten).toHaveBeenCalledTimes(1)
  })
})

describe('backend (@tauri-apps fallback path)', () => {
  beforeEach(() => {
    mockedTauriInvoke.mockReset()
    mockedTauriListen.mockReset()
    delete window.vimeflow
  })

  test('invoke delegates to tauriInvoke when window.vimeflow is unset', async () => {
    mockedTauriInvoke.mockResolvedValueOnce({ ok: true })

    const result = await invoke<{ ok: boolean }>('list_sessions')

    expect(mockedTauriInvoke).toHaveBeenCalledTimes(1)
    expect(mockedTauriInvoke).toHaveBeenCalledWith('list_sessions', undefined)
    expect(result).toEqual({ ok: true })
  })

  test('invoke rejection passes through tauri string error unchanged', async () => {
    mockedTauriInvoke.mockRejectedValueOnce('PTY session not found')

    await expect(invoke('write_pty', { id: 'x' })).rejects.toBe(
      'PTY session not found'
    )
  })

  test('listen unwraps Event<T>.payload on the Tauri callback', async () => {
    mockedTauriListen.mockImplementationOnce((_name, cb) => {
      cb({
        event: 'pty-data',
        id: 0,
        payload: { sessionId: 's1', data: 'hi' },
        windowLabel: '',
      } as unknown as Parameters<typeof cb>[0])

      return Promise.resolve(vi.fn())
    })
    const cb = vi.fn()

    await listen<{ sessionId: string; data: string }>('pty-data', cb)

    expect(cb).toHaveBeenCalledWith({ sessionId: 's1', data: 'hi' })
  })

  test('UnlistenFn calls through to tauriListen-resolved unlisten', async () => {
    const rawUnlisten = vi.fn()
    mockedTauriListen.mockResolvedValueOnce(rawUnlisten)

    const unlisten = await listen('pty-exit', noop)
    unlisten()

    expect(rawUnlisten).toHaveBeenCalledTimes(1)
  })

  test('UnlistenFn from fallback path is idempotent', async () => {
    const rawUnlisten = vi.fn()
    mockedTauriListen.mockResolvedValueOnce(rawUnlisten)

    const unlisten = await listen('x', noop)
    unlisten()
    unlisten()

    expect(rawUnlisten).toHaveBeenCalledTimes(1)
  })

  test('listen resolves only after tauriListen resolves (attach-before-resolve)', async () => {
    let resolveTransport!: (unlisten: () => void) => void
    mockedTauriListen.mockReturnValueOnce(
      new Promise<() => void>((resolve) => {
        resolveTransport = resolve
      })
    )

    const bridgePromise = listen('x', noop)
    let resolved = false

    const resolutionPromise = observeResolution(bridgePromise, () => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)
    resolveTransport(vi.fn())
    await bridgePromise
    await resolutionPromise
    expect(resolved).toBe(true)
  })
})
