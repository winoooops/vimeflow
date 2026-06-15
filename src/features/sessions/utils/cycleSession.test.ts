import { describe, test, expect } from 'vitest'
import { cycleSession } from './cycleSession'
import type { Session } from '../types'

const buildSession = (id: string): Session => ({
  id,
  projectId: 'p1',
  name: id,
  status: 'running',
  workingDirectory: '~',
  agentType: 'claude-code',
  layout: 'single',
  activityPanelCollapsed: false,
  panes: [
    {
      id: `${id}-pane`,
      ptyId: id,
      cwd: '~',
      agentType: 'claude-code',
      status: 'running',
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

describe('cycleSession', () => {
  test('returns null for an empty session list', () => {
    expect(cycleSession([], 'a', 1)).toBeNull()
  })

  test('moves forward by delta', () => {
    const sessions = [buildSession('A'), buildSession('B'), buildSession('C')]
    expect(cycleSession(sessions, 'A', 1)?.id).toBe('B')
  })

  test('moves backward by delta', () => {
    const sessions = [buildSession('A'), buildSession('B'), buildSession('C')]
    expect(cycleSession(sessions, 'C', -1)?.id).toBe('B')
  })

  test('wraps forward from the last session to the first', () => {
    const sessions = [buildSession('A'), buildSession('B'), buildSession('C')]
    expect(cycleSession(sessions, 'C', 1)?.id).toBe('A')
  })

  test('wraps backward from the first session to the last', () => {
    const sessions = [buildSession('A'), buildSession('B'), buildSession('C')]
    expect(cycleSession(sessions, 'A', -1)?.id).toBe('C')
  })

  test('starts at the first session when active id is missing and delta is positive', () => {
    const sessions = [buildSession('A'), buildSession('B')]
    expect(cycleSession(sessions, 'missing', 1)?.id).toBe('A')
  })

  test('starts at the last session when active id is missing and delta is negative', () => {
    const sessions = [buildSession('A'), buildSession('B')]
    expect(cycleSession(sessions, 'missing', -1)?.id).toBe('B')
  })
})
