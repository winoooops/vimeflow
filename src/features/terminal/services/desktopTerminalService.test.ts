import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest'
import { DesktopTerminalService } from './desktopTerminalService'
import { invoke, listen } from '../../../lib/backend'

// Mock backend bridge — capture listener callbacks for testing.
type EventCallback = (payload: unknown) => void
const eventListeners = new Map<string, EventCallback[]>()

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
  listen: vi.fn(
    (eventName: string, callback: EventCallback): Promise<() => void> => {
      const existing = eventListeners.get(eventName) ?? []
      existing.push(callback)
      eventListeners.set(eventName, existing)

      return Promise.resolve(() => {
        const cbs = eventListeners.get(eventName) ?? []
        const index = cbs.indexOf(callback)
        if (index > -1) {
          cbs.splice(index, 1)
        }
      })
    }
  ),
}))

/**
 * Simulate a backend event emission for testing
 */
const emitDesktopEvent = (eventName: string, payload: unknown): void => {
  const callbacks = eventListeners.get(eventName) ?? []
  callbacks.forEach((cb) => cb(payload))
}

/** Mock invoke to return a spawn response, then spawn a session */
const mockSpawnAndInit = async (
  service: DesktopTerminalService
): Promise<void> => {
  const mockInvoke = invoke as Mock
  mockInvoke.mockResolvedValueOnce({ id: 's1', pid: 1, cwd: '/' })
  await service.spawn({ cwd: '/' })
}

/** Mock invoke to return a specific response */
const mockInvokeOnce = (value: unknown): void => {
  const mockInvoke = invoke as Mock
  mockInvoke.mockResolvedValueOnce(value)
}

