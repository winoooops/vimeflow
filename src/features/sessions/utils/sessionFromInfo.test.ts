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

  test('Exited with a non-zero last_exit_code hydrates as errored', () => {
    const info: SessionInfo = {
      id: 'pty-err',
      cwd: '/x',
      status: { kind: 'Exited', last_exit_code: 3 },
    }
    const session = sessionFromInfo(info, 0)
    expect(session.status).toBe('errored')
    expect(session.panes[0].status).toBe('errored')
  })

  test('Exited with exit code 0 hydrates as completed', () => {
    const info: SessionInfo = {
      id: 'pty-ok',
      cwd: '/x',
      status: { kind: 'Exited', last_exit_code: 0 },
    }
    expect(sessionFromInfo(info, 0).status).toBe('completed')
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
})
