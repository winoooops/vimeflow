import { describe, expect, test } from 'vitest'
import { AgentRenameError } from '../../../lib/backend'
import {
  isExpectedLocalOnlyRenameFailure,
  isExpectedNonAgentRenameFailure,
  supportsAgentRename,
} from './agentRenameErrors'

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

describe('supportsAgentRename', () => {
  test('matches agents with transcript rename support', () => {
    expect(supportsAgentRename('claude-code')).toBe(true)
    expect(supportsAgentRename('codex')).toBe(true)
  })

  test('rejects local-only or missing pane types', () => {
    expect(supportsAgentRename('aider')).toBe(false)
    expect(supportsAgentRename('generic')).toBe(false)
    expect(supportsAgentRename(null)).toBe(false)
  })
})

describe('isExpectedLocalOnlyRenameFailure', () => {
  test('keeps expected failures local only for rename-incapable panes', () => {
    expect(
      isExpectedLocalOnlyRenameFailure(
        new AgentRenameError('no live agent', 'no-live-agent'),
        'generic'
      )
    ).toBe(true)
  })

  test('does not suppress expected backend failures for rename-capable panes', () => {
    expect(
      isExpectedLocalOnlyRenameFailure(
        new AgentRenameError('no live agent', 'no-live-agent'),
        'claude-code'
      )
    ).toBe(false)
  })
})
