// cspell:ignore vsplit hsplit
import { describe, expect, test } from 'vitest'
import { emptyActivity } from '../constants'
import type { LayoutId, Pane, Session } from '../types'
import {
  applyAddPane,
  applyRemovePane,
  autoShrinkLayoutFor,
  nextFreePaneId,
  pickNextActivePaneId,
} from './paneLifecycle'

const mockPane = (overrides: Partial<Pane> = {}): Pane => ({
  id: 'p0',
  ptyId: 'pty-0',
  cwd: '/home/test',
  agentType: 'generic',
  status: 'running',
  active: true,
  ...overrides,
})

const mockSession = (overrides: Partial<Session> = {}): Session => ({
  id: 's0',
  projectId: 'proj-1',
  name: 'test',
  status: 'running',
  workingDirectory: '/home/test',
  agentType: 'generic',
  layout: 'vsplit',
  panes: [mockPane({ id: 'p0', active: true })],
  createdAt: '2026-05-12T00:00:00Z',
  lastActivityAt: '2026-05-12T00:00:00Z',
  activity: { ...emptyActivity },
  ...overrides,
})

describe('autoShrinkLayoutFor', () => {
  test('1 pane shrinks to single', () => {
    expect(autoShrinkLayoutFor(1, 'quad')).toBe('single')
    expect(autoShrinkLayoutFor(1, 'vsplit')).toBe('single')
    expect(autoShrinkLayoutFor(1, 'hsplit')).toBe('single')
  })

  test('0 panes shrinks to single defensively', () => {
    expect(autoShrinkLayoutFor(0, 'vsplit')).toBe('single')
  })

  test('2 panes from hsplit preserves hsplit', () => {
    expect(autoShrinkLayoutFor(2, 'hsplit')).toBe('hsplit')
  })

  test('2 panes from other layouts shrinks to vsplit', () => {
    expect(autoShrinkLayoutFor(2, 'vsplit')).toBe('vsplit')
    expect(autoShrinkLayoutFor(2, 'threeRight')).toBe('vsplit')
    expect(autoShrinkLayoutFor(2, 'quad')).toBe('vsplit')
    expect(autoShrinkLayoutFor(2, 'single')).toBe('vsplit')
  })

  test('3 panes shrinks to threeRight', () => {
    expect(autoShrinkLayoutFor(3, 'quad')).toBe('threeRight')
    expect(autoShrinkLayoutFor(3, 'vsplit')).toBe('threeRight')
  })

  test('4 or more panes preserves current layout defensively', () => {
    expect(autoShrinkLayoutFor(4, 'quad')).toBe('quad')
    expect(autoShrinkLayoutFor(5, 'quad')).toBe('quad')
  })
})

describe('pickNextActivePaneId', () => {
  test('picks predecessor when it exists', () => {
    expect(
      pickNextActivePaneId([mockPane({ id: 'p0' }), mockPane({ id: 'p1' })], 1)
    ).toBe('p0')
  })

  test('closing first pane falls through to successor', () => {
    expect(
      pickNextActivePaneId(
        [
          mockPane({ id: 'p0' }),
          mockPane({ id: 'p1' }),
          mockPane({ id: 'p2' }),
        ],
        0
      )
    ).toBe('p1')
  })

  test('closing only pane returns null', () => {
    expect(pickNextActivePaneId([mockPane()], 0)).toBeNull()
  })

  test('empty array returns null', () => {
    expect(pickNextActivePaneId([], 0)).toBeNull()
  })
})

describe('nextFreePaneId', () => {
  test('empty panes uses p0', () => {
    expect(nextFreePaneId([])).toBe('p0')
  })

  test('contiguous panes use next index', () => {
    expect(nextFreePaneId([mockPane({ id: 'p0' })])).toBe('p1')
    expect(
      nextFreePaneId([mockPane({ id: 'p0' }), mockPane({ id: 'p1' })])
    ).toBe('p2')
  })

  test('fills the smallest hole left by remove', () => {
    expect(
      nextFreePaneId([mockPane({ id: 'p0' }), mockPane({ id: 'p2' })])
    ).toBe('p1')
  })

  test('unordered array still finds smallest free id', () => {
    expect(
      nextFreePaneId([
        mockPane({ id: 'p1' }),
        mockPane({ id: 'p0' }),
        mockPane({ id: 'p2' }),
      ])
    ).toBe('p3')
  })
})

