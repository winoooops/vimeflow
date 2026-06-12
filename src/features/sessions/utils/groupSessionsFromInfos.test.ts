import { describe, expect, test } from 'vitest'
import type { PaneGrouping, SessionInfo } from '../../../bindings'
import type {
  WorkspaceShapeBrowserPane,
  WorkspaceShapeDto,
  WorkspaceShapeShellPane,
} from '../workspaceLayoutBridge'
import {
  groupSessionsFromInfos,
  reconstructWorkspace,
} from './groupSessionsFromInfos'

const alive = (id: string, cwd: string): SessionInfo => ({
  id,
  cwd,
  status: { kind: 'Alive', pid: 1000, replay_data: '', replay_end_offset: 0n },
})

const grouping = (
  overrides: Partial<PaneGrouping> & Pick<PaneGrouping, 'workspaceSessionId'>
): PaneGrouping => ({
  layout: 'quad',
  paneId: 'p0',
  paneIndex: 0,
  agentType: 'generic',
  active: false,
  ...overrides,
})

describe('groupSessionsFromInfos', () => {
  test('ungrouped PTYs each become a single-pane session (back-compat)', () => {
    const sessions = groupSessionsFromInfos([
      alive('pty-x', '/repo/x'),
      alive('pty-y', '/repo/y'),
    ])

    expect(sessions).toHaveLength(2)
    expect(sessions[0].layout).toBe('single')
    expect(sessions[0].panes).toHaveLength(1)
    expect(sessions[0].panes[0].ptyId).toBe('pty-x')
    expect(sessions[0].panes[0].active).toBe(true)
    expect(sessions[1].panes[0].ptyId).toBe('pty-y')
  })

  test('grouped PTYs collapse into ONE workspace session with the right layout, order, and active pane', () => {
    const ws = 'workspace-uuid-1'

    const sessions = groupSessionsFromInfos([
      {
        ...alive('pty-b', '/home/will/repo'),
        grouping: grouping({
          workspaceSessionId: ws,
          layout: 'quad',
          paneId: 'p1',
          paneIndex: 1,
          agentType: 'codex',
          active: false,
        }),
      },
      {
        ...alive('pty-a', '/home/will/repo'),
        grouping: grouping({
          workspaceSessionId: ws,
          layout: 'quad',
          paneId: 'p0',
          paneIndex: 0,
          agentType: 'claude-code',
          active: true,
        }),
      },
      {
        ...alive('pty-c', '/home/will/repo'),
        grouping: grouping({
          workspaceSessionId: ws,
          layout: 'quad',
          paneId: 'p2',
          paneIndex: 2,
          agentType: 'generic',
          active: false,
        }),
      },
      {
        ...alive('pty-d', '/home/will/repo'),
        grouping: grouping({
          workspaceSessionId: ws,
          layout: 'quad',
          paneId: 'p3',
          paneIndex: 3,
          agentType: 'generic',
          active: false,
        }),
      },
    ])

    // 4 grouped PTYs collapse to one quad session.
    expect(sessions).toHaveLength(1)
    const restored = sessions[0]
    expect(restored.id).toBe(ws)
    expect(restored.layout).toBe('quad')
    expect(restored.panes).toHaveLength(4)
    // Order is by paneIndex regardless of the order PTYs were returned in.
    expect(restored.panes.map((pane) => pane.ptyId)).toEqual([
      'pty-a',
      'pty-b',
      'pty-c',
      'pty-d',
    ])

    expect(restored.panes.map((pane) => pane.id)).toEqual([
      'p0',
      'p1',
      'p2',
      'p3',
    ])

    expect(restored.panes.map((pane) => pane.agentType)).toEqual([
      'claude-code',
      'codex',
      'generic',
      'generic',
    ])
    // Active pane invariant
    expect(restored.panes.filter((pane) => pane.active)).toHaveLength(1)
    expect(restored.panes.find((pane) => pane.active)?.id).toBe('p0')
    expect(restored.workingDirectory).toBe('/home/will/repo')
    expect(restored.agentType).toBe('claude-code')
  })

  test('mixes grouped workspaces with ungrouped legacy PTYs', () => {
    const ws = 'ws-1'

    const sessions = groupSessionsFromInfos([
      {
        ...alive('pty-a', '/r'),
        grouping: grouping({
          workspaceSessionId: ws,
          layout: 'vsplit',
          paneId: 'p0',
          paneIndex: 0,
          active: true,
        }),
      },
      alive('pty-legacy', '/r'),
      {
        ...alive('pty-b', '/r'),
        grouping: grouping({
          workspaceSessionId: ws,
          layout: 'vsplit',
          paneId: 'p1',
          paneIndex: 1,
        }),
      },
    ])

    expect(sessions).toHaveLength(2)
    expect(sessions[0].id).toBe(ws)
    expect(sessions[0].layout).toBe('vsplit')
    expect(sessions[0].panes).toHaveLength(2)
    expect(sessions[1].id).toBe('pty-legacy')
    expect(sessions[1].layout).toBe('single')
    expect(sessions[1].panes).toHaveLength(1)
  })

  test('promotes a pane to active when no grouping marks one (transient push race)', () => {
    const ws = 'ws-no-active' // cspell:disable-line

    const sessions = groupSessionsFromInfos([
      {
        ...alive('pty-a', '/r'),
        grouping: grouping({
          workspaceSessionId: ws,
          layout: 'vsplit',
          paneId: 'p0',
          paneIndex: 0,
          active: false, // bug: none active
        }),
      },
      {
        ...alive('pty-b', '/r'),
        grouping: grouping({
          workspaceSessionId: ws,
          layout: 'vsplit',
          paneId: 'p1',
          paneIndex: 1,
          active: false,
        }),
      },
    ])
    const restored = sessions[0]
    expect(restored.panes.filter((pane) => pane.active)).toHaveLength(1)
  })

  test('preserves restoreData for each Alive pane in the grouped session', () => {
    const ws = 'ws-restoredata'

    const sessions = groupSessionsFromInfos([
      {
        id: 'pty-a',
        cwd: '/r',
        status: {
          kind: 'Alive',
          pid: 100,
          replay_data: 'hello',
          replay_end_offset: 5n,
        },
        grouping: grouping({
          workspaceSessionId: ws,
          layout: 'vsplit',
          paneId: 'p0',
          paneIndex: 0,
          active: true,
        }),
      },
    ])
    const pane = sessions[0].panes[0]
    expect(pane.restoreData).toBeDefined()
    expect(pane.restoreData?.replayData).toBe('hello')
    expect(pane.restoreData?.replayEndOffset).toBe(5)
  })

  // Codex P2 on PR #290 cycle 7: the session baseline cwd (used by
  // `addPane` for new shells) is persisted on `grouping.workspaceDirectory`
  // and must be read back through to `session.workingDirectory` — NOT
  // derived from the active pane's drifted cwd.
  test('reads session.workingDirectory from grouping.workspaceDirectory when present', () => {
    const ws = 'ws-baseline'

    const sessions = groupSessionsFromInfos([
      {
        id: 'pty-a',
        cwd: '/project/sub/feature-branch',
        status: {
          kind: 'Alive',
          pid: 1,
          replay_data: '',
          replay_end_offset: 0n,
        },
        grouping: grouping({
          workspaceSessionId: ws,
          layout: 'vsplit',
          workspaceDirectory: '/project',
          paneId: 'p0',
          paneIndex: 0,
          active: true,
        }),
      },
      {
        id: 'pty-b',
        cwd: '/project',
        status: {
          kind: 'Alive',
          pid: 2,
          replay_data: '',
          replay_end_offset: 0n,
        },
        grouping: grouping({
          workspaceSessionId: ws,
          layout: 'vsplit',
          workspaceDirectory: '/project',
          paneId: 'p1',
          paneIndex: 1,
        }),
      },
    ])
    expect(sessions[0].workingDirectory).toBe('/project')
    expect(sessions[0].name).toBe('project')
  })

  // Back-compat: a cache written before `workspaceDirectory` existed has
  // no value in the grouping; restore falls back to the active pane's
  // cwd (same as cycle-6 behavior).
  test('falls back to active pane cwd when grouping.workspaceDirectory is absent', () => {
    const ws = 'ws-legacy'

    const sessions = groupSessionsFromInfos([
      {
        id: 'pty-a',
        cwd: '/legacy-project',
        status: {
          kind: 'Alive',
          pid: 1,
          replay_data: '',
          replay_end_offset: 0n,
        },
        grouping: grouping({
          workspaceSessionId: ws,
          layout: 'single',
          paneId: 'p0',
          paneIndex: 0,
          active: true,
          // workspaceDirectory deliberately omitted.
        }),
      },
    ])
    expect(sessions[0].workingDirectory).toBe('/legacy-project')
  })

  // PR #290 cycle 11: Claude MEDIUM — the grouped path guards
  // `order.push` inside `!buckets.has`, but the ungrouped (`__solo:`)
  // branch did not. A duplicate `info.id` (from a corrupt
  // `session_order` with repeated entries) would push the same key
  // into `order` twice and produce two restored sessions sharing one
  // ptyId; `registerPtySession` collisions would leave one pane
  // permanently blank. The duplicate guard makes the ungrouped path
  // robust to that input.
  test('drops duplicate ungrouped PTY ids — first wins', () => {
    const sessions = groupSessionsFromInfos([
      alive('pty-dup', '/repo/a'),
      alive('pty-dup', '/repo/b'),
    ])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].panes[0].ptyId).toBe('pty-dup')
    expect(sessions[0].panes[0].cwd).toBe('/repo/a')
  })
})

