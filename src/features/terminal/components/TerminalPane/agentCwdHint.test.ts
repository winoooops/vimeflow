// cspell:ignore worktree worktrees
import { describe, expect, test } from 'vitest'
import { parseAgentCwdHint } from './agentCwdHint'

describe('parseAgentCwdHint', () => {
  test('extracts Claude EnterWorktree absolute path hints', () => {
    expect(
      parseAgentCwdHint(
        '● Entering worktree(/home/will/projects/vimeflow/.claude/worktrees/dummy)\r\n'
      )
    ).toBe('/home/will/projects/vimeflow/.claude/worktrees/dummy')
  })

  test('handles ANSI styled Claude output', () => {
    expect(
      parseAgentCwdHint('\x1b[34m●\x1b[0m Entering worktree(/tmp/dummy)\r\n')
    ).toBe('/tmp/dummy')
  })

  test('returns the latest valid worktree path in a chunk', () => {
    expect(
      parseAgentCwdHint(
        'Entering worktree(/tmp/one)\r\nSwitched\r\nEntering worktree(/tmp/two)'
      )
    ).toBe('/tmp/two')
  })

  test('rejects shell cwd reset narration and relative paths', () => {
    expect(
      parseAgentCwdHint('Shell cwd was reset to /home/will/projects/vimeflow')
    ).toBeNull()
    expect(parseAgentCwdHint('Entering worktree(relative/path)')).toBeNull()
  })
})
