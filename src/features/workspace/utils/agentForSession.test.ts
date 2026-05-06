import { describe, test, expect } from 'vitest'
import { agentForSession } from './agentForSession'
import { AGENTS } from '../../../agents/registry'
import type { Session } from '../types'

const baseSession: Omit<Session, 'agentType'> = {
  id: 's1',
  projectId: 'p1',
  name: 'demo',
  status: 'running',
  workingDirectory: '~',
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
}

describe('agentForSession', () => {
  test('claude-code maps to AGENTS.claude', () => {
    expect(agentForSession({ ...baseSession, agentType: 'claude-code' })).toBe(
      AGENTS.claude
    )
  })

  test('codex maps to AGENTS.codex', () => {
    expect(agentForSession({ ...baseSession, agentType: 'codex' })).toBe(
      AGENTS.codex
    )
  })

  test('aider falls back to AGENTS.shell', () => {
    expect(agentForSession({ ...baseSession, agentType: 'aider' })).toBe(
      AGENTS.shell
    )
  })

  test('generic falls back to AGENTS.shell', () => {
    expect(agentForSession({ ...baseSession, agentType: 'generic' })).toBe(
      AGENTS.shell
    )
  })
})
