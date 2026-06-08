import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { SessionInfo } from '../../../bindings'
import { sessionFromInfo } from './sessionFromInfo'
import { writeActivityPanelCollapsed } from './activityPanelCollapsedStore'

const aliveInfo = (id: string, cwd: string): SessionInfo => ({
  id,
  cwd,
  status: { kind: 'Alive', pid: 1234, replay_data: '', replay_end_offset: 0n },
})

describe('sessionFromInfo (pre-pane shape)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  test('produces a Session with id from info.id, status running for Alive', () => {
    const session = sessionFromInfo(aliveInfo('pty-1', '/home/will/repo'), 0)
    expect(session.id).toBe('pty-1')
    expect(session.status).toBe('running')
    expect(session.workingDirectory).toBe('/home/will/repo')
    expect(session.name).toBe('repo')
    expect(session.agentType).toBe('generic')
  })

  test('produces a Session with status completed for non-Alive', () => {
    const info: SessionInfo = {
      id: 'pty-2',
      cwd: '/x',
      status: { kind: 'Exited', last_exit_code: null },
    }
    const session = sessionFromInfo(info, 0)
    expect(session.status).toBe('completed')
  })

  test('Alive info produces a session with one running pane', () => {
    const session = sessionFromInfo(aliveInfo('pty-1', '/home/will/repo'), 0)
    expect(session.panes).toHaveLength(1)
    expect(session.panes[0].id).toBe('p0')
    expect(session.panes[0].ptyId).toBe('pty-1')
    expect(session.panes[0].active).toBe(true)
    expect(session.panes[0].status).toBe('running')
    expect(session.panes[0].restoreData).toBeDefined()
    expect(session.panes[0].restoreData?.pid).toBe(1234)
    expect(session.layout).toBe('single')
  })

  test('Exited info produces a session with one completed pane and no restoreData', () => {
    const info: SessionInfo = {
      id: 'pty-2',
      cwd: '/x',
      status: { kind: 'Exited', last_exit_code: null },
    }
    const session = sessionFromInfo(info, 0)
    expect(session.panes).toHaveLength(1)
    expect(session.panes[0].status).toBe('completed')
    expect(session.panes[0].restoreData).toBeUndefined()
  })

  test('hydrates session.activityPanelCollapsed from localStorage', () => {
    writeActivityPanelCollapsed('pty-1', true)
    const session = sessionFromInfo(aliveInfo('pty-1', '/home/x'), 0)
    expect(session.activityPanelCollapsed).toBe(true)
  })

  test('defaults session.activityPanelCollapsed to false when nothing persisted', () => {
    const session = sessionFromInfo(aliveInfo('pty-2', '/home/y'), 0)
    expect(session.activityPanelCollapsed).toBe(false)
  })

  test('hydrates cacheHistory from the store for an Alive pane', () => {
    window.localStorage.setItem(
      'vimeflow:agent:cacheHistory:pty-1',
      '[10,20,30]'
    )
    const session = sessionFromInfo(aliveInfo('pty-1', '/home/x'), 0)
    expect(session.panes[0].cacheHistory).toEqual([10, 20, 30])
  })

  test('defaults cacheHistory to [] when nothing persisted', () => {
    const session = sessionFromInfo(aliveInfo('pty-2', '/home/y'), 0)
    expect(session.panes[0].cacheHistory).toEqual([])
  })
})
