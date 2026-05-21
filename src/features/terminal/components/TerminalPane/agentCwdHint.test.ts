// cspell:ignore codex worktree worktrees
import { describe, expect, test } from 'vitest'
import { getAgentCwdHintContext, parseAgentCwdHint } from './agentCwdHint'

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

  test('strips OSC sequences before parsing Claude output', () => {
    expect(
      parseAgentCwdHint(
        '\x1b]7;file://host/ignored\x07● Entering worktree(/tmp/dummy)\r\n'
      )
    ).toBe('/tmp/dummy')
  })

  test('preserves closing parens inside Claude worktree paths', () => {
    expect(
      parseAgentCwdHint(
        'Entering worktree(/home/user/.claude/worktrees/feature/(org)-fix)\r\n'
      )
    ).toBe('/home/user/.claude/worktrees/feature/(org)-fix')
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

  test('uses Claude startup home cwd before resolving relative worktree cd commands', () => {
    expect(
      parseAgentCwdHint(
        'Claude Code v2.1.145\r\n' +
          'Opus 4.7 with max effort\r\n' +
          '~/projects/vimeflow\r\n' +
          '! cd .claude/worktrees/\r\n' +
          '(Bash completed with no output)\r\n' +
          '! cd codex-agent-osc7-cwd\r\n',
        '/home/will'
      )
    ).toBe(
      '/home/will/projects/vimeflow/.claude/worktrees/codex-agent-osc7-cwd'
    )
  })

  test('starts Claude startup context after a windows line ending', () => {
    expect(
      getAgentCwdHintContext(
        'previous output\r\nClaude Code v2.1.145\r\n~/projects/vimeflow'
      )
    ).toBe('Claude Code v2.1.145\r\n~/projects/vimeflow')
  })

  test('ignores bare home paths outside the Claude startup banner', () => {
    expect(
      parseAgentCwdHint('~/projects/vimeflow\r\n', '/home/will')
    ).toBeNull()

    expect(
      parseAgentCwdHint(
        'Here is a path example:\r\n~/projects/vimeflow\r\n',
        '/home/will'
      )
    ).toBeNull()
  })

  test('resolves home-relative Claude Bash cd commands', () => {
    expect(
      parseAgentCwdHint('! cd ~/projects/vimeflow\r\n', '/home/will')
    ).toBe('/home/will/projects/vimeflow')
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

  test('resolves relative cd commands from a Windows forward-slash cwd', () => {
    expect(
      parseAgentCwdHint(
        '! cd .claude/worktrees\r\n' + '! cd codex-agent-osc7-cwd\r\n',
        'C:/Users/will/projects/vimeflow'
      )
    ).toBe(
      'C:/Users/will/projects/vimeflow/.claude/worktrees/codex-agent-osc7-cwd'
    )
  })

  test('resolves relative cd commands from a Windows backslash cwd', () => {
    expect(
      parseAgentCwdHint(
        '! cd .claude\\worktrees\r\n' + '! cd codex-agent-osc7-cwd\r\n',
        'C:\\Users\\will\\projects\\vimeflow'
      )
    ).toBe(
      'C:\\Users\\will\\projects\\vimeflow\\.claude\\worktrees\\codex-agent-osc7-cwd'
    )
  })

  test('accepts bare absolute Windows cd targets', () => {
    expect(
      parseAgentCwdHint(
        '! cd C:\\Users\\will\\projects\\vimeflow\\.claude\\worktrees\\dummy\r\n',
        'C:\\Users\\will\\projects\\vimeflow'
      )
    ).toBe('C:\\Users\\will\\projects\\vimeflow\\.claude\\worktrees\\dummy')
  })

  test('accepts quoted absolute Windows cd targets', () => {
    expect(
      parseAgentCwdHint(
        '! cd "C:\\Users\\will\\projects\\vimeflow\\.claude\\worktrees\\dummy"\r\n',
        'C:\\Users\\will\\projects\\vimeflow'
      )
    ).toBe('C:\\Users\\will\\projects\\vimeflow\\.claude\\worktrees\\dummy')
  })

  test('unescapes double backslashes in quoted Windows cd targets', () => {
    expect(
      parseAgentCwdHint(
        '! cd "C:\\\\Users\\\\will\\\\projects\\\\vimeflow"\r\n',
        'C:\\Users\\will'
      )
    ).toBe('C:\\Users\\will\\projects\\vimeflow')
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

  test('ignores reset narration trailing context after the cwd path', () => {
    expect(
      parseAgentCwdHint(
        'Shell cwd was reset to /home/will/projects/vimeflow (previous: /tmp)',
        '/tmp'
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
