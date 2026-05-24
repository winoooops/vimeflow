import { describe, expect, test } from 'vitest'
import { isExpectedNonAgentRenameFailure } from './agentRenameErrors'

describe('isExpectedNonAgentRenameFailure', () => {
  test('matches backend no-live-agent failures', () => {
    expect(isExpectedNonAgentRenameFailure('no live agent')).toBe(true)
  })

  test('matches unsupported /rename failures', () => {
    expect(
      isExpectedNonAgentRenameFailure(
        'agent type Aider does not support /rename'
      )
    ).toBe(true)
  })

  test('does not match unexpected PTY failures', () => {
    expect(isExpectedNonAgentRenameFailure('pty write failed')).toBe(false)
  })
})
