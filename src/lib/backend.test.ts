import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AgentRenameError,
  invoke,
  listen,
  listenCommandPaletteToggle,
  renameAgentSession,
  type BackendApi,
  __resetBackendEventSubscriptions,
} from './backend'

const noop = (): void => undefined

afterEach(() => {
  __resetBackendEventSubscriptions()
})

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
    window.localStorage.clear()
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

  test('renameAgentSession wraps structured backend errors', async () => {
    mockInvoke.mockRejectedValueOnce({
      message: 'no live agent in pty pty-1 to rename',
      reason: 'no-live-agent',
    })

    await expect(renameAgentSession('pty-1', 'title')).rejects.toMatchObject({
      name: 'AgentRenameError',
      message: 'no live agent in pty pty-1 to rename',
      reason: 'no-live-agent',
    } satisfies Partial<AgentRenameError>)
  })

  test('renameAgentSession threads trace ids when tracing is enabled', async () => {
    window.localStorage.setItem('vimeflow.tracing.enabled', 'true')
    mockInvoke.mockResolvedValue(null)

    await renameAgentSession('pty-1', 'new name')

    const traceRequest = mockInvoke.mock.calls[0]?.[1] as
      | { correlationId?: string; spanId?: string }
      | undefined
    expect(mockInvoke.mock.calls[0]?.[0]).toBe('trace_user_interaction')
    expect(traceRequest).toMatchObject({
      event: 'pane.rename',
      sessionId: 'pty-1',
      attributes: {
        titleLength: '8',
      },
    })

    const renameRequest = mockInvoke.mock.calls[1]?.[1]
    expect(mockInvoke.mock.calls[1]?.[0]).toBe('rename_agent_session')
    expect(renameRequest).toMatchObject({
      ptyId: 'pty-1',
      title: 'new name',
      correlationId: traceRequest?.correlationId,
      parentSpanId: traceRequest?.spanId,
    })
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

    unlisten()
  })

  test('listen callback receives bare payload', async () => {
    const rawUnlisten = vi.fn()
    mockListen.mockImplementationOnce(
      (
        _event: string,
        cb: (payload: { sessionId: string; data: string }) => void
      ): Promise<() => void> => {
        cb({ sessionId: 's1', data: 'hi' })

        return Promise.resolve(rawUnlisten)
      }
    )
    const cb = vi.fn()

    const unlisten = await listen<{ sessionId: string; data: string }>(
      'pty-data',
      cb
    )

    expect(cb).toHaveBeenCalledWith({ sessionId: 's1', data: 'hi' })

    unlisten()
  })

  test('listen resolves only after window.vimeflow.listen resolves', async () => {
    let resolveTransport!: (unlisten: () => void) => void
    const rawUnlisten = vi.fn()
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
    resolveTransport(rawUnlisten)
    const unlisten = await bridgePromise
    await resolutionPromise
    expect(resolved).toBe(true)

    unlisten()
  })

  test('listen shares one bridge listener per backend event', async () => {
    let bridgeCallback!: (payload: { value: string }) => void
    const rawUnlisten = vi.fn()
    mockListen.mockImplementationOnce(
      (
        _event: string,
        cb: (payload: { value: string }) => void
      ): Promise<() => void> => {
        bridgeCallback = cb

        return Promise.resolve(rawUnlisten)
      }
    )
    const first = vi.fn()
    const second = vi.fn()

    const unlistenFirst = await listen<{ value: string }>('shared-event', first)

    const unlistenSecond = await listen<{ value: string }>(
      'shared-event',
      second
    )

    expect(mockListen).toHaveBeenCalledTimes(1)

    bridgeCallback({ value: 'first-payload' })
    expect(first).toHaveBeenCalledWith({ value: 'first-payload' })
    expect(second).toHaveBeenCalledWith({ value: 'first-payload' })

    unlistenFirst()
    bridgeCallback({ value: 'second-payload' })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledWith({ value: 'second-payload' })
    expect(rawUnlisten).not.toHaveBeenCalled()

    unlistenSecond()
    expect(rawUnlisten).toHaveBeenCalledTimes(1)
  })

  test('listen shares an in-flight bridge attachment for same-event subscribers', async () => {
    let resolveTransport!: (unlisten: () => void) => void
    const rawUnlisten = vi.fn()
    mockListen.mockReturnValueOnce(
      new Promise<() => void>((resolve) => {
        resolveTransport = resolve
      })
    )

    const firstPromise = listen('pending-event', noop)
    const secondPromise = listen('pending-event', noop)

    expect(mockListen).toHaveBeenCalledTimes(1)

    resolveTransport(rawUnlisten)

    const [unlistenFirst, unlistenSecond] = await Promise.all([
      firstPromise,
      secondPromise,
    ])

    unlistenFirst()
    expect(rawUnlisten).not.toHaveBeenCalled()

    unlistenSecond()
    expect(rawUnlisten).toHaveBeenCalledTimes(1)
  })

  test('listen retries bridge attachment after rejection instead of reusing failed subscription', async () => {
    mockListen.mockRejectedValueOnce(new Error('bridge attach failed'))

    await expect(listen('retry-event', noop)).rejects.toThrow(
      'bridge attach failed'
    )

    const rawUnlisten = vi.fn()
    mockListen.mockResolvedValueOnce(rawUnlisten)

    const cb = vi.fn()
    const unlisten = await listen('retry-event', cb)

    expect(mockListen).toHaveBeenCalledTimes(2)
    expect(typeof unlisten).toBe('function')

    unlisten()
  })

  test('UnlistenFn is idempotent', async () => {
    const rawUnlisten = vi.fn()
    mockListen.mockResolvedValueOnce(rawUnlisten)

    const unlisten = await listen('x', noop)
    unlisten()
    unlisten()

    expect(rawUnlisten).toHaveBeenCalledTimes(1)
  })

  test('listenCommandPaletteToggle delegates to optional bridge hook', () => {
    const rawUnlisten = vi.fn()
    const callback = vi.fn()
    const onCommandPaletteToggle = vi.fn(() => rawUnlisten)

    window.vimeflow = {
      invoke: mockInvoke,
      listen: mockListen,
      onCommandPaletteToggle,
    } as unknown as BackendApi

    const unlisten = listenCommandPaletteToggle(callback)

    expect(onCommandPaletteToggle).toHaveBeenCalledWith(callback)

    unlisten()
    expect(rawUnlisten).toHaveBeenCalledOnce()
  })

  test('listenCommandPaletteToggle is a no-op when bridge hook is absent', () => {
    const callback = vi.fn()
    const unlisten = listenCommandPaletteToggle(callback)

    expect(() => {
      unlisten()
    }).not.toThrow()
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

  test('listenCommandPaletteToggle is a no-op when bridge is unset', () => {
    const callback = vi.fn()
    const unlisten = listenCommandPaletteToggle(callback)

    expect(() => {
      unlisten()
    }).not.toThrow()
  })
})
