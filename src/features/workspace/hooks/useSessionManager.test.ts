import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSessionManager } from './useSessionManager'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type { SessionList } from '../../../bindings'

const createMockService = (): ITerminalService => ({
  spawn: vi.fn().mockResolvedValue({ sessionId: 'new-id', pid: 123 }),
  write: vi.fn().mockResolvedValue(undefined),
  resize: vi.fn().mockResolvedValue(undefined),
  kill: vi.fn().mockResolvedValue(undefined),
  onData: vi.fn(
    (): Promise<() => void> =>
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      Promise.resolve((): void => {})
  ),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onExit: vi.fn((): (() => void) => (): void => {}),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onError: vi.fn((): (() => void) => (): void => {}),
  listSessions: vi.fn().mockResolvedValue({
    activeSessionId: null,
    sessions: [],
  }),
  setActiveSession: vi.fn().mockResolvedValue(undefined),
  reorderSessions: vi.fn().mockResolvedValue(undefined),
  updateSessionCwd: vi.fn().mockResolvedValue(undefined),
})

describe('useSessionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('on mount, registers global pty-data listener BEFORE calling listSessions', async () => {
    const order: string[] = []
    const service = createMockService()
    service.onData = vi.fn((cb): Promise<() => void> => {
      void cb
      order.push('onData')

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    })

    service.listSessions = vi.fn(() => {
      order.push('listSessions')

      return Promise.resolve({ activeSessionId: null, sessions: [] })
    })

    renderHook(() => useSessionManager(service))

    await waitFor(() => expect(service.listSessions).toHaveBeenCalled())
    expect(order).toEqual(['onData', 'listSessions'])
  })

  test('events received between listSessions call and drain land in restoreData buffer', async () => {
    const service = createMockService()
    let dataCallback: (
      sessionId: string,
      data: string,
      offsetStart: number
    ) => void = vi.fn()
    service.onData = vi.fn((cb): Promise<() => void> => {
      dataCallback = cb

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    })

    // Resolve list_sessions only after we've fired some events
    let resolveListSessions: (v: SessionList) => void = vi.fn()
    service.listSessions = vi.fn(
      () =>
        new Promise<SessionList>((resolve) => {
          resolveListSessions = resolve
        })
    )

    const { result } = renderHook(() => useSessionManager(service))

    // Wait for the orchestrator's awaited onData to complete (the effect's
    // listen-before-snapshot step) so dataCallback is wired before we fire events
    await waitFor(() => expect(service.onData).toHaveBeenCalled())

    // Fire events while list_sessions is in-flight
    dataCallback('s1', 'mid-flight', 100)
    dataCallback('s1', 'mid-flight-2', 105)

    resolveListSessions({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: 'AAA',
            replay_end_offset: BigInt(3),
          },
        },
      ],
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    const restored = result.current.restoreData.get('s1')
    expect(restored).toBeDefined()
    expect(restored!.bufferedEvents).toEqual([
      { data: 'mid-flight', offsetStart: 100 },
      { data: 'mid-flight-2', offsetStart: 105 },
    ])
  })

  test('does not persist anything to localStorage', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const service = createMockService()
    service.listSessions = vi
      .fn()
      .mockResolvedValue({ activeSessionId: null, sessions: [] })

    renderHook(() => useSessionManager(service))
    await waitFor(() => expect(service.listSessions).toHaveBeenCalled())

    // Filter out unrelated localStorage writes
    const ourCalls = setItemSpy.mock.calls.filter(([key]) =>
      key.startsWith('vimeflow:')
    )
    expect(ourCalls).toHaveLength(0)
  })

  test('setActiveSessionId optimistically updates state and calls IPC', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.setActiveSessionId('b'))
    expect(result.current.activeSessionId).toBe('b')
    expect(service.setActiveSession).toHaveBeenCalledWith('b')
  })

  test('setActiveSessionId reverts on IPC error', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })
    service.setActiveSession = vi.fn().mockRejectedValue('unknown session')

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.setActiveSessionId('b'))
    await waitFor(() => expect(result.current.activeSessionId).toBe('a'))
  })

  test('renders Exited sessions from list_sessions', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Exited',
            last_exit_code: 0,
          },
        },
      ],
    })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.sessions).toHaveLength(2)
    expect(result.current.sessions[0].status).toBe('running')
    expect(result.current.sessions[1].status).toBe('completed')
  })

  test('createSession spawns PTY and appends to sessions', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    })

    service.spawn = vi.fn().mockResolvedValue({ sessionId: 'new-id', pid: 999 })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.createSession())

    await waitFor(() => expect(service.spawn).toHaveBeenCalled())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    expect(result.current.sessions[0].id).toBe('new-id')
    expect(result.current.activeSessionId).toBe('new-id')
  })

  test('removeSession kills PTY and filters from state', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.removeSession('s1'))

    await waitFor(() =>
      expect(service.kill).toHaveBeenCalledWith({ sessionId: 's1' })
    )
    await waitFor(() => expect(result.current.sessions).toHaveLength(0))
  })

  test('renameSession updates session name in-memory only', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const originalName = result.current.sessions[0].name

    act(() => result.current.renameSession('s1', 'my-session'))

    expect(result.current.sessions[0].name).toBe('my-session')
    expect(result.current.sessions[0].name).not.toBe(originalName)
  })

  test('reorderSessions calls IPC', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const reversed = [...result.current.sessions].reverse()

    act(() => result.current.reorderSessions(reversed))

    await waitFor(() =>
      expect(service.reorderSessions).toHaveBeenCalledWith(['b', 'a'])
    )
  })

  test('updateSessionCwd updates local state and calls IPC', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.updateSessionCwd('s1', '/home/user'))

    expect(result.current.sessions[0].workingDirectory).toBe('/home/user')
    await waitFor(() =>
      expect(service.updateSessionCwd).toHaveBeenCalledWith('s1', '/home/user')
    )
  })

  // F2 regression: events fired AFTER listSessions resolves but BEFORE the
  // pane attaches its live listener must still reach the pane via the
  // notifyPaneReady drain. Without this, the previous code stopped buffering
  // as soon as setLoading(false) ran (which only schedules a render) — events
  // emitted between then and useTerminal subscribing went to neither the
  // buffer nor the live stream and were silently lost on busy reloads.
  test('F2 regression: keeps buffering until each pane reports ready', async () => {
    const service = createMockService()
    let dataCallback: (
      sessionId: string,
      data: string,
      offsetStart: number
    ) => void = vi.fn()
    service.onData = vi.fn((cb): Promise<() => void> => {
      dataCallback = cb

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    })

    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: 'REPLAY',
            replay_end_offset: BigInt(6),
          },
        },
      ],
    })

    const { result } = renderHook(() => useSessionManager(service))

    // Wait for restore to complete (loading → false).
    await waitFor(() => expect(result.current.loading).toBe(false))

    // SIMULATE THE BUG WINDOW: events arrive AFTER listSessions/setLoading
    // (state has updated, render scheduled) but BEFORE the pane subscribes.
    // Previously stopBuffering() fired right after setLoading and these
    // events were dropped.
    dataCallback('s1', 'POST_RENDER_1', 200)
    dataCallback('s1', 'POST_RENDER_2', 220)

    // Now simulate the pane reporting ready. Capture the events the
    // orchestrator drains through our handler.
    const drained: { data: string; offsetStart: number }[] = []
    act(() => {
      result.current.notifyPaneReady('s1', (data, offsetStart) => {
        drained.push({ data, offsetStart })
      })
    })

    // Both post-setLoading events must be drained — they would have been
    // lost before this fix.
    expect(drained).toEqual([
      { data: 'POST_RENDER_1', offsetStart: 200 },
      { data: 'POST_RENDER_2', offsetStart: 220 },
    ])
  })

  test('F2: stops buffering only after every pending pane reports ready', async () => {
    const service = createMockService()
    const stopBufferingSpy = vi.fn()
    service.onData = vi.fn(
      (): Promise<() => void> => Promise.resolve(stopBufferingSpy)
    )

    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Buffering listener still active — only one of two panes ready.
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      result.current.notifyPaneReady('a', () => {})
    })
    expect(stopBufferingSpy).not.toHaveBeenCalled()

    // Last pane reports ready → stopBuffering fires exactly once.
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      result.current.notifyPaneReady('b', () => {})
    })
    expect(stopBufferingSpy).toHaveBeenCalledTimes(1)
  })
})
