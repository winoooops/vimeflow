import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { invoke, listen, type BackendApi } from './backend'

const noop = (): void => undefined

const observeResolution = async (
  promise: Promise<unknown>,
  onResolve: () => void
): Promise<void> => {
  await promise
  onResolve()
}

describe('backend (window.vimeflow bridge)', () => {
  let mockInvoke: ReturnType<typeof vi.fn>
  let mockListen: ReturnType<typeof vi.fn>

  beforeEach(() => {
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

  test('UnlistenFn is idempotent', async () => {
    const rawUnlisten = vi.fn()
    mockListen.mockResolvedValueOnce(rawUnlisten)

    const unlisten = await listen('x', noop)
    unlisten()
    unlisten()

    expect(rawUnlisten).toHaveBeenCalledTimes(1)
  })
})

describe('backend (missing bridge)', () => {
  beforeEach(() => {
    delete window.vimeflow
  })

  test('invoke throws a descriptive Error when window.vimeflow is unset', async () => {
    await expect(invoke('list_sessions')).rejects.toThrow(
      'window.vimeflow is not available'
    )
  })

  test('listen throws a descriptive Error when window.vimeflow is unset', async () => {
    await expect(listen('x', noop)).rejects.toThrow(
      'window.vimeflow is not available'
    )
  })
})
