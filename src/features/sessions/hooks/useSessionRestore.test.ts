import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Session } from '../types'
import type { PtyBufferDrain } from '../../terminal/orchestration/usePtyBufferDrain'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type { WorkspaceShapeDto } from '../workspaceLayoutBridge'
import { useSessionRestore } from './useSessionRestore'

const loadWorkspaceForRestore = vi.hoisted(() =>
  vi.fn((): Promise<WorkspaceShapeDto | null> => Promise.resolve(null))
)
const beginWorkspaceHydration = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const endWorkspaceHydration = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('../workspaceLayoutBridge', () => ({
  loadWorkspaceForRestore,
  beginWorkspaceHydration,
  endWorkspaceHydration,
}))

const createBrowserPane = vi.hoisted(() => vi.fn(() => Promise.resolve(null)))
vi.mock('../../browser/browserBridge', () => ({ createBrowserPane }))

const buildBuffer = (): PtyBufferDrain =>
  ({
    bufferEvent: vi.fn(),
    registerPending: vi.fn(),
    getBufferedSnapshot: vi.fn(() => []),
    notifyPaneReady: vi.fn(),
    dropAllForPty: vi.fn(),
  }) as never

describe('useSessionRestore', () => {
  beforeEach(() => {
    loadWorkspaceForRestore.mockReset()
    loadWorkspaceForRestore.mockResolvedValue(null)
    beginWorkspaceHydration.mockReset()
    beginWorkspaceHydration.mockResolvedValue(undefined)
    endWorkspaceHydration.mockReset()
    endWorkspaceHydration.mockResolvedValue(undefined)
    createBrowserPane.mockReset()
    createBrowserPane.mockResolvedValue(null)
  })

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
    // different cwds so the reconciler's `agentType` recompute is
    // observable. `workingDirectory` is now the persisted workspace
    // baseline and must NOT follow the active pane (Codex P2 on PR #290
    // cycle 7) — the workspace baseline is the project root that
    // `addPane` spawns from, not whichever directory the active pane
    // happens to be in.
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
        workspaceDirectory: '/home/will/project-root',
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
    // The workspace baseline cwd comes from the persisted grouping and
    // does NOT follow the active pane's drifted cwd (Codex P2 on PR
    // #290 cycle 7) — otherwise `addPane` would spawn in `/repo-b`
    // even though the project baseline is `/project-root`.
    expect(ws1.workingDirectory).toBe('/home/will/project-root')
    // The tab name is derived from the same baseline.
    expect(ws1.name).toBe('project-root')
    // Active session resolved to the workspace id, not the PTY.
    expect(onActiveResolved).toHaveBeenCalledWith(ws)
  })

  // PR #290 cycle 13: Claude MEDIUM — when no pane records a persisted
  // `grouping.workspaceDirectory` (legacy cache from before that field
  // existed), `groupSessionsFromInfos` falls back to `panes[0].cwd` as
  // the workspace baseline. `panes[0]` is whichever pane the single-
  // active-pane fixup promoted, which may NOT be the real active pane.
  // The reconciler now overrides `workingDirectory` to the canonical
  // active pane's cwd in that fallback case — but ONLY when no pane in
  // the workspace recorded a persisted baseline (so a real persisted
  // value is left alone).
  test('overrides fallback workingDirectory from the active pane for legacy caches', async () => {
    const ws = 'workspace-legacy'

    // No pane carries `workspaceDirectory` — simulates a cache written
    // before the field existed. pty-a and pty-b live in different cwds;
    // pty-b is the canonical active pane per `list.activeSessionId`.
    // Both panes' grouping.active is FALSE so the fixup promotes pane-0
    // (pty-a) as a tiebreaker; that's where the buggy fallback used to
    // bake `/repo-a` as the baseline. The reconciler must replace it
    // with `/repo-b` (the real active pane's cwd).
    const grouped = (
      id: string,
      cwd: string,
      paneIndex: number,
      paneId: string,
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
        active: false,
        // workspaceDirectory deliberately omitted (legacy cache).
      },
    })

    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          grouped('pty-a', '/home/will/repo-a', 0, 'p0', 'claude-code'),
          grouped('pty-b', '/home/will/repo-b', 1, 'p1', 'codex'),
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
    const ws1 = restored[0]
    expect(ws1.workingDirectory).toBe('/home/will/repo-b')
    // The tab name must also follow the canonical active pane, not the
    // fixup-promoted pane 0 (Codex review on PR #381 round 5).
    expect(ws1.name).toBe('repo-b')
    // The active pane is pty-b post-reconciliation.
    expect(ws1.panes.find((pane) => pane.active)?.ptyId).toBe('pty-b')
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

  // Store-driven: a browser-only session (no PTY) is rebuilt from the durable
  // store. Main-owned restore creation is triggered for the browser pane, the
  // persisted-active session is selected via the browser-capable path, and the
  // hydration guard is opened then released.
  test('restores a browser-only session from the durable store', async () => {
    const order: string[] = []

    const store: WorkspaceShapeDto = {
      sessions: [
        {
          id: 'ws-browser',
          projectId: 'proj-1',
          layout: 'single',
          workingDirectory: '/home/will/proj',
          active: true,
          panes: [
            { kind: 'browser', paneId: 'p0', paneIndex: 0, active: true },
          ],
        },
      ],
    }
    loadWorkspaceForRestore.mockResolvedValue(store)
    createBrowserPane.mockImplementation(() => {
      order.push('createBrowserPane')

      return Promise.resolve(null)
    })

    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi
        .fn()
        .mockResolvedValue({ sessions: [], activeSessionId: null }),
    } as unknown as ITerminalService

    const onRestore = vi.fn<(sessions: Session[]) => void>(() => {
      order.push('onRestore')
    })
    const onActiveResolved = vi.fn()
    const onActivePersisted = vi.fn()

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore,
        onActiveResolved,
        onActivePersisted,
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    const restoredSessions = onRestore.mock.calls[0]?.[0]
    if (!restoredSessions) {
      throw new Error('expected onRestore to be called')
    }
    expect(restoredSessions).toHaveLength(1)
    expect(restoredSessions[0].id).toBe('ws-browser')
    expect(restoredSessions[0].panes[0].kind).toBe('browser')

    // Main-owned restore creation for the browser pane.
    expect(createBrowserPane).toHaveBeenCalledTimes(1)
    expect(createBrowserPane).toHaveBeenCalledWith({
      sessionId: 'ws-browser',
      paneId: 'p0',
      workspaceId: 'proj-1',
      restore: true,
    })
    // Restore-create runs BEFORE the tree mounts (so BrowserPane reconnects).
    expect(order).toEqual(['createBrowserPane', 'onRestore'])

    // Persisted-active session selected via the browser-capable path.
    expect(onActivePersisted).toHaveBeenCalledWith('ws-browser')
    expect(onActiveResolved).not.toHaveBeenCalled()

    // Hydration guard opened then released.
    expect(beginWorkspaceHydration).toHaveBeenCalledTimes(1)
    expect(endWorkspaceHydration).toHaveBeenCalledTimes(1)
  })

  test('restarts the persisted active shell workspace when graceful quit left no live PTYs', async () => {
    const store: WorkspaceShapeDto = {
      sessions: [
        {
          id: 'ws-shell',
          projectId: 'proj-1',
          layout: 'single',
          workingDirectory: '/home/will/proj',
          active: true,
          panes: [
            {
              kind: 'shell',
              paneId: 'p0',
              paneIndex: 0,
              active: true,
              ptyId: 'pty-old',
              cwd: '/home/will/proj',
              agentType: 'codex',
              agentSessionId: null,
            },
          ],
        },
      ],
    }
    loadWorkspaceForRestore.mockResolvedValue(store)

    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi
        .fn()
        .mockResolvedValue({ sessions: [], activeSessionId: null }),
      spawn: vi.fn().mockResolvedValue({
        sessionId: 'pty-new',
        pid: 4321,
        cwd: '/home/will/proj',
        shell: '/bin/zsh',
      }),
    } as unknown as ITerminalService
    const buffer = buildBuffer()
    const onRestore = vi.fn<(sessions: Session[]) => void>()
    const onActiveResolved = vi.fn()
    const onActivePersisted = vi.fn()

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer,
        onRestore,
        onActiveResolved,
        onActivePersisted,
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(service.spawn).toHaveBeenCalledWith({
      cwd: '/home/will/proj',
      env: {},
      enableAgentBridge: true,
    })

    const restoredSessions = onRestore.mock.calls[0]?.[0]
    if (!restoredSessions) {
      throw new Error('expected onRestore to be called')
    }
    expect(restoredSessions).toHaveLength(1)
    expect(restoredSessions[0].id).toBe('ws-shell')
    expect(restoredSessions[0].status).toBe('running')
    expect(restoredSessions[0].panes[0]).toEqual(
      expect.objectContaining({
        id: 'p0',
        ptyId: 'pty-new',
        status: 'running',
        pid: 4321,
        shell: '/bin/zsh',
        agentType: 'generic',
        active: true,
      })
    )

    expect(restoredSessions[0].panes[0].restoreData).toEqual({
      sessionId: 'pty-new',
      cwd: '/home/will/proj',
      pid: 4321,
      replayData: '',
      replayEndOffset: 0,
      bufferedEvents: [],
    })
    expect(buffer.registerPending).toHaveBeenCalledWith('pty-new')
    expect(onActivePersisted).toHaveBeenCalledWith('ws-shell')
    expect(onActiveResolved).not.toHaveBeenCalled()
  })

  test('resolves active session from the restarted PTY id when no persisted-active handler is registered', async () => {
    const store: WorkspaceShapeDto = {
      sessions: [
        {
          id: 'ws-shell',
          projectId: 'proj-1',
          layout: 'single',
          workingDirectory: '/home/will/proj',
          active: true,
          panes: [
            {
              kind: 'shell',
              paneId: 'p0',
              paneIndex: 0,
              active: true,
              ptyId: 'pty-old',
              cwd: '/home/will/proj',
              agentType: 'codex',
              agentSessionId: null,
            },
          ],
        },
      ],
    }
    loadWorkspaceForRestore.mockResolvedValue(store)

    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi
        .fn()
        .mockResolvedValue({ sessions: [], activeSessionId: null }),
      spawn: vi.fn().mockResolvedValue({
        sessionId: 'pty-new',
        pid: 4321,
        cwd: '/home/will/proj',
        shell: '/bin/zsh',
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

    expect(onActiveResolved).toHaveBeenCalledWith('ws-shell')
  })

  test('kills restarted PTY when restore is cancelled while spawn is in flight', async () => {
    const store: WorkspaceShapeDto = {
      sessions: [
        {
          id: 'ws-shell',
          projectId: 'proj-1',
          layout: 'single',
          workingDirectory: '/home/will/proj',
          active: true,
          panes: [
            {
              kind: 'shell',
              paneId: 'p0',
              paneIndex: 0,
              active: true,
              ptyId: 'pty-old',
              cwd: '/home/will/proj',
              agentType: 'codex',
              agentSessionId: null,
            },
          ],
        },
      ],
    }
    loadWorkspaceForRestore.mockResolvedValue(store)

    let resolveSpawn: (value: unknown) => void = () => undefined

    const spawnPromise = new Promise<unknown>((resolve) => {
      resolveSpawn = resolve
    })

    const kill = vi.fn().mockResolvedValue(undefined)

    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi
        .fn()
        .mockResolvedValue({ sessions: [], activeSessionId: null }),
      spawn: vi.fn().mockReturnValue(spawnPromise),
      kill,
    } as unknown as ITerminalService

    const { unmount } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore: vi.fn(),
        onActiveResolved: vi.fn(),
      })
    )

    await waitFor(() => expect(service.spawn).toHaveBeenCalled())

    unmount()

    resolveSpawn({
      sessionId: 'pty-new',
      pid: 4321,
      cwd: '/home/will/proj',
      shell: '/bin/zsh',
    })

    await waitFor(() =>
      expect(kill).toHaveBeenCalledWith({ sessionId: 'pty-new' })
    )
  })

  test('kills restarted PTY when restore is cancelled after spawn resolves', async () => {
    const store: WorkspaceShapeDto = {
      sessions: [
        {
          id: 'ws-mixed',
          projectId: 'proj-1',
          layout: 'vsplit',
          workingDirectory: '/home/will/proj',
          active: true,
          panes: [
            {
              kind: 'shell',
              paneId: 'p0',
              paneIndex: 0,
              active: true,
              ptyId: 'pty-old',
              cwd: '/home/will/proj',
              agentType: 'codex',
              agentSessionId: null,
            },
            { kind: 'browser', paneId: 'p1', paneIndex: 1, active: false },
          ],
        },
      ],
    }
    loadWorkspaceForRestore.mockResolvedValue(store)

    let resolveCreateBrowserPane: (value: null) => void = () => undefined

    const createBrowserPanePromise = new Promise<null>((resolve) => {
      resolveCreateBrowserPane = resolve
    })

    createBrowserPane.mockReturnValue(createBrowserPanePromise)

    const kill = vi.fn().mockResolvedValue(undefined)

    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi
        .fn()
        .mockResolvedValue({ sessions: [], activeSessionId: null }),
      spawn: vi.fn().mockResolvedValue({
        sessionId: 'pty-new',
        pid: 4321,
        cwd: '/home/will/proj',
        shell: '/bin/zsh',
      }),
      kill,
    } as unknown as ITerminalService

    const { unmount } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore: vi.fn(),
        onActiveResolved: vi.fn(),
      })
    )

    await waitFor(() => expect(createBrowserPane).toHaveBeenCalled())

    unmount()

    resolveCreateBrowserPane(null)

    await waitFor(() =>
      expect(kill).toHaveBeenCalledWith({ sessionId: 'pty-new' })
    )
  })

  test('does not restart an inactive shell when a browser pane is active', async () => {
    const store: WorkspaceShapeDto = {
      sessions: [
        {
          id: 'ws-mixed',
          projectId: 'proj-1',
          layout: 'vsplit',
          workingDirectory: '/home/will/proj',
          active: true,
          panes: [
            { kind: 'browser', paneId: 'p0', paneIndex: 0, active: true },
            {
              kind: 'shell',
              paneId: 'p1',
              paneIndex: 1,
              active: false,
              ptyId: 'pty-old',
              cwd: '/home/will/proj',
              agentType: 'codex',
              agentSessionId: null,
            },
          ],
        },
      ],
    }
    loadWorkspaceForRestore.mockResolvedValue(store)

    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi
        .fn()
        .mockResolvedValue({ sessions: [], activeSessionId: null }),
      spawn: vi.fn(),
    } as unknown as ITerminalService
    const onRestore = vi.fn<(sessions: Session[]) => void>()

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore,
        onActiveResolved: vi.fn(),
        onActivePersisted: vi.fn(),
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(service.spawn).not.toHaveBeenCalled()
    expect(createBrowserPane).toHaveBeenCalledWith({
      sessionId: 'ws-mixed',
      paneId: 'p0',
      workspaceId: 'proj-1',
      restore: true,
    })

    const restoredSessions = onRestore.mock.calls[0]?.[0]
    if (!restoredSessions) {
      throw new Error('expected onRestore to be called')
    }
    expect(restoredSessions[0].panes).toEqual([
      expect.objectContaining({ id: 'p0', kind: 'browser', active: true }),
      expect.objectContaining({
        id: 'p1',
        ptyId: 'pty-old',
        status: 'completed',
        active: false,
      }),
    ])
  })

  // The store load is renderer-initiated with the active project context.
  test('loads the store with project context and always releases hydration', async () => {
    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi
        .fn()
        .mockResolvedValue({ sessions: [], activeSessionId: null }),
    } as unknown as ITerminalService

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore: vi.fn(),
        onActiveResolved: vi.fn(),
        projectId: 'proj-9',
        workingDirectory: '/work/dir',
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(loadWorkspaceForRestore).toHaveBeenCalledWith({
      projectId: 'proj-9',
      workingDirectory: '/work/dir',
    })
    expect(endWorkspaceHydration).toHaveBeenCalledTimes(1)
  })

  // Hydration must release even when restore throws, or main would suppress
  // writes forever.
  test('releases hydration even when listSessions rejects', async () => {
    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as ITerminalService

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore: vi.fn(),
        onActiveResolved: vi.fn(),
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(endWorkspaceHydration).toHaveBeenCalledTimes(1)
  })
})
