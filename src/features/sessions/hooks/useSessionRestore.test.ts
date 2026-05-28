import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Session } from '../types'
import type { PtyBufferDrain } from '../../terminal/orchestration/usePtyBufferDrain'
import type { ITerminalService } from '../../terminal/services/terminalService'
import { useSessionRestore } from './useSessionRestore'

const buildBuffer = (): PtyBufferDrain =>
  ({
    bufferEvent: vi.fn(),
    registerPending: vi.fn(),
    getBufferedSnapshot: vi.fn(() => []),
    notifyPaneReady: vi.fn(),
    dropAllForPty: vi.fn(),
  }) as never

describe('useSessionRestore', () => {
  test('attaches onData listener before listSessions', async () => {
    const order: string[] = []

    const service = {
      onData: vi.fn().mockImplementation(() => {
        order.push('onData-attached')

        return Promise.resolve((): void => undefined)
      }),
      listSessions: vi.fn().mockImplementation(() => {
        order.push('listSessions-called')

        return Promise.resolve({ sessions: [], activeSessionId: null })
      }),
    } as unknown as ITerminalService
    const onRestore = vi.fn<(sessions: Session[]) => void>()
    const onActiveResolved = vi.fn()

    renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore,
        onActiveResolved,
      })
    )

    await waitFor(() => {
      expect(service.listSessions).toHaveBeenCalled()
    })
    expect(order).toEqual(['onData-attached', 'listSessions-called'])
  })

  test('builds one-pane sessions from alive infos', async () => {
    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: 'pty-1',
            cwd: '/home/will/repo',
            status: {
              kind: 'Alive',
              pid: 1234,
              replay_data: '',
              replay_end_offset: BigInt(0),
            },
          },
        ],
        activeSessionId: 'pty-1',
      }),
    } as unknown as ITerminalService
    const onRestore = vi.fn<(sessions: Session[]) => void>()
    const onActiveResolved = vi.fn()

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore,
        onActiveResolved,
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(onRestore).toHaveBeenCalled()
    const firstCall = onRestore.mock.calls[0]
    if (!firstCall) {
      throw new Error('expected onRestore to be called')
    }
    const restoredSessions = firstCall[0]

    expect(restoredSessions).toHaveLength(1)
    expect(restoredSessions[0].panes[0].ptyId).toBe('pty-1')
    expect(restoredSessions[0].panes[0].active).toBe(true)
    expect(restoredSessions[0].panes[0].status).toBe('running')
  })

  // Fragmentation regression (captured evidence for the multi-pane restore
  // bug): when several PTYs belonged to ONE workspace session (e.g. a quad
  // layout with 3 agents + 1 shell), restore currently fragments them into
  // one single-pane session PER PTY, because the backend cache persists no
  // pane grouping (see the multi-pane session-restore plan). This test pins
  // the buggy behavior so the fix can flip it to a single grouped session.
  test('FRAGMENTS multiple PTYs into separate single-pane sessions (bug)', async () => {
    const alive = (id: string, cwd: string): unknown => ({
      id,
      cwd,
      status: {
        kind: 'Alive',
        pid: 1000,
        replay_data: '',
        replay_end_offset: BigInt(0),
      },
    })

    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi.fn().mockResolvedValue({
        // Four PTYs that (conceptually) were the four panes of one quad
        // workspace session in the same repo.
        sessions: [
          alive('pty-a', '/home/will/repo'),
          alive('pty-b', '/home/will/repo'),
          alive('pty-c', '/home/will/repo'),
          alive('pty-d', '/home/will/repo'),
        ],
        activeSessionId: 'pty-a',
      }),
    } as unknown as ITerminalService
    const onRestore = vi.fn<(sessions: Session[]) => void>()
    const onActiveResolved = vi.fn()

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore,
        onActiveResolved,
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    const restoredSessions = onRestore.mock.calls[0]?.[0]
    if (!restoredSessions) {
      throw new Error('expected onRestore to be called')
    }

    // BUG: 4 PTYs -> 4 separate sessions, each single-pane.
    expect(restoredSessions).toHaveLength(4)
    for (const session of restoredSessions) {
      expect(session.layout).toBe('single')
      expect(session.panes).toHaveLength(1)
    }
    // The fix target: this should become exactly ONE quad-layout session
    // owning all four panes.
  })

  // The flip side of the FRAGMENTS test: once the backend persists pane
  // grouping (and lists it on each SessionInfo), four PTYs that belonged to
  // one quad workspace must restore as ONE quad session with four panes —
  // not four single-pane sessions.
  test('reconstructs ONE multi-pane session from grouped PTY infos (fix)', async () => {
    const ws = 'workspace-uuid-quad'

    const grouped = (
      id: string,
      paneIndex: number,
      paneId: string,
      active: boolean,
      agentType: string
    ): unknown => ({
      id,
      cwd: '/home/will/repo',
      status: {
        kind: 'Alive',
        pid: 1000 + paneIndex,
        replay_data: '',
        replay_end_offset: BigInt(0),
      },
      grouping: {
        workspaceSessionId: ws,
        layout: 'quad',
        paneId,
        paneIndex,
        agentType,
        active,
      },
    })

    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          // Intentionally NOT in paneIndex order — reconstruction must sort.
          grouped('pty-c', 2, 'p2', false, 'generic'),
          grouped('pty-a', 0, 'p0', true, 'claude-code'),
          grouped('pty-d', 3, 'p3', false, 'generic'),
          grouped('pty-b', 1, 'p1', false, 'codex'),
        ],
        activeSessionId: 'pty-a',
      }),
    } as unknown as ITerminalService
    const onRestore = vi.fn<(sessions: Session[]) => void>()
    const onActiveResolved = vi.fn<(id: string) => void>()

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore,
        onActiveResolved,
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    const restoredSessions = onRestore.mock.calls[0]?.[0]
    if (!restoredSessions) {
      throw new Error('expected onRestore to be called')
    }

    // 4 grouped PTYs collapse to ONE quad session — the inverse of the
    // FRAGMENTS test above.
    expect(restoredSessions).toHaveLength(1)
    const restored = restoredSessions[0]
    expect(restored.id).toBe(ws)
    expect(restored.layout).toBe('quad')
    expect(restored.panes).toHaveLength(4)
    expect(restored.panes.map((pane) => pane.ptyId)).toEqual([
      'pty-a',
      'pty-b',
      'pty-c',
      'pty-d',
    ])
    expect(restored.panes.filter((pane) => pane.active)).toHaveLength(1)
    expect(restored.panes.find((pane) => pane.active)?.ptyId).toBe('pty-a')
    // Active session resolved to the workspace session id (not a pty id).
    expect(onActiveResolved).toHaveBeenCalledWith(ws)
  })

  // Codex P2 (PR #290 cycle 2): `set_active_session` lands immediately,
  // but the grouping-snapshot push can land later (or fail), so the
  // restored grouping's `pane.active` flags may not match
  // `list.activeSessionId`. Trust `activeSessionId` and reconcile the
  // pane.active flag on the workspace it belongs to.
  test('reconciles pane.active from list.activeSessionId when grouping is stale', async () => {
    const ws = 'workspace-uuid-active-mismatch'

    // Grouping claims pty-a is active; cache's activeSessionId says pty-b
    // (e.g. the user switched the active pane and Cmd+R'd before the
    // grouping snapshot push completed). pty-a and pty-b live in
    // different cwds so the reconciler's `workingDirectory` /
    // `name` recompute is observable.
    const aliveAt = (
      id: string,
      cwd: string,
      paneIndex: number,
      paneId: string,
      groupingActive: boolean,
      agentType: string
    ): unknown => ({
      id,
      cwd,
      status: {
        kind: 'Alive',
        pid: 1000 + paneIndex,
        replay_data: '',
        replay_end_offset: BigInt(0),
      },
      grouping: {
        workspaceSessionId: ws,
        layout: 'vsplit',
        paneId,
        paneIndex,
        agentType,
        active: groupingActive,
      },
    })

    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          aliveAt('pty-a', '/home/will/repo-a', 0, 'p0', true, 'claude-code'),
          aliveAt('pty-b', '/home/will/repo-b', 1, 'p1', false, 'codex'),
        ],
        activeSessionId: 'pty-b',
      }),
    } as unknown as ITerminalService
    const onRestore = vi.fn<(sessions: Session[]) => void>()
    const onActiveResolved = vi.fn<(id: string) => void>()

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore,
        onActiveResolved,
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    const restored = onRestore.mock.calls[0]?.[0]
    if (!restored) {
      throw new Error('expected onRestore to be called')
    }
    expect(restored).toHaveLength(1)
    const ws1 = restored[0]
    // Exactly one active pane after reconciliation, and it's pty-b
    // (the one backend.activeSessionId pointed at), not pty-a (stale flag).
    expect(ws1.panes.filter((pane) => pane.active)).toHaveLength(1)
    expect(ws1.panes.find((pane) => pane.active)?.ptyId).toBe('pty-b')
    // The session's derived agentType follows the new active pane.
    expect(ws1.agentType).toBe('codex')
    // Every session-level field derived from the active pane in
    // groupSessionsFromInfos must be recomputed in the reconcile pass —
    // otherwise addPane later spawns from the stale cwd.
    expect(ws1.workingDirectory).toBe('/home/will/repo-b')
    expect(ws1.name).toBe('repo-b')
    // Active session resolved to the workspace id, not the PTY.
    expect(onActiveResolved).toHaveBeenCalledWith(ws)
  })

  test('null active id with no sessions leaves activeSessionId null', async () => {
    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi
        .fn()
        .mockResolvedValue({ sessions: [], activeSessionId: null }),
    } as unknown as ITerminalService
    const onRestore = vi.fn()
    const onActiveResolved = vi.fn()

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore,
        onActiveResolved,
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(onActiveResolved).not.toHaveBeenCalled()
  })
})
