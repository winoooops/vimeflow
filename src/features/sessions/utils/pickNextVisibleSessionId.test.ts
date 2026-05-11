import { describe, test, expect } from 'vitest'
import {
  isOpenSessionStatus,
  pickNextVisibleSessionId,
} from './pickNextVisibleSessionId'
import type { Session, SessionStatus } from '../types'

const buildSession = (id: string, status: SessionStatus): Session => ({
  id,
  projectId: 'p1',
  name: id,
  status,
  workingDirectory: '~',
  agentType: 'claude-code',
  layout: 'single',
  panes: [
    {
      id: 'p0',
      ptyId: id,
      cwd: '~',
      agentType: 'claude-code',
      status,
      active: true,
    },
  ],
  createdAt: '2026-05-06T00:00:00Z',
  lastActivityAt: '2026-05-06T00:00:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 200_000, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 200 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
})

describe('isOpenSessionStatus', () => {
  test('running and paused are open; completed and errored are not', () => {
    expect(isOpenSessionStatus('running')).toBe(true)
    expect(isOpenSessionStatus('paused')).toBe(true)
    expect(isOpenSessionStatus('completed')).toBe(false)
    expect(isOpenSessionStatus('errored')).toBe(false)
  })
})

describe('pickNextVisibleSessionId', () => {
  test('picks the right neighbor in visible order', () => {
    const sessions = [
      buildSession('A', 'running'),
      buildSession('B', 'running'),
      buildSession('C', 'running'),
    ]
    expect(pickNextVisibleSessionId(sessions, 'B', 'B')).toBe('C')
  })

  test('wraps to the left neighbor when the removed session is last', () => {
    const sessions = [
      buildSession('A', 'running'),
      buildSession('B', 'running'),
      buildSession('C', 'running'),
    ]
    expect(pickNextVisibleSessionId(sessions, 'C', 'C')).toBe('B')
  })

  test('skips sessions that are neither open nor the active one', () => {
    // Hidden Recent session B sits between two open ones in array order.
    const sessions = [
      buildSession('A', 'running'),
      buildSession('B', 'completed'),
      buildSession('C', 'running'),
    ]
    expect(pickNextVisibleSessionId(sessions, 'A', 'A')).toBe('C')
  })

  test('includes the active session even when its status is exited', () => {
    // C is completed but currently active (TerminalZone shows Restart pane).
    // Removing C from the sidebar should pick the visually adjacent tab in
    // the strip — same semantics as SessionTabs.handleClose.
    const sessions = [
      buildSession('A', 'running'),
      buildSession('B', 'running'),
      buildSession('C', 'completed'),
    ]
    expect(pickNextVisibleSessionId(sessions, 'C', 'C')).toBe('B')
  })

  test('returns undefined when only one visible session exists', () => {
    const sessions = [buildSession('A', 'running')]
    expect(pickNextVisibleSessionId(sessions, 'A', 'A')).toBeUndefined()
  })

  test('returns undefined when the removed id is not visible', () => {
    const sessions = [
      buildSession('A', 'running'),
      buildSession('B', 'completed'),
    ]
    // B is not active and not open → not visible → no fallback can be
    // computed from this set. Caller decides what to do.
    expect(pickNextVisibleSessionId(sessions, 'B', 'A')).toBeUndefined()
  })
})
