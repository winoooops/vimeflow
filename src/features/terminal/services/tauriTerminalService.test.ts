import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest'
import { TauriTerminalService } from './tauriTerminalService'

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock @tauri-apps/api/event — capture listener callbacks for testing
type EventCallback = (event: { payload: unknown }) => void
const eventListeners = new Map<string, EventCallback[]>()

vi.mock('@tauri-apps/api/event', () => ({
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
 * Simulate a Tauri event emission for testing
 */
const emitTauriEvent = (eventName: string, payload: unknown): void => {
  const callbacks = eventListeners.get(eventName) ?? []
  callbacks.forEach((cb) => cb({ payload }))
}

// Import after mocks are set up
const { invoke } = await import('@tauri-apps/api/core')

/** Mock invoke to return a spawn response, then spawn a session */
const mockSpawnAndInit = async (
  service: TauriTerminalService
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

describe('TauriTerminalService', () => {
  let service: TauriTerminalService

  beforeEach(() => {
    vi.clearAllMocks()
    eventListeners.clear()
    service = new TauriTerminalService()
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
      service.onData(callback)
      await mockSpawnAndInit(service)

      emitTauriEvent('pty-data', {
        sessionId: 'sess-1',
        data: 'hello world',
        offsetStart: 0,
      })

      expect(callback).toHaveBeenCalledWith('sess-1', 'hello world', 0)
    })

    test('onExit delivers pty-exit events to callback', async () => {
      const callback = vi.fn()
      service.onExit(callback)
      await mockSpawnAndInit(service)

      emitTauriEvent('pty-exit', { sessionId: 'sess-1', code: 0 })

      expect(callback).toHaveBeenCalledWith('sess-1', 0)
    })

    test('onExit handles null exit code (EOF)', async () => {
      const callback = vi.fn()
      service.onExit(callback)
      await mockSpawnAndInit(service)

      emitTauriEvent('pty-exit', { sessionId: 'sess-1', code: null })

      expect(callback).toHaveBeenCalledWith('sess-1', null)
    })

    test('onError delivers pty-error events to callback', async () => {
      const callback = vi.fn()
      service.onError(callback)
      await mockSpawnAndInit(service)

      emitTauriEvent('pty-error', {
        sessionId: 'sess-1',
        message: 'PTY read error',
      })

      expect(callback).toHaveBeenCalledWith('sess-1', 'PTY read error')
    })

    test('unsubscribe removes callback', async () => {
      const callback = vi.fn()

      const unsubscribe = service.onData(callback)
      await mockSpawnAndInit(service)

      unsubscribe()

      emitTauriEvent('pty-data', {
        sessionId: 'sess-1',
        data: 'should not arrive',
      })

      expect(callback).not.toHaveBeenCalled()
    })

    test('multiple callbacks receive same event', async () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      service.onData(cb1)
      service.onData(cb2)
      await mockSpawnAndInit(service)

      emitTauriEvent('pty-data', {
        sessionId: 'sess-1',
        data: 'broadcast',
        offsetStart: 100,
      })

      expect(cb1).toHaveBeenCalledWith('sess-1', 'broadcast', 100)
      expect(cb2).toHaveBeenCalledWith('sess-1', 'broadcast', 100)
    })
  })

  describe('dispose', () => {
    test('clears all callbacks and listeners', async () => {
      const callback = vi.fn()
      service.onData(callback)
      await mockSpawnAndInit(service)

      service.dispose()

      emitTauriEvent('pty-data', {
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

      const testService = new TauriTerminalService()
      const result = await testService.listSessions()

      expect(mockInvoke).toHaveBeenCalledWith('list_sessions')
      expect(result.activeSessionId).toBe('a')
    })

    test('setActiveSession invokes set_active_session with id', async () => {
      const mockInvoke = vi.fn().mockResolvedValue(undefined)
      vi.mocked(invoke).mockImplementation(mockInvoke)

      const testService = new TauriTerminalService()
      await testService.setActiveSession('xyz')

      expect(mockInvoke).toHaveBeenCalledWith('set_active_session', {
        request: { id: 'xyz' },
      })
    })

    test('reorderSessions invokes reorder_sessions with ids', async () => {
      const mockInvoke = vi.fn().mockResolvedValue(undefined)
      vi.mocked(invoke).mockImplementation(mockInvoke)

      const testService = new TauriTerminalService()
      await testService.reorderSessions(['a', 'b'])

      expect(mockInvoke).toHaveBeenCalledWith('reorder_sessions', {
        request: { ids: ['a', 'b'] },
      })
    })

    test('updateSessionCwd invokes update_session_cwd with id and cwd', async () => {
      const mockInvoke = vi.fn().mockResolvedValue(undefined)
      vi.mocked(invoke).mockImplementation(mockInvoke)

      const testService = new TauriTerminalService()
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
      }[] = []
      const testService = new TauriTerminalService()
      testService.onData((sessionId, data, offsetStart) => {
        captured.push({ sessionId, data, offsetStart })
      })

      await mockSpawnAndInit(testService)

      // Emit pty-data event with offsetStart as bigint (common Rust u64 binding)
      emitTauriEvent('pty-data', {
        sessionId: 'sess-1',
        data: 'test',
        offsetStart: BigInt(42),
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(captured).toHaveLength(1)
      expect(captured[0].sessionId).toBe('sess-1')
      expect(captured[0].data).toBe('test')
      expect(captured[0].offsetStart).toBe(42)
    })

    test('onData coerces bigint offsetStart to number', async () => {
      const captured: number[] = []
      const testService = new TauriTerminalService()
      testService.onData((_sessionId, _data, offsetStart) => {
        captured.push(offsetStart)
      })

      await mockSpawnAndInit(testService)

      // Emit with bigint
      emitTauriEvent('pty-data', {
        sessionId: 'sess-1',
        data: 'test',
        offsetStart: BigInt(1024),
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(captured[0]).toBe(1024)
      expect(typeof captured[0]).toBe('number')
    })
  })
})
