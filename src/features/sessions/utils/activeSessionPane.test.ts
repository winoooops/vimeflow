import { describe, expect, test, vi } from 'vitest'
import { emptyActivity } from '../constants'
import type { Pane, Session } from '../types'
import {
  applyActivePane,
  findActivePane,
  getActivePane,
} from './activeSessionPane'

const session = (panes: { id: string; active: boolean }[]): Session =>
  ({
    id: 'sess-1',
    panes,
  }) as unknown as Session

describe('getActivePane', () => {
  test('returns the single active pane', () => {
    const s = session([
      { id: 'p0', active: true },
      { id: 'p1', active: false },
    ])
    expect(getActivePane(s).id).toBe('p0')
  })

  test('throws when zero panes are active', () => {
    const s = session([
      { id: 'p0', active: false },
      { id: 'p1', active: false },
    ])
    expect(() => getActivePane(s)).toThrow(/exactly one active pane/)
  })

  test('throws when more than one pane is active', () => {
    const s = session([
      { id: 'p0', active: true },
      { id: 'p1', active: true },
    ])
    expect(() => getActivePane(s)).toThrow(/exactly one active pane/)
  })

  test('throws when panes is empty', () => {
    const s = session([])
    expect(() => getActivePane(s)).toThrow(/at least one pane/)
  })
})

describe('findActivePane (non-throwing variant for render/effect paths)', () => {
  test('returns the single active pane', () => {
    const s = session([
      { id: 'p0', active: true },
      { id: 'p1', active: false },
    ])
    expect(findActivePane(s)?.id).toBe('p0')
  })

  test('returns undefined when zero panes are active', () => {
    const s = session([
      { id: 'p0', active: false },
      { id: 'p1', active: false },
    ])
    expect(findActivePane(s)).toBeUndefined()
  })

  test('returns undefined when more than one pane is active', () => {
    const s = session([
      { id: 'p0', active: true },
      { id: 'p1', active: true },
    ])
    expect(findActivePane(s)).toBeUndefined()
  })

  test('returns undefined when panes is empty', () => {
    const s = session([])
    expect(findActivePane(s)).toBeUndefined()
  })
})

const makePane = (id: string, overrides: Partial<Pane> = {}): Pane => ({
  id,
  ptyId: `pty-${id}`,
  cwd: `/tmp/${id}`,
  agentType: 'generic',
  status: 'running',
  active: false,
  ...overrides,
})

const makeSession = (
  id: string,
  panes: Pane[],
  layout: Session['layout'] = 'vsplit'
): Session => ({
  id,
  projectId: 'proj-1',
  name: id,
  status: 'running',
  workingDirectory: panes.find((pane) => pane.active)?.cwd ?? panes[0].cwd,
  agentType: panes.find((pane) => pane.active)?.agentType ?? panes[0].agentType,
  layout,
  panes,
  createdAt: '2026-05-12T00:00:00Z',
  lastActivityAt: '2026-05-12T00:00:00Z',
  activity: { ...emptyActivity },
})

describe('applyActivePane', () => {
  test('flips active flag and re-derives workingDirectory and agentType', () => {
    const sessions: Session[] = [
      makeSession('s1', [
        makePane('p0', {
          active: true,
          cwd: '/tmp/p0',
          agentType: 'claude-code',
        }),
        makePane('p1', { cwd: '/tmp/p1', agentType: 'codex' }),
      ]),
    ]

    const next = applyActivePane(sessions, 's1', 'p1')
    const updated = next[0]

    expect(updated.panes.filter((pane) => pane.active)).toHaveLength(1)
    expect(updated.panes.find((pane) => pane.id === 'p1')?.active).toBe(true)
    expect(updated.panes.find((pane) => pane.id === 'p0')?.active).toBe(false)
    expect(updated.workingDirectory).toBe('/tmp/p1')
    expect(updated.agentType).toBe('codex')
  })

  test('returns the same array reference when target is already active', () => {
    const sessions: Session[] = [
      makeSession('s1', [makePane('p0', { active: true })]),
    ]

    expect(applyActivePane(sessions, 's1', 'p0')).toBe(sessions)
  })

  test('returns the same reference when sessionId is missing (silent — manager logs)', () => {
    // applyActivePane is now a pure helper (cycle 14). It no longer
    // logs on its own; the manager surfaces operator-visible warns
    // BEFORE invoking this function so the message fires exactly once
    // even under React StrictMode's double-invoked state updaters.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const sessions: Session[] = [
      makeSession('s1', [makePane('p0', { active: true })]),
    ]

    const next = applyActivePane(sessions, 'nope', 'p0')

    expect(next).toBe(sessions)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  test('returns the same reference when paneId is missing (silent — manager logs)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const sessions: Session[] = [
      makeSession('s1', [makePane('p0', { active: true })]),
    ]

    const next = applyActivePane(sessions, 's1', 'p-fake')

    expect(next).toBe(sessions)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  test('preserves identity of unaffected sessions', () => {
    const sessions: Session[] = [
      makeSession('s1', [makePane('p0', { active: true }), makePane('p1')]),
      makeSession('s2', [makePane('p0', { active: true })]),
    ]

    const next = applyActivePane(sessions, 's1', 'p1')

    expect(next[1]).toBe(sessions[1])
    expect(next[0]).not.toBe(sessions[0])
  })
})
