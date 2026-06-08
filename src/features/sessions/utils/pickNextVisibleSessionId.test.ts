import { describe, test, expect } from 'vitest'
import {
  getVisibleSessions,
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
  activityPanelCollapsed: false,
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

describe('getVisibleSessions', () => {
  test('a split session with one errored pane and one live pane stays visible', () => {
    // Aggregate status is errored (errored-dominant display), but the session
    // still has a live pane — visibility is pane-level, so it must not drop.
    const mixed: Session = {
      ...buildSession('mixed', 'errored'),
      panes: [
        {
          id: 'p0',
          ptyId: 'mixed',
          cwd: '~',
          agentType: 'claude-code',
          status: 'errored',
          active: false,
        },
        {
          id: 'p1',
          ptyId: 'mixed',
          cwd: '~',
          agentType: 'claude-code',
          status: 'running',
          active: true,
        },
      ] as Session['panes'],
    }

    expect(getVisibleSessions([mixed], null).map((s) => s.id)).toEqual([
      'mixed',
    ])
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

  test('skips sessions that are neither live nor the active one', () => {
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
    // B is not active and not live → not visible → no fallback can be
    // computed from this set. Caller decides what to do.
    expect(pickNextVisibleSessionId(sessions, 'B', 'A')).toBeUndefined()
  })

  test('treats an idle session as live (not skipped)', () => {
    const sessions = [buildSession('A', 'idle'), buildSession('B', 'completed')]
    expect(pickNextVisibleSessionId(sessions, 'A', 'A')).toBeUndefined()
    // A is idle and active, so it is visible; only one visible session.
  })
})