describe('DesktopTerminalService', () => {
  let service: DesktopTerminalService

  beforeEach(() => {
    vi.clearAllMocks()
    eventListeners.clear()
    service = new DesktopTerminalService()
  })

  describe('spawn', () => {
    test('invokes spawn_pty with correct request', async () => {
      mockInvokeOnce({
        id: 'test-session-id',
        pid: 12345,
        cwd: '/home/user',
      })

      const result = await service.spawn({
        cwd: '/home/user',
        shell: '/bin/bash',
        env: { TERM: 'xterm-256color' },
      })

      expect(invoke).toHaveBeenCalledWith('spawn_pty', {
        request: expect.objectContaining({
          cwd: '/home/user',
          shell: '/bin/bash',
          env: { TERM: 'xterm-256color' },
        }),
      })
      expect(result.sessionId).toBe('test-session-id')
      expect(result.pid).toBe(12345)
    })

    test('generates a UUID sessionId in the request', async () => {
      mockInvokeOnce({ id: 'returned-id', pid: 100, cwd: '/tmp' })
      await service.spawn({ cwd: '/tmp' })

      const call = (invoke as Mock).mock.calls[0] as [
        string,
        { request: { sessionId: string } },
      ]
      const { sessionId } = call[1].request

      expect(sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
    })

    test('sets up event listeners on first spawn', async () => {
      mockInvokeOnce({ id: 's1', pid: 1, cwd: '/' })
      await service.spawn({ cwd: '/' })

      expect(eventListeners.has('pty-data')).toBe(true)
      expect(eventListeners.has('pty-exit')).toBe(true)
      expect(eventListeners.has('pty-error')).toBe(true)
    })

    // Round 8, Finding 3 (claude MEDIUM): the agent bridge creates a
    // `.vimeflow/sessions/<uuid>/` tree in the spawn cwd. This was previously
    // hardcoded `true`, which polluted ad-hoc spawns (tests, scripts, third-
    // party project roots) with bookkeeping directories that surfaced in
    // `git status`. The flag now defaults to `false` and only the workspace
    // UI's `useSessionManager` opts in.
    test('round 8 F3: spawn forwards enableAgentBridge=true when caller opts in', async () => {
      mockInvokeOnce({ id: 's1', pid: 1, cwd: '/home/user' })
      await service.spawn({ cwd: '/home/user', enableAgentBridge: true })

      expect(invoke).toHaveBeenCalledWith('spawn_pty', {
        request: expect.objectContaining({ enableAgentBridge: true }),
      })
    })

    test('round 8 F3: spawn defaults enableAgentBridge to false when caller omits it', async () => {
      mockInvokeOnce({ id: 's1', pid: 1, cwd: '/tmp' })
      await service.spawn({ cwd: '/tmp' })

      expect(invoke).toHaveBeenCalledWith('spawn_pty', {
        request: expect.objectContaining({ enableAgentBridge: false }),
      })
    })

    test('round 8 F3: spawn forwards enableAgentBridge=false when caller explicitly opts out', async () => {
      mockInvokeOnce({ id: 's1', pid: 1, cwd: '/tmp' })
      await service.spawn({ cwd: '/tmp', enableAgentBridge: false })

      expect(invoke).toHaveBeenCalledWith('spawn_pty', {
        request: expect.objectContaining({ enableAgentBridge: false }),
      })
    })
  })

  describe('write', () => {
    test('invokes write_pty with sessionId and data', async () => {
      mockInvokeOnce(undefined)
      await service.write({ sessionId: 'sess-1', data: 'ls -la\n' })

      expect(invoke).toHaveBeenCalledWith('write_pty', {
        request: { sessionId: 'sess-1', data: 'ls -la\n' },
      })
    })
  })

  describe('resize', () => {
    test('invokes resize_pty with dimensions', async () => {
      mockInvokeOnce(undefined)
      await service.resize({ sessionId: 'sess-1', rows: 40, cols: 120 })

      expect(invoke).toHaveBeenCalledWith('resize_pty', {
        request: { sessionId: 'sess-1', rows: 40, cols: 120 },
      })
    })
  })

  describe('kill', () => {
    test('invokes kill_pty with sessionId', async () => {
      mockInvokeOnce(undefined)
      await service.kill({ sessionId: 'sess-1' })

      expect(invoke).toHaveBeenCalledWith('kill_pty', {
        request: { sessionId: 'sess-1' },
      })
    })
  })

  describe('event subscriptions', () => {
    test('onData delivers pty-data events to callback', async () => {
      const callback = vi.fn()
      await service.onData(callback)
      await mockSpawnAndInit(service)

      emitDesktopEvent('pty-data', {
        sessionId: 'sess-1',
        data: 'hello world',
        offsetStart: 0,
        byteLen: 11,
      })

      expect(callback).toHaveBeenCalledWith('sess-1', 'hello world', 0, 11)
    })

    test('onExit delivers pty-exit events to callback', async () => {
      const callback = vi.fn()
      service.onExit(callback)
      await mockSpawnAndInit(service)

      emitDesktopEvent('pty-exit', { sessionId: 'sess-1', code: 0 })

      expect(callback).toHaveBeenCalledWith('sess-1', 0)
    })

    test('onExit handles null exit code (EOF)', async () => {
      const callback = vi.fn()
      service.onExit(callback)
      await mockSpawnAndInit(service)

      emitDesktopEvent('pty-exit', { sessionId: 'sess-1', code: null })

      expect(callback).toHaveBeenCalledWith('sess-1', null)
    })

    test('onError delivers pty-error events to callback', async () => {
      const callback = vi.fn()
      service.onError(callback)
      await mockSpawnAndInit(service)

      emitDesktopEvent('pty-error', {
        sessionId: 'sess-1',
        message: 'PTY read error',
      })

      expect(callback).toHaveBeenCalledWith('sess-1', 'PTY read error')
    })

    test('unsubscribe removes callback', async () => {
      const callback = vi.fn()

      const unsubscribe = await service.onData(callback)
      await mockSpawnAndInit(service)

      unsubscribe()

      emitDesktopEvent('pty-data', {
        sessionId: 'sess-1',
        data: 'should not arrive',
      })

      expect(callback).not.toHaveBeenCalled()
    })

    test('multiple callbacks receive same event', async () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      await service.onData(cb1)
      await service.onData(cb2)
      await mockSpawnAndInit(service)

      emitDesktopEvent('pty-data', {
        sessionId: 'sess-1',
        data: 'broadcast',
        offsetStart: 100,
        byteLen: 9,
      })

      expect(cb1).toHaveBeenCalledWith('sess-1', 'broadcast', 100, 9)
      expect(cb2).toHaveBeenCalledWith('sess-1', 'broadcast', 100, 9)
    })

    test('cleans partial listeners and allows retry after init failure', async () => {
      const listenMock = vi.mocked(listen)
      const originalImpl = listenMock.getMockImplementation()
      let calls = 0

      listenMock.mockImplementation(((
        eventName: string,
        callback: EventCallback
      ): Promise<() => void> => {
        calls += 1

        if (calls === 2) {
          return Promise.reject(new Error('exit listener failed'))
        }

        const existing = eventListeners.get(eventName) ?? []
        existing.push(callback)
        eventListeners.set(eventName, existing)

        return Promise.resolve(() => {
          const cbs = eventListeners.get(eventName) ?? []
          const index = cbs.indexOf(callback)
          if (index > -1) {
            cbs.splice(index, 1)
          }
        })
      }) as typeof listen)

      const callback = vi.fn()
      await expect(service.onData(callback)).rejects.toThrow(
        'exit listener failed'
      )

      expect(eventListeners.get('pty-data')).toEqual([])

      if (originalImpl) {
        listenMock.mockImplementation(originalImpl)
      }
      mockInvokeOnce({ id: 's1', pid: 1, cwd: '/' })

      await expect(service.spawn({ cwd: '/' })).resolves.toEqual({
        sessionId: 's1',
        pid: 1,
        cwd: '/',
      })

      expect(eventListeners.get('pty-data')).toHaveLength(1)
      expect(eventListeners.get('pty-exit')).toHaveLength(1)
      expect(eventListeners.get('pty-error')).toHaveLength(1)
    })

    test('onData removes callback when listener initialization fails', async () => {
      const listenMock = vi.mocked(listen)
      const originalImpl = listenMock.getMockImplementation()

      listenMock.mockRejectedValueOnce(new Error('listener unavailable'))

      const callback = vi.fn()
      await expect(service.onData(callback)).rejects.toThrow(
        'listener unavailable'
      )

      if (originalImpl) {
        listenMock.mockImplementation(originalImpl)
      }
      mockInvokeOnce({ id: 's1', pid: 1, cwd: '/' })
      await service.spawn({ cwd: '/' })

      emitDesktopEvent('pty-data', {
        sessionId: 'sess-1',
        data: 'after retry',
        offsetStart: 0,
        byteLen: 11,
      })

      expect(callback).not.toHaveBeenCalled()
    })

    test('onExit reports listener initialization failures', async () => {
      const listenMock = vi.mocked(listen)
      const originalImpl = listenMock.getMockImplementation()

      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined)

      listenMock.mockRejectedValueOnce(new Error('listener unavailable'))

      try {
        service.onExit(vi.fn())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(warnSpy).toHaveBeenCalledWith(
          'DesktopTerminalService: failed to attach backend listeners',
          expect.any(Error)
        )
      } finally {
        warnSpy.mockRestore()
        if (originalImpl) {
          listenMock.mockImplementation(originalImpl)
        }
      }
    })

    test('onError reports listener initialization failures', async () => {
      const listenMock = vi.mocked(listen)
      const originalImpl = listenMock.getMockImplementation()

      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined)

      listenMock.mockRejectedValueOnce(new Error('listener unavailable'))

      try {
        service.onError(vi.fn())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(warnSpy).toHaveBeenCalledWith(
          'DesktopTerminalService: failed to attach backend listeners',
          expect.any(Error)
        )
      } finally {
        warnSpy.mockRestore()
        if (originalImpl) {
          listenMock.mockImplementation(originalImpl)
        }
      }
    })
  })

  describe('dispose', () => {
    test('clears all callbacks and listeners', async () => {
      const callback = vi.fn()
      await service.onData(callback)
      await mockSpawnAndInit(service)

      service.dispose()

      emitDesktopEvent('pty-data', {
        sessionId: 'sess-1',
        data: 'after dispose',
      })

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('Session Management', () => {
    test('listSessions invokes list_sessions IPC', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        activeSessionId: 'a',
        sessions: [],
      })
      vi.mocked(invoke).mockImplementation(mockInvoke)

      const testService = new DesktopTerminalService()
      const result = await testService.listSessions()

      expect(mockInvoke).toHaveBeenCalledWith('list_sessions')
      expect(result.activeSessionId).toBe('a')
    })

    test('setActiveSession invokes set_active_session with id', async () => {
      const mockInvoke = vi.fn().mockResolvedValue(undefined)
      vi.mocked(invoke).mockImplementation(mockInvoke)

      const testService = new DesktopTerminalService()
      await testService.setActiveSession('xyz')

      expect(mockInvoke).toHaveBeenCalledWith('set_active_session', {
        request: { id: 'xyz' },
      })
    })

    test('reorderSessions invokes reorder_sessions with ids', async () => {
      const mockInvoke = vi.fn().mockResolvedValue(undefined)
      vi.mocked(invoke).mockImplementation(mockInvoke)

      const testService = new DesktopTerminalService()
      await testService.reorderSessions(['a', 'b'])

      expect(mockInvoke).toHaveBeenCalledWith('reorder_sessions', {
        request: { ids: ['a', 'b'] },
      })
    })

    test('updateSessionCwd invokes update_session_cwd with id and cwd', async () => {
      const mockInvoke = vi.fn().mockResolvedValue(undefined)
      vi.mocked(invoke).mockImplementation(mockInvoke)

      const testService = new DesktopTerminalService()
      await testService.updateSessionCwd('s1', '/tmp')

      expect(mockInvoke).toHaveBeenCalledWith('update_session_cwd', {
        request: { id: 's1', cwd: '/tmp' },
      })
    })

    test('onData callback receives offsetStart from pty-data event', async () => {
      const captured: {
        sessionId: string
        data: string
        offsetStart: number
        byteLen: number
      }[] = []
      const testService = new DesktopTerminalService()
      await testService.onData((sessionId, data, offsetStart, byteLen) => {
        captured.push({ sessionId, data, offsetStart, byteLen })
      })

      await mockSpawnAndInit(testService)

      // Emit pty-data event with offsetStart as bigint (common Rust u64 binding)
      emitDesktopEvent('pty-data', {
        sessionId: 'sess-1',
        data: 'test',
        offsetStart: BigInt(42),
        byteLen: BigInt(4),
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(captured).toHaveLength(1)
      expect(captured[0].sessionId).toBe('sess-1')
      expect(captured[0].data).toBe('test')
      expect(captured[0].offsetStart).toBe(42)
      expect(captured[0].byteLen).toBe(4)
    })

    test('onData coerces bigint offsetStart and byteLen to number', async () => {
      const captured: { offset: number; byteLen: number }[] = []
      const testService = new DesktopTerminalService()
      await testService.onData((_sessionId, _data, offsetStart, byteLen) => {
        captured.push({ offset: offsetStart, byteLen })
      })

      await mockSpawnAndInit(testService)

      // Emit with bigint
      emitDesktopEvent('pty-data', {
        sessionId: 'sess-1',
        data: 'test',
        offsetStart: BigInt(1024),
        byteLen: BigInt(4),
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(captured[0].offset).toBe(1024)
      expect(typeof captured[0].offset).toBe('number')
      expect(captured[0].byteLen).toBe(4)
      expect(typeof captured[0].byteLen).toBe('number')
    })

    // F1 (round 6): byte_len from the producer is the source of truth for
    // cursor advancement. Lossy UTF-8 in `data` (invalid bytes → U+FFFD,
    // 3 bytes when re-encoded) means data.length can diverge from the
    // producer's raw byte count. Subscribers MUST receive the producer's
    // byte_len verbatim and not derive it from `data`.
    test('onData passes byteLen through verbatim even when it differs from data length', async () => {
      const captured: { data: string; byteLen: number }[] = []
      const testService = new DesktopTerminalService()
      await testService.onData((_sessionId, data, _offsetStart, byteLen) => {
        captured.push({ data, byteLen })
      })

      await mockSpawnAndInit(testService)

      // Lossy decode case: producer's raw bytes were 2 (e.g. partial UTF-8
      // codepoint), but `data` contains 2 U+FFFD which encodes back to 6
      // bytes. The subscriber must see byteLen=2 (producer truth), not 6.
      emitDesktopEvent('pty-data', {
        sessionId: 'sess-1',
        data: '��',
        offsetStart: BigInt(0),
        byteLen: BigInt(2),
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(captured).toHaveLength(1)
      expect(captured[0].byteLen).toBe(2)
      // Sanity: the encoded length of the U+FFFD pair is 6 bytes; this
      // confirms byteLen is NOT a re-derivation of data.length.
      expect(new TextEncoder().encode(captured[0].data).length).toBe(6)
    })

    // F1 regression: onData must NOT resolve until the underlying tauri.listen
    // is fully attached. Otherwise, the orchestrator's "listen before snapshot"
    // step lets PTY events fire into the void during the listen() roundtrip.
    test('F1 regression: onData await blocks until underlying listen attaches', async () => {
      // Re-import the listen mock so we can stall it
      const backendModule = await import('../../../lib/backend')
      const listenMock = vi.mocked(backendModule.listen)

      // Stall the first three listen() calls (one per event: pty-data, pty-exit, pty-error)
      // by deferring their resolution until we explicitly release them.
      let releaseListen: () => void = () => undefined

      const listenGate = new Promise<void>((resolve) => {
        releaseListen = resolve
      })

      // Save and replace the listen impl. We use a permissive signature here
      // (the test mock module also widens it) so vi.mocked's strict types
      // don't reject the override.
      const originalImpl = listenMock.getMockImplementation()

      const stalledImpl = async (
        eventName: string,
        callback: EventCallback
      ): Promise<() => void> => {
        await listenGate
        // After release, fall through to the standard test impl that records
        // the callback in eventListeners so emitDesktopEvent works.
        const existing = eventListeners.get(eventName) ?? []
        existing.push(callback)
        eventListeners.set(eventName, existing)

        return () => {
          const cbs = eventListeners.get(eventName) ?? []
          const index = cbs.indexOf(callback)
          if (index > -1) {
            cbs.splice(index, 1)
          }
        }
      }
      listenMock.mockImplementation(
        stalledImpl as unknown as typeof backendModule.listen
      )

      try {
        const testService = new DesktopTerminalService()
        const captured: { data: string; offset: number; byteLen: number }[] = []

        const onDataPromise = testService.onData(
          (_sessionId, data, offsetStart, byteLen) => {
            captured.push({ data, offset: offsetStart, byteLen })
          }
        )

        // Synchronously try to emit an event — there's no listener yet, so
        // it must NOT be captured (this matches the real backend pre-attach window).
        emitDesktopEvent('pty-data', {
          sessionId: 'sess-1',
          data: 'pre-attach-event',
          offsetStart: 0,
          byteLen: 16,
        })
        expect(captured).toHaveLength(0)

        // The onData promise must still be pending — listen hasn't resolved.
        // Race onDataPromise against a short timer; the timer wins iff onData
        // is correctly blocked on listen().
        const RACE_WINNER = 'timeout-won'

        const racer = await Promise.race([
          onDataPromise.then(() => 'onData-resolved' as const),
          new Promise<typeof RACE_WINNER>((resolve) =>
            setTimeout(() => resolve(RACE_WINNER), 5)
          ),
        ])
        expect(racer).toBe(RACE_WINNER)

        // Now release the gated listen() calls
        releaseListen()

        // After awaiting onData, the underlying listener IS attached and
        // subsequent events ARE captured.
        await onDataPromise
        emitDesktopEvent('pty-data', {
          sessionId: 'sess-1',
          data: 'post-attach-event',
          offsetStart: 100,
          byteLen: 17,
        })

        expect(captured).toEqual([
          { data: 'post-attach-event', offset: 100, byteLen: 17 },
        ])
      } finally {
        // Restore the original listen impl for subsequent tests
        if (originalImpl) {
          listenMock.mockImplementation(originalImpl)
        }
      }
    })
  })
})
