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

    // F3 regression: the new session must be marked attach-ready (restoreData
    // populated). Without this, TerminalZone's mode-decision routes the
    // pane to legacy 'spawn' mode and useTerminal calls service.spawn() a
    // SECOND time — hidden duplicate PTY.
    const restored = result.current.restoreData.get('new-id')
    expect(restored).toBeDefined()
    expect(restored!.pid).toBe(999)
    expect(restored!.replayData).toBe('')
    expect(restored!.replayEndOffset).toBe(0)
    // service.spawn called exactly once (not twice).
    expect(service.spawn).toHaveBeenCalledTimes(1)

    // F4 regression: createSession must persist the new active id and the
    // updated session_order to the cache. spawn_pty only auto-promotes
    // active when cache.active_session_id was null, and appends to
    // session_order — so without these IPC calls, reload comes back with
    // the OLD active tab and the wrong order.
    await waitFor(() =>
      expect(service.setActiveSession).toHaveBeenCalledWith('new-id')
    )

    await waitFor(() =>
      expect(service.reorderSessions).toHaveBeenCalledWith(['new-id'])
    )
  })

  // F4 specific: with existing tabs, the new tab must be PREPENDED in the
  // reorderSessions call (matching the React-state insertion order so cache
  // and view agree on the post-create arrangement).
  test('F4: createSession persists prepended order to cache when other tabs exist', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'existing-1',
      sessions: [
        {
          id: 'existing-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 100,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'existing-2',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 200,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    service.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'new-tab', pid: 999 })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.createSession())

    await waitFor(() => expect(service.spawn).toHaveBeenCalled())
    // Active id flips to the new tab, both in React state and in the cache IPC.
    expect(result.current.activeSessionId).toBe('new-tab')
    await waitFor(() =>
      expect(service.setActiveSession).toHaveBeenCalledWith('new-tab')
    )

    // Order: new tab first (matches the [newSession, ...prev] prepend),
    // then the two existing tabs in their original order.
    await waitFor(() =>
      expect(service.reorderSessions).toHaveBeenCalledWith([
        'new-tab',
        'existing-1',
        'existing-2',
      ])
    )
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

  // F4 (round 2): when the user closes the active middle tab, the hook
  // promotes a neighbor in React state but the previous code never told
  // Rust about it. Rust's kill_pty path rotates active to the FIRST
  // remaining tab — so after reload the cache's restored selection
  // diverged from where the UI actually moved.
  test('F4 (round 2): removeSession persists fallback active id when closing the active tab', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'middle',
      sessions: [
        {
          id: 'first',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'middle',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'last',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 3,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Sanity-check the restore set 'middle' as active.
    expect(result.current.activeSessionId).toBe('middle')

    // Reset spy so the restore-time assertions don't leak in.
    ;(service.setActiveSession as ReturnType<typeof vi.fn>).mockClear()

    act(() => result.current.removeSession('middle'))

    await waitFor(() =>
      expect(service.kill).toHaveBeenCalledWith({ sessionId: 'middle' })
    )

    // React state moved active to 'last' (Math.min(removedIndex=1, next.length-1=1)).
    await waitFor(() => expect(result.current.activeSessionId).toBe('last'))

    // The IPC must echo the same choice. Without this, Rust's kill_pty
    // rotates active to 'first' (cache.session_order[0]) and the next
    // reload comes back with a different selection than the UI.
    await waitFor(() =>
      expect(service.setActiveSession).toHaveBeenCalledWith('last')
    )
  })

  // F4 (round 2): closing an INACTIVE tab must NOT fire setActiveSession —
  // the active tab didn't change, and the spurious IPC would overwrite the
  // cache's active id with the same value (harmless but pointless I/O).
  test('F4 (round 2): removeSession does not call setActiveSession when closing an inactive tab', async () => {
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
    ;(service.setActiveSession as ReturnType<typeof vi.fn>).mockClear()

    act(() => result.current.removeSession('b'))
    await waitFor(() => expect(service.kill).toHaveBeenCalled())

    // Active stays on 'a' — no setActiveSession IPC needed.
    expect(result.current.activeSessionId).toBe('a')
    expect(service.setActiveSession).not.toHaveBeenCalled()
  })

  // F5 (round 2): exited sessions surface a Restart affordance, but the
  // hook had no restart path at all — the button was a silent no-op.
  test('F5 (round 2): restartSession kills then spawns and replaces session metadata', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'exited-id',
      sessions: [
        {
          id: 'exited-id',
          cwd: '/home/user/projects/foo',
          status: { kind: 'Exited', last_exit_code: 0 },
        },
      ],
    })

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'fresh-id',
      pid: 4242,
    })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.sessions).toHaveLength(1)
    expect(result.current.sessions[0].id).toBe('exited-id')
    expect(result.current.sessions[0].status).toBe('completed')

    act(() => result.current.restartSession('exited-id'))

    // 1. kill_pty is fired against the OLD id (idempotent — Rust no-ops if
    //    the session is already gone, which is the common case for Exited).
    await waitFor(() =>
      expect(service.kill).toHaveBeenCalledWith({ sessionId: 'exited-id' })
    )

    // 2. spawn fires AT THE CACHED CWD so the user lands back where they were.
    await waitFor(() =>
      expect(service.spawn).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: '/home/user/projects/foo' })
      )
    )

    // Order: kill BEFORE spawn so the Rust cache slot is free for reuse.
    const killCallOrder = (service.kill as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]

    const spawnCallOrder = (service.spawn as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]

    expect(killCallOrder).toBeLessThan(spawnCallOrder)

    // 3. React state replaces the old session — id flips to fresh-id, status
    //    flips to 'running'. The previous 'exited-id' must NOT linger.
    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1)
      expect(result.current.sessions[0].id).toBe('fresh-id')
      expect(result.current.sessions[0].status).toBe('running')
    })

    expect(result.current.sessions[0].workingDirectory).toBe(
      '/home/user/projects/foo'
    )

    // 4. restoreData has a fresh entry under the NEW id with the new pid so
    //    TerminalPane attaches via the spawn-attached lifecycle (no duplicate
    //    PTY — same trick as createSession's F3 fix).
    const restored = result.current.restoreData.get('fresh-id')
    expect(restored).toBeDefined()
    expect(restored!.pid).toBe(4242)
    expect(restored!.cwd).toBe('/home/user/projects/foo')

    // 5. Active id was 'exited-id'; it must move to 'fresh-id' AND echo to
    //    Rust so reload sees the same selection.
    expect(result.current.activeSessionId).toBe('fresh-id')
    await waitFor(() =>
      expect(service.setActiveSession).toHaveBeenCalledWith('fresh-id')
    )
  })

  test('F5 (round 2): restartSession of inactive session does NOT call setActiveSession', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'alive',
      sessions: [
        {
          id: 'alive',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'exited',
          cwd: '/var',
          status: { kind: 'Exited', last_exit_code: null },
        },
      ],
    })

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'fresh',
      pid: 99,
    })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))
    ;(service.setActiveSession as ReturnType<typeof vi.fn>).mockClear()

    act(() => result.current.restartSession('exited'))

    await waitFor(() => expect(service.spawn).toHaveBeenCalled())
    // The inactive 'exited' tab restarts to 'fresh', but the active tab
    // ('alive') stays untouched — no setActiveSession should fire.
    expect(result.current.activeSessionId).toBe('alive')
    expect(service.setActiveSession).not.toHaveBeenCalled()
  })

  test('F5 (round 2): restartSession on unknown id is a no-op', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.restartSession('does-not-exist'))

    // No spawn, no kill — the unknown id is logged and the function returns.
    await waitFor(() => {
      expect(service.spawn).not.toHaveBeenCalled()
    })
    expect(service.kill).not.toHaveBeenCalled()
    expect(result.current.sessions).toHaveLength(0)
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

  // F1 (round 2): the global buffering listener is permanent for the
  // lifetime of useSessionManager — sessions created after restore via
  // createSession also need the buffer→drain protocol so their early
  // pty-data isn't lost while waiting for useTerminal to subscribe.
  // Tearing it down once restored panes were ready left fresh tabs blank.
  test('F1 (round 2): buffering listener stays attached after all restored panes report ready', async () => {
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

    // All restored panes report ready — the listener must remain alive so
    // sessions spawned later also benefit from buffer→drain.
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      result.current.notifyPaneReady('a', () => {})
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      result.current.notifyPaneReady('b', () => {})
    })

    expect(stopBufferingSpy).not.toHaveBeenCalled()
  })

  // F1 (round 2) regression: a session created via createSession AFTER the
  // initial restore must still get its early pty-data delivered. Before this
  // fix, the buffering listener was torn down once every restored pane was
  // ready, so events emitted between createSession's spawn() and the new
  // pane's useTerminal subscription were lost — fresh tabs came up blank
  // until the shell produced more output.
  test('F1 (round 2): events for sessions created after restore are buffered and drained on notifyPaneReady', async () => {
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

    // Restore returns no sessions — clean startup.
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    })

    service.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'fresh-tab', pid: 777 })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Create a fresh tab AFTER restore completes.
    act(() => result.current.createSession())
    await waitFor(() => expect(service.spawn).toHaveBeenCalled())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    // Simulate Rust emitting the shell's startup prompt for the new session
    // BEFORE useTerminal has subscribed. Without the permanent listener this
    // would land nowhere and be silently dropped.
    dataCallback('fresh-tab', '$ ', 0)
    dataCallback('fresh-tab', 'welcome\r\n', 2)

    // Pane subscribes — the buffered events must drain through our handler.
    const drained: { data: string; offsetStart: number }[] = []
    act(() => {
      result.current.notifyPaneReady('fresh-tab', (data, offsetStart) => {
        drained.push({ data, offsetStart })
      })
    })

    expect(drained).toEqual([
      { data: '$ ', offsetStart: 0 },
      { data: 'welcome\r\n', offsetStart: 2 },
    ])
  })

  // After a pane reports ready, its events should NOT continue to accumulate
  // in the orchestrator's buffer — the per-pane onData subscription handles
  // them directly. Without dropping ready-pane events the global listener
  // would leak memory across the hook's lifetime.
  test('F1 (round 2): events for sessions whose panes already reported ready are dropped (no buffer leak)', async () => {
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
      activeSessionId: 'live',
      sessions: [
        {
          id: 'live',
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

    const drained: { data: string; offsetStart: number }[] = []
    act(() => {
      result.current.notifyPaneReady('live', (data, offsetStart) => {
        drained.push({ data, offsetStart })
      })
    })
    expect(drained).toEqual([])

    // Subsequent events for this session (after notifyPaneReady) are routed
    // through the per-pane listener, NOT the orchestrator's buffer. If the
    // orchestrator's buffer were still capturing, a later notifyPaneReady
    // call would re-deliver the same payload — driving doubled bytes and
    // unbounded memory growth.
    dataCallback('live', 'POST_READY', 100)

    const drainedAgain: { data: string; offsetStart: number }[] = []
    act(() => {
      result.current.notifyPaneReady('live', (data, offsetStart) => {
        drainedAgain.push({ data, offsetStart })
      })
    })

    expect(drainedAgain).toEqual([])
  })

  // F3 (round 2): two rapid createSession() calls before either spawn()
  // resolves must produce a reorderSessions IPC payload that includes BOTH
  // new tab ids. The previous code closed over the render-time `sessions`
  // array; the second async closure therefore omitted the first new tab,
  // and reorderSessions persisted an order that no longer matched the live
  // tab strip after reload (or rejected as a non-permutation).
  test('F3 (round 2): two rapid createSession calls persist both new tabs in reorderSessions', async () => {
    const service = createMockService()
    service.listSessions = vi
      .fn()
      .mockResolvedValue({ activeSessionId: null, sessions: [] })

    let resolveSpawn1: (v: { sessionId: string; pid: number }) => void = vi.fn()
    let resolveSpawn2: (v: { sessionId: string; pid: number }) => void = vi.fn()

    service.spawn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSpawn1 = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSpawn2 = resolve
          })
      )

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Fire both createSession calls before either spawn resolves. With the
    // old code, both async closures captured the same empty `sessions`
    // array — the second closure would build `[id2]` instead of `[id2, id1]`.
    act(() => {
      result.current.createSession()
      result.current.createSession()
    })

    await waitFor(() => expect(service.spawn).toHaveBeenCalledTimes(2))

    // Resolve them in order. The state should now reflect both tabs.
    await act(async () => {
      resolveSpawn1({ sessionId: 'tab-1', pid: 1 })
      resolveSpawn2({ sessionId: 'tab-2', pid: 2 })
      // Yield so the resolved spawn microtasks run.
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current.sessions).toHaveLength(2))

    // The second reorderSessions call must include BOTH tab ids — not just
    // tab-2. This is the F3 invariant: the order is derived from the latest
    // setSessions state, not the closure's stale `sessions`.
    const reorderCalls = (
      service.reorderSessions as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0] as string[])

    // The most recent reorder must contain both ids.
    const lastReorder = reorderCalls[reorderCalls.length - 1]
    expect(lastReorder).toEqual(expect.arrayContaining(['tab-1', 'tab-2']))
    expect(lastReorder).toHaveLength(2)
  })

  // F2 (round 2): if the user creates a tab via createSession while the
  // mount-time restore is still in flight, the in-flight listSessions
  // snapshot was taken BEFORE the new tab existed in cache. Without
  // merging, the restore effect's wholesale `setSessions(snapshot)` blew
  // the optimistically-created tab out of React state until the next
  // reload (the live PTY/cache entry kept running in Rust).
  test('F2 (round 2): createSession during loading is preserved when restore resolves', async () => {
    const service = createMockService()

    // Hold listSessions until we explicitly resolve it — simulates a slow
    // mount-time restore so the test can interleave createSession.
    let resolveListSessions: (v: SessionList) => void = vi.fn()
    service.listSessions = vi.fn(
      () =>
        new Promise<SessionList>((resolve) => {
          resolveListSessions = resolve
        })
    )

    service.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'in-flight-tab', pid: 555 })

    const { result } = renderHook(() => useSessionManager(service))

    // While restore is still loading, the user clicks +
    act(() => result.current.createSession())
    await waitFor(() => expect(service.spawn).toHaveBeenCalled())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    expect(result.current.sessions[0].id).toBe('in-flight-tab')
    expect(result.current.activeSessionId).toBe('in-flight-tab')

    // Now the restore IPC resolves with a snapshot taken BEFORE the new tab
    // was added to the cache (it only contains a previously-existing tab).
    resolveListSessions({
      activeSessionId: 'cached-tab',
      sessions: [
        {
          id: 'cached-tab',
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

    await waitFor(() => expect(result.current.loading).toBe(false))

    // BOTH sessions must be present after restore resolves — the in-flight
    // tab must NOT be wiped out by the snapshot. Order: in-flight first
    // (matches the createSession prepend convention), then restored tabs.
    const ids = result.current.sessions.map((s) => s.id)
    expect(ids).toEqual(['in-flight-tab', 'cached-tab'])

    // Active id stays on the user's most recent intent (the in-flight tab),
    // not the cached id. createSession's optimistic active update wins.
    expect(result.current.activeSessionId).toBe('in-flight-tab')
  })
})
