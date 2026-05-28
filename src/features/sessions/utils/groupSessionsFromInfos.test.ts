import { describe, expect, test } from 'vitest'
import type { PaneGrouping, SessionInfo } from '../../../bindings'
import { groupSessionsFromInfos } from './groupSessionsFromInfos'

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
})