const shellShape = (
  overrides: Partial<WorkspaceShapeShellPane> = {}
): WorkspaceShapeShellPane => ({
  kind: 'shell',
  paneId: 'p0',
  paneIndex: 0,
  active: false,
  ptyId: 'pty-a',
  cwd: '/home/will/repo',
  agentType: 'generic',
  agentSessionId: null,
  ...overrides,
})

const browserShape = (
  overrides: Partial<WorkspaceShapeBrowserPane> = {}
): WorkspaceShapeBrowserPane => ({
  kind: 'browser',
  paneId: 'p0',
  paneIndex: 0,
  active: false,
  ...overrides,
})

const storeOf = (
  sessions: WorkspaceShapeDto['sessions']
): WorkspaceShapeDto => ({ sessions })

const storeSession = (
  overrides: Partial<WorkspaceShapeDto['sessions'][number]> = {}
): WorkspaceShapeDto['sessions'][number] => ({
  id: 'ws-1',
  projectId: 'proj-1',
  layout: 'single',
  workingDirectory: '/home/will/repo',
  active: true,
  panes: [shellShape({ active: true })],
  ...overrides,
})

describe('reconstructWorkspace', () => {
  // Store absent (unknown version / corrupt / first run) → fall back entirely
  // to the PTY-driven #290 reconstruction, so a reload with no durable store
  // behaves exactly like today.
  test('null store falls back to PTY-driven groupSessionsFromInfos', () => {
    const live = [alive('pty-x', '/repo/x'), alive('pty-y', '/repo/y')]

    const sessions = reconstructWorkspace(null, live, 'pty-x')
    const baseline = groupSessionsFromInfos(live)

    expect(sessions.map((s) => s.id)).toEqual(baseline.map((s) => s.id))
    expect(sessions.map((s) => s.panes.map((p) => p.ptyId))).toEqual(
      baseline.map((s) => s.panes.map((p) => p.ptyId))
    )
    expect(sessions.map((s) => s.layout)).toEqual(baseline.map((s) => s.layout))
  })

  // Store present: a shell pane whose ptyId is alive reattaches under the
  // STORE's session id (not the PTY-driven solo id), preserving replay data.
  test('reattaches an alive shell under the store session id', () => {
    const store = storeOf([
      storeSession({
        id: 'ws-alive',
        panes: [shellShape({ ptyId: 'pty-a', active: true })],
      }),
    ])

    const live: SessionInfo[] = [
      {
        id: 'pty-a',
        cwd: '/home/will/repo',
        status: {
          kind: 'Alive',
          pid: 4321,
          replay_data: 'scrollback',
          replay_end_offset: 9n,
        },
      },
    ]

    const sessions = reconstructWorkspace(store, live, 'pty-a')

    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('ws-alive')
    expect(sessions[0].panes).toHaveLength(1)
    const pane = sessions[0].panes[0]
    expect(pane.ptyId).toBe('pty-a')
    expect(pane.status).toBe('running')
    expect(pane.restoreData?.replayData).toBe('scrollback')
    expect(pane.restoreData?.replayEndOffset).toBe(9)
    expect(sessions[0].status).toBe('running')
  })

  // A shell pane whose PTY is gone (graceful quit / crash) returns as a
  // restartable `completed` placeholder seeded with the persisted cwd + agent.
  test('returns a restartable placeholder for a dead shell ptyId', () => {
    const store = storeOf([
      storeSession({
        id: 'ws-dead',
        workingDirectory: '/home/will/proj',
        panes: [
          shellShape({
            ptyId: 'pty-gone',
            cwd: '/home/will/proj/sub',
            agentType: 'codex',
            active: true,
          }),
        ],
      }),
    ])

    const sessions = reconstructWorkspace(store, [], null)

    expect(sessions).toHaveLength(1)
    const pane = sessions[0].panes[0]
    expect(pane.ptyId).toBe('pty-gone')
    expect(pane.status).toBe('completed')
    expect(pane.cwd).toBe('/home/will/proj/sub')
    expect(pane.agentType).toBe('codex')
    expect(pane.restoreData).toBeUndefined()
    expect(pane.pid).toBeUndefined()
    expect(sessions[0].status).toBe('completed')
    expect(sessions[0].agentType).toBe('codex')
  })

  // Browser-only session: no PTY exists; the store is the sole source.
  test('builds a browser-only session from a browser pane shape', () => {
    const store = storeOf([
      storeSession({
        id: 'ws-browser',
        workingDirectory: '/home/will/proj',
        panes: [browserShape({ paneId: 'p0', paneIndex: 0, active: true })],
      }),
    ])

    const sessions = reconstructWorkspace(store, [], null)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('ws-browser')
    expect(sessions[0].status).toBe('idle')
    const pane = sessions[0].panes[0]
    expect(pane.kind).toBe('browser')
    expect(pane.ptyId.startsWith('browser:')).toBe(true)
    expect(pane.agentType).toBe('generic')
    expect(pane.status).toBe('idle')
    expect(pane.cwd).toBe('/home/will/proj')
    expect(pane.active).toBe(true)
  })

  // Mixed session: the browser pane is restored idle and the aggregate status
  // derives from the shell placeholder. Panes sort by paneIndex.
  test('mixed dead-shell + browser derives status from shell panes', () => {
    const store = storeOf([
      storeSession({
        id: 'ws-mixed',
        layout: 'vsplit',
        workingDirectory: '/home/will/proj',
        // Deliberately out of paneIndex order — reconstruction must sort.
        panes: [
          browserShape({ paneId: 'p1', paneIndex: 1, active: true }),
          shellShape({
            paneId: 'p0',
            paneIndex: 0,
            ptyId: 'pty-dead',
            active: false,
          }),
        ],
      }),
    ])

    const sessions = reconstructWorkspace(store, [], null)

    expect(sessions).toHaveLength(1)
    const s = sessions[0]
    expect(s.panes.map((p) => p.id)).toEqual(['p0', 'p1'])
    expect(s.panes[0].status).toBe('completed')
    expect(s.panes[1].kind).toBe('browser')
    expect(s.panes[1].status).toBe('idle')
    expect(s.panes.filter((p) => p.active)).toHaveLength(1)
    expect(s.panes.find((p) => p.active)?.id).toBe('p1')
    expect(s.status).toBe('completed')
    expect(s.layout).toBe('vsplit')
  })

  test('reload shape restores browser-only and mixed browser sessions together', () => {
    const store = storeOf([
      storeSession({
        id: 'ws-browser',
        workingDirectory: '/home/will/proj',
        panes: [browserShape({ paneId: 'p0', paneIndex: 0, active: true })],
      }),
      storeSession({
        id: 'ws-mixed',
        layout: 'vsplit',
        active: false,
        workingDirectory: '/home/will/proj',
        panes: [
          shellShape({
            paneId: 'p0',
            paneIndex: 0,
            ptyId: 'pty-dead',
            cwd: '/home/will/proj/sub',
            agentType: 'codex',
            active: false,
          }),
          browserShape({ paneId: 'p1', paneIndex: 1, active: true }),
        ],
      }),
    ])

    const sessions = reconstructWorkspace(store, [], null)
    const browserOnly = sessions.find((session) => session.id === 'ws-browser')
    const mixed = sessions.find((session) => session.id === 'ws-mixed')

    expect(browserOnly).toBeDefined()
    expect(mixed).toBeDefined()
    if (!browserOnly || !mixed) {
      throw new Error('expected browser-only and mixed sessions')
    }

    expect(browserOnly.status).toBe('idle')
    expect(browserOnly.panes).toHaveLength(1)
    expect(browserOnly.panes[0].kind).toBe('browser')

    expect(mixed.status).toBe('completed')
    expect(mixed.panes.map((pane) => pane.id)).toEqual(['p0', 'p1'])
    expect(mixed.panes[0].kind ?? 'shell').toBe('shell')
    expect(mixed.panes[0]).toEqual(
      expect.objectContaining({
        ptyId: 'pty-dead',
        status: 'completed',
        cwd: '/home/will/proj/sub',
        agentType: 'codex',
      })
    )
    expect(mixed.panes[0]).not.toHaveProperty('pid')
    expect(mixed.panes[0]).not.toHaveProperty('restoreData')
    expect(mixed.panes[1]).toEqual(
      expect.objectContaining({
        kind: 'browser',
        status: 'idle',
        active: true,
      })
    )
  })

  // Multiple active store panes (a transient push race wrote >1) → exactly one,
  // first-flagged wins.
  test('fixes up multiple active store panes to exactly one', () => {
    const store = storeOf([
      storeSession({
        id: 'ws-multi',
        layout: 'vsplit',
        panes: [
          browserShape({ paneId: 'p0', paneIndex: 0, active: true }),
          browserShape({ paneId: 'p1', paneIndex: 1, active: true }),
        ],
      }),
    ])

    const active = reconstructWorkspace(store, [], null)[0].panes.filter(
      (p) => p.active
    )
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe('p0')
  })

  // Union: a live PTY the store never references must still come back (a tab
  // created since the last store write) — appended as a #290 solo session.
  test('reconstructs a live PTY the store does not reference', () => {
    const store = storeOf([
      storeSession({
        id: 'ws-1',
        panes: [shellShape({ ptyId: 'pty-a', active: true })],
      }),
    ])
    const live = [alive('pty-a', '/home/will/repo'), alive('pty-new', '/other')]

    const sessions = reconstructWorkspace(store, live, 'pty-a')

    expect(sessions).toHaveLength(2)
    expect(sessions.map((s) => s.id)).toContain('ws-1')
    expect(sessions.map((s) => s.id)).toContain('pty-new')
  })

  // The store is authoritative for shape: a live-only session whose grouping id
  // The store is authoritative for shape, BUT a live PTY is never dropped: when
  // a reconstructed live-only session's id collides with a store session (a live
  // cache newer than the store), it is re-keyed to its first PTY and kept, so
  // the running agent still gets a tab.
  test('re-keys (never drops) a live PTY whose grouping id collides with a store session', () => {
    const store = storeOf([
      storeSession({
        id: 'ws-1',
        panes: [shellShape({ ptyId: 'pty-a', active: true })],
      }),
    ])

    const live: SessionInfo[] = [
      alive('pty-a', '/home/will/repo'),
      {
        ...alive('pty-orphan', '/home/will/repo'),
        grouping: grouping({
          workspaceSessionId: 'ws-1',
          layout: 'single',
          paneId: 'p9',
          paneIndex: 0,
          active: true,
        }),
      },
    ]

    const sessions = reconstructWorkspace(store, live, 'pty-a')

    // The store session is untouched; the orphan PTY survives under a
    // non-colliding id (its own ptyId), never dropped.
    expect(sessions).toHaveLength(2)
    const storeSession1 = sessions.find((s) => s.id === 'ws-1')
    expect(storeSession1?.panes.map((p) => p.ptyId)).toEqual(['pty-a'])
    const recovered = sessions.find((s) => s.id === 'pty-orphan')
    expect(recovered).toBeDefined()
    expect(recovered?.panes.map((p) => p.ptyId)).toEqual(['pty-orphan'])
    // No duplicate session ids in the result.
    expect(new Set(sessions.map((s) => s.id)).size).toBe(2)
  })

  // Fallback path keeps #290's active-pane reconcile: when no store exists,
  // `activeSessionId` overrides stale grouping `active` flags.
  test('null store reconciles active pane from activeSessionId', () => {
    const ws = 'ws-recon'

    const live: SessionInfo[] = [
      {
        ...alive('pty-a', '/home/will/repo'),
        grouping: grouping({
          workspaceSessionId: ws,
          layout: 'vsplit',
          workspaceDirectory: '/home/will/repo',
          paneId: 'p0',
          paneIndex: 0,
          active: true,
          agentType: 'claude-code',
        }),
      },
      {
        ...alive('pty-b', '/home/will/repo'),
        grouping: grouping({
          workspaceSessionId: ws,
          layout: 'vsplit',
          workspaceDirectory: '/home/will/repo',
          paneId: 'p1',
          paneIndex: 1,
          active: false,
          agentType: 'codex',
        }),
      },
    ]

    const sessions = reconstructWorkspace(null, live, 'pty-b')

    expect(sessions).toHaveLength(1)
    expect(sessions[0].panes.find((p) => p.active)?.ptyId).toBe('pty-b')
    expect(sessions[0].agentType).toBe('codex')
  })

  // A persisted session with zero panes is malformed (partial write / crash /
  // migration gap). It must be skipped — not crash — and the remaining valid
  // sessions plus live PTYs must still restore.
  test('skips zero-pane store sessions without aborting restore', () => {
    const store = storeOf([
      storeSession({
        id: 'ws-empty',
        panes: [],
      }),
      storeSession({
        id: 'ws-valid',
        panes: [shellShape({ ptyId: 'pty-a', active: true })],
      }),
    ])
    const live = [alive('pty-a', '/home/will/repo'), alive('pty-b', '/other')]

    const sessions = reconstructWorkspace(store, live, 'pty-a')

    // The empty session is dropped; the valid store session and the live PTY
    // both survive.
    expect(sessions).toHaveLength(2)
    expect(sessions.map((s) => s.id)).toContain('ws-valid')
    expect(sessions.map((s) => s.id)).toContain('pty-b')
    expect(sessions.find((s) => s.id === 'ws-valid')?.panes).toHaveLength(1)
  })
})
