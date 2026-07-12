import { describe, expect, test } from 'vitest'
import { buildAgentResumeCommand } from './agentResumeCommand'

describe('buildAgentResumeCommand', () => {
  test.each([
    ['claude-code', "claude --resume 'conversation-1'"],
    ['codex', "codex resume 'conversation-1'"],
    ['kimi', "kimi --session 'conversation-1'"],
    ['opencode', "opencode --session 'conversation-1'"],
  ] as const)('builds the canonical %s command', (agentType, expected) => {
    expect(buildAgentResumeCommand(agentType, 'conversation-1')).toBe(expected)
  })

  test.each([
    ['claude-code', 'claude --continue'],
    ['codex', 'codex resume --last'],
    ['kimi', 'kimi --continue'],
    ['opencode', 'opencode --continue'],
  ] as const)(
    'builds the latest-conversation %s command when identity is missing',
    (agentType, expected) => {
      expect(buildAgentResumeCommand(agentType, null)).toBe(expected)
      expect(buildAgentResumeCommand(agentType, undefined)).toBe(expected)
    }
  )

  test.each([
    ['generic', 'conversation-1'],
    ['aider', 'conversation-1'],
    ['claude-code', ''],
    ['codex', "valid'; touch /tmp/injected; echo '"],
    ['kimi', 'contains whitespace'],
  ] as const)('rejects unsupported or unsafe input', (agentType, sessionId) => {
    expect(buildAgentResumeCommand(agentType, sessionId)).toBeNull()
  })
})
