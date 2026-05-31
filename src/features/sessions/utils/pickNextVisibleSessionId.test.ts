import { describe, test, expect } from 'vitest'
import {
  getVisibleSessions,
  isOpenSessionStatus,
  pickNextVisibleSessionId,
} from './pickNextVisibleSessionId'
import type { Pane, Session, SessionStatus } from '../types'

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

const withBrowserPane = (
  session: Session,
  browserStatus: Pane['status']
): Session => ({
  ...session,
  panes: [
    ...session.panes,
    {
      id: 'browser-0',
      kind: 'browser',
      ptyId: `browser:${session.id}`,
      cwd: '~',
      agentType: 'generic',
      status: browserStatus,
      active: false,
      browserUrl: 'https://example.com/',
    },
  ],
})

describe('getVisibleSessions', () => {
  test('hides a fully-completed, non-active session', () => {
    const sessions = [
      buildSession('A', 'running'),
      buildSession('B', 'completed'),
    ]
    expect(getVisibleSessions(sessions, 'A').map((s) => s.id)).toEqual(['A'])
  })

  test('keeps a completed session that still has a running browser pane', () => {
    // The shell exited (status flips to completed) but a browser pane is still
    // live — the tab must stay reachable even when the session is not active,
    // or the native browser view is orphaned with no way back to it.
    const sessions = [
      buildSession('A', 'running'),
      withBrowserPane(buildSession('B', 'completed'), 'running'),
    ]
    expect(getVisibleSessions(sessions, 'A').map((s) => s.id)).toEqual([
      'A',
      'B',
    ])
  })

  test('hides a completed session whose browser pane has also exited', () => {
    const sessions = [
      buildSession('A', 'running'),
      withBrowserPane(buildSession('B', 'completed'), 'completed'),
    ]
    expect(getVisibleSessions(sessions, 'A').map((s) => s.id)).toEqual(['A'])
  })
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

  test('treats a completed session with a live browser pane as visible', () => {
    // B is completed and not active, but its browser pane is running, so it is
    // visible — removing A picks B (the right neighbor) rather than skipping to C.
    const sessions = [
      buildSession('A', 'running'),
      withBrowserPane(buildSession('B', 'completed'), 'running'),
      buildSession('C', 'running'),
    ]
    expect(pickNextVisibleSessionId(sessions, 'A', 'A')).toBe('B')
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
