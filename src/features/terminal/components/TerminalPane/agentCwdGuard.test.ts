// cspell:ignore worktree worktrees
import { describe, expect, test } from 'vitest'
import {
  isDescendantPath,
  shouldIgnoreStaleOsc7Cwd,
  stripCarriageReturnOverwrites,
  toComparablePath,
} from './agentCwdGuard'

describe('agent cwd guard helpers', () => {
  test('normalizes Windows separators for path comparisons', () => {
    expect(toComparablePath('C:\\Users\\will\\repo')).toBe('C:/Users/will/repo')
  })

  test('detects descendant paths without treating equal paths as descendants', () => {
    expect(isDescendantPath('/repo/worktree/child', '/repo/worktree')).toBe(
      true
    )
    expect(isDescendantPath('/repo/worktree', '/repo/worktree')).toBe(false)
  })

  test('ignores stale OSC 7 ancestors after an agent text hint moves deeper', () => {
    expect(
      shouldIgnoreStaleOsc7Cwd(
        '/repo/.claude/worktrees/test-branch/child',
        '/repo/.claude/worktrees/test-branch',
        'text-hint'
      )
    ).toBe(true)
  })

  test('ignores stale OSC 7 sibling worktrees after an agent text hint', () => {
    expect(
      shouldIgnoreStaleOsc7Cwd(
        '/repo/.claude/worktrees/test-branch',
        '/repo/.claude/worktrees/dummy',
        'text-hint'
      )
    ).toBe(true)
  })

  test('allows shell-owned OSC 7 sibling worktrees after user input', () => {
    expect(
      shouldIgnoreStaleOsc7Cwd(
        '/repo/.claude/worktrees/test-branch',
        '/repo/.claude/worktrees/dummy',
        'user-input'
      )
    ).toBe(false)
  })

  test('strips carriage-return progress output before hint parsing', () => {
    expect(
      stripCarriageReturnOverwrites('progress 10%\rprogress 20%\n! cd child')
    ).toBe('progress 20%\n! cd child')
  })
})
