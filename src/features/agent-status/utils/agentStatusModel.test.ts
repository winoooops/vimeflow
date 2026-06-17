import { describe, expect, test } from 'vitest'
import {
  createDefaultAgentStatus,
  mapDetectedAgentType,
} from './agentStatusModel'

describe('agentStatusModel', () => {
  test('maps backend agent type keys to UI agent types', () => {
    expect(mapDetectedAgentType('claudeCode')).toBe('claude-code')
    expect(mapDetectedAgentType('codex')).toBe('codex')
    expect(mapDetectedAgentType('aider')).toBe('aider')
    expect(mapDetectedAgentType('unknown')).toBe('generic')
  })

  test('creates a default status snapshot with null test-run state', () => {
    expect(createDefaultAgentStatus('pty-a')).toMatchObject({
      sessionId: 'pty-a',
      isActive: false,
      agentExited: false,
      agentType: null,
      numTurns: 0,
      toolCalls: { total: 0, byType: {}, active: null },
      recentToolCalls: [],
      testRun: null,
    })
  })
})
