import { describe, expect, test } from 'vitest'
import { AgentRenameError } from '../../../lib/backend'
import { isExpectedNonAgentRenameFailure } from './agentRenameErrors'

describe('isExpectedNonAgentRenameFailure', () => {
  test('matches backend no-live-agent failures', () => {
    expect(
      isExpectedNonAgentRenameFailure(
        new AgentRenameError(
          'the human-readable backend message can change',
          'no-live-agent'
        )
      )
    ).toBe(true)
  })

  test('matches unsupported /rename failures', () => {
    expect(
      isExpectedNonAgentRenameFailure(
        new AgentRenameError(
          'the human-readable backend message can change',
          'unsupported-agent'
        )
      )
    ).toBe(true)
  })

  test('does not match unexpected PTY failures', () => {
    expect(
      isExpectedNonAgentRenameFailure(
        new AgentRenameError('pty write failed', 'pty-write')
      )
    ).toBe(false)
  })

  test('does not classify plain strings by backend message text', () => {
    expect(isExpectedNonAgentRenameFailure('no live agent')).toBe(false)
  })
})
