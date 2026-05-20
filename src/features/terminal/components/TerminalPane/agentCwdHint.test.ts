// cspell:ignore codex worktree worktrees
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

  test('resolves Claude Bash cd commands from the current cwd', () => {
    expect(
      parseAgentCwdHint(
        '! cd .claude/worktrees/\r\n' +
          '(Bash completed with no output)\r\n' +
          '! cd codex-agent-osc7-cwd\r\n' +
          '(Bash completed with no output)\r\n',
        '/home/will/projects/vimeflow'
      )
    ).toBe(
      '/home/will/projects/vimeflow/.claude/worktrees/codex-agent-osc7-cwd'
    )
  })

  test('resolves Codex CLI cd transcript lines from the current cwd', () => {
    expect(
      parseAgentCwdHint(
        '• Ran cd .claude/worktrees && ls\r\n' +
          '  └ codex-agent-osc7-cwd\r\n' +
          '• Ran cd codex-agent-osc7-cwd\r\n',
        '/home/will/projects/vimeflow'
      )
    ).toBe(
      '/home/will/projects/vimeflow/.claude/worktrees/codex-agent-osc7-cwd'
    )
  })

  test('uses reset narration as the final cwd when Claude rejects a cd', () => {
    expect(
      parseAgentCwdHint(
        '! cd ../simple-tui\r\n' +
          '(Bash completed with no output)\r\n' +
          'Shell cwd was reset to /home/will/projects/vimeflow',
        '/home/will/projects/vimeflow'
      )
    ).toBe('/home/will/projects/vimeflow')
  })

  test('rejects unsupported cwd hints', () => {
    expect(parseAgentCwdHint('Entering worktree(relative/path)')).toBeNull()
    expect(parseAgentCwdHint('cd .claude/worktrees')).toBeNull()
    expect(parseAgentCwdHint('! cd .claude/worktrees')).toBeNull()
    expect(
      parseAgentCwdHint('Ran cd .claude/worktrees', '/home/will/project')
    ).toBeNull()

    expect(
      parseAgentCwdHint('$ cd .claude/worktrees', '/home/will/project')
    ).toBeNull()
  })
})