describe('applyAddPane', () => {
  const newPane: Pane = {
    id: 'p1',
    ptyId: 'pty-1',
    cwd: '/home/test',
    agentType: 'generic',
    status: 'running',
    active: true,
  }

  test('appends pane and flips existing pane to inactive', () => {
    const result = applyAddPane([mockSession()], 's0', newPane, 2)

    expect(result.appended).toBe(true)
    expect(result.sessions[0].panes).toHaveLength(2)
    expect(result.sessions[0].panes[0].active).toBe(false)
    expect(result.sessions[0].panes[1]).toMatchObject({
      id: 'p1',
      active: true,
    })
  })

  test('re-derives workingDirectory and agentType from new active pane', () => {
    const result = applyAddPane(
      [mockSession()],
      's0',
      { ...newPane, cwd: '/tmp/scratch', agentType: 'codex' },
      2
    )

    expect(result.sessions[0].workingDirectory).toBe('/tmp/scratch')
    expect(result.sessions[0].agentType).toBe('codex')
  })

  test('re-derives Session.status via deriveSessionStatus', () => {
    const result = applyAddPane(
      [
        mockSession({
          status: 'completed',
          panes: [mockPane({ id: 'p0', status: 'completed', active: true })],
        }),
      ],
      's0',
      newPane,
      2
    )

    expect(result.sessions[0].status).toBe('running')
  })

  test('no-ops on missing sessionId', () => {
    const sessions = [mockSession()]
    const result = applyAddPane(sessions, 'unknown', newPane, 2)

    expect(result.appended).toBe(false)
    expect(result.sessions).toBe(sessions)
  })

  test('no-ops on pane id collision', () => {
    const sessions = [mockSession()]
    const result = applyAddPane(sessions, 's0', { ...newPane, id: 'p0' }, 2)

    expect(result.appended).toBe(false)
    expect(result.sessions).toBe(sessions)
  })

  test('no-ops when panes length reaches capacity', () => {
    const sessions = [
      mockSession({
        panes: [
          mockPane({ id: 'p0', active: false }),
          mockPane({ id: 'p1', active: true }),
        ],
      }),
    ]

    const result = applyAddPane(sessions, 's0', newPane, 2)

    expect(result.appended).toBe(false)
    expect(result.sessions).toBe(sessions)
  })

  test('leaves other sessions untouched', () => {
    const untouched = mockSession({ id: 's1' })
    const result = applyAddPane([mockSession(), untouched], 's0', newPane, 2)

    expect(result.sessions[1]).toBe(untouched)
  })
})

describe('applyRemovePane', () => {
  const twoPaneSession = (
    active: 'p0' | 'p1' = 'p0',
    layout: LayoutId = 'vsplit'
  ): Session =>
    mockSession({
      layout,
      panes: [
        mockPane({
          id: 'p0',
          ptyId: 'pty-0',
          cwd: '/dir-0',
          agentType: 'claude-code',
          active: active === 'p0',
        }),
        mockPane({
          id: 'p1',
          ptyId: 'pty-1',
          cwd: '/dir-1',
          agentType: 'codex',
          active: active === 'p1',
        }),
      ],
    })

  test('removes pane and auto-shrinks vsplit to single', () => {
    const result = applyRemovePane([twoPaneSession('p0')], 's0', 'p1', 'vsplit')

    expect(result.sessions[0].panes).toHaveLength(1)
    expect(result.sessions[0].layout).toBe('single')
    expect(result.removedPtyId).toBe('pty-1')
  })

  test('closing active pane rotates to predecessor and sets newActivePtyId', () => {
    const result = applyRemovePane([twoPaneSession('p1')], 's0', 'p1', 'vsplit')

    expect(result.sessions[0].panes[0]).toMatchObject({
      id: 'p0',
      active: true,
    })
    expect(result.newActivePtyId).toBe('pty-0')
    expect(result.sessions[0].workingDirectory).toBe('/dir-0')
    expect(result.sessions[0].agentType).toBe('claude-code')
  })

  test('closing inactive pane leaves active flag untouched', () => {
    const result = applyRemovePane([twoPaneSession('p0')], 's0', 'p1', 'vsplit')

    expect(result.sessions[0].panes[0].active).toBe(true)
    expect(result.newActivePtyId).toBeUndefined()
  })

  test('closing in quad shrinks to threeRight', () => {
    const result = applyRemovePane(
      [
        mockSession({
          layout: 'quad',
          panes: [
            mockPane({ id: 'p0', ptyId: 'pty-0', active: true }),
            mockPane({ id: 'p1', ptyId: 'pty-1', active: false }),
            mockPane({ id: 'p2', ptyId: 'pty-2', active: false }),
            mockPane({ id: 'p3', ptyId: 'pty-3', active: false }),
          ],
        }),
      ],
      's0',
      'p3',
      'quad'
    )

    expect(result.sessions[0].panes).toHaveLength(3)
    expect(result.sessions[0].layout).toBe('threeRight')
  })

  test('hsplit with one remaining pane shrinks to single', () => {
    const result = applyRemovePane(
      [twoPaneSession('p0', 'hsplit')],
      's0',
      'p1',
      'hsplit'
    )

    expect(result.sessions[0].layout).toBe('single')
  })

  test('re-derives Session.status via deriveSessionStatus', () => {
    const result = applyRemovePane(
      [
        mockSession({
          status: 'running',
          layout: 'vsplit',
          panes: [
            mockPane({ id: 'p0', status: 'completed', active: false }),
            mockPane({ id: 'p1', status: 'running', active: true }),
          ],
        }),
      ],
      's0',
      'p1',
      'vsplit'
    )

    expect(result.sessions[0].status).toBe('completed')
  })

  test('no-ops on missing sessionId', () => {
    const sessions = [twoPaneSession()]
    const result = applyRemovePane(sessions, 'unknown', 'p0', 'vsplit')

    expect(result.sessions).toBe(sessions)
    expect(result.removedPtyId).toBeUndefined()
  })

  test('no-ops on missing paneId', () => {
    const sessions = [twoPaneSession()]
    const result = applyRemovePane(sessions, 's0', 'pX', 'vsplit')

    expect(result.sessions).toBe(sessions)
    expect(result.removedPtyId).toBeUndefined()
  })

  test('no-ops on single-pane session', () => {
    const sessions = [mockSession({ layout: 'single' })]
    const result = applyRemovePane(sessions, 's0', 'p0', 'single')

    expect(result.sessions).toBe(sessions)
    expect(result.removedPtyId).toBeUndefined()
  })
})
