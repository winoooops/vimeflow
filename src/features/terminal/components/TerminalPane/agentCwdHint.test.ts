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

  test('preserves POSIX UNC paths from agent cwd hints', () => {
    expect(
      parseAgentCwdHint('Entering worktree(//server/share/repo)\r\n')
    ).toBe('//server/share/repo')

    expect(parseAgentCwdHint('! cd //server/share/repo\r\n')).toBe(
      '//server/share/repo'
    )

    expect(parseAgentCwdHint('! cd ///tmp/worktree\r\n')).toBe('/tmp/worktree')
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

  test('resolves relative cd commands from POSIX UNC current cwd', () => {
    expect(parseAgentCwdHint('! cd child\r\n', '//server/share/repo')).toBe(
      '//server/share/repo/child'
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

  test('uses Claude startup home cwd with additional safe banner lines', () => {
    expect(
      parseAgentCwdHint(
        'Claude Code v2.1.145\r\n' +
          'Opus 4.7 with max effort\r\n' +
          'Plan mode off\r\n' +
          'Trusted workspace\r\n' +
          'Session restored\r\n' +
          '~/projects/vimeflow\r\n' +
          '! cd .claude/worktrees/codex-agent-osc7-cwd\r\n',
        '/home/will'
      )
    ).toBe(
      '/home/will/projects/vimeflow/.claude/worktrees/codex-agent-osc7-cwd'
    )
  })

  test('keeps additional safe Claude startup lines across chunks', () => {
    const context = getAgentCwdHintContext(
      'Claude Code v2.1.145\r\n' +
        'Opus 4.7 with max effort\r\n' +
        'Plan mode off\r\n' +
        'Trusted workspace\r\n' +
        'Session restored\r\n' +
        'Loaded tools\r\n' +
        'Ready\r\n'
    )

    expect(
      parseAgentCwdHint(
        context +
          '~/projects/vimeflow\r\n' +
          '! cd .claude/worktrees/codex-agent-osc7-cwd\r\n',
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

  test('extracts Claude superpowers skill `- Path: <abs>` lines', () => {
    // Mirrors the actual `EnterWorktree` skill report block — agents that
    // intentionally avoid mutating $PWD still announce the worktree path
    // through a stable label format.
    expect(
      parseAgentCwdHint(
        'Worktree ready.\r\n\r\n' +
          '- Path: /home/will/projects/simple-tui/.claude/worktrees/dummies-test\r\n' +
          '- Branch: worktree-dummies-test\r\n' +
          '- Clean working tree\r\n'
      )
    ).toBe('/home/will/projects/simple-tui/.claude/worktrees/dummies-test')
  })

  test('extracts path emitted under a `Switched to worktree on branch` anchor', () => {
    // The path is indented on a subsequent line, not on the same line as the
    // anchor — same shape as the superpowers skill's report header.
    expect(
      parseAgentCwdHint(
        '  Switched to worktree on branch worktree-dummies-test\r\n' +
          '  | /home/will/projects/simple-tui/.claude/worktrees/dummies-test\r\n'
      )
    ).toBe('/home/will/projects/simple-tui/.claude/worktrees/dummies-test')
  })

  test('extracts path emitted under a Codex `Created and entered ... worktree:` anchor', () => {
    expect(
      parseAgentCwdHint(
        'Created and entered the dummy worktree:\r\n\r\n' +
          '/home/will/projects/vimeflow/.claude/worktrees/codex-dummy-worktree\r\n\r\n' +
          "It's on branch codex-dummy-worktree. I'll use that path as the working directory for follow-up commands.\r\n"
      )
    ).toBe(
      '/home/will/projects/vimeflow/.claude/worktrees/codex-dummy-worktree'
    )
  })

  test('extracts the path emitted under a `Ran pwd` anchor through starship noise', () => {
    // Real Codex output from the screenshot: `Ran pwd` is followed by two
    // `[ERROR] - (starship::print)` lines before the actual pwd output. The
    // parser must skip noise and pick the first absolute path within a small
    // window of lines.
    expect(
      parseAgentCwdHint(
        'Ran pwd\r\n' +
          "  L [ERROR] - (starship::print): Under a 'dumb' terminal (TERM=dumb).\r\n" +
          "    [ERROR] - (starship::print): Under a 'dumb' terminal (TERM=dumb).\r\n" +
          '    /home/will/projects/vimeflow/.claude/worktrees/codex-dummy-worktree\r\n'
      )
    ).toBe(
      '/home/will/projects/vimeflow/.claude/worktrees/codex-dummy-worktree'
    )
  })

  test('latest signal wins when multiple worktree announcements arrive in one chunk', () => {
    expect(
      parseAgentCwdHint(
        '- Path: /tmp/old\r\n\r\n' +
          'Created and entered the dummy worktree:\r\n\r\n' +
          '/tmp/new\r\n'
      )
    ).toBe('/tmp/new')
  })

  test('does not treat unrelated absolute paths after the anchor as cwd hints', () => {
    // The path after a `Ran pwd` anchor must look like a directory; a path
    // with a file extension is almost certainly an error message or file
    // reference, not the current cwd.
    expect(
      parseAgentCwdHint(
        'Ran pwd\r\n' +
          '  /home/will/projects/vimeflow/src/main.rs: error[E0123]\r\n'
      )
    ).toBeNull()
  })

  test('accepts versioned worktree directory names like release-1.5', () => {
    // Regression: `looksLikeFilePath` previously matched any single-dot
    // basename with an alphanumeric extension and dropped the path. That
    // misclassified semver-styled worktrees (`v2.0`, `release-1.5`,
    // `feature-1.0`) as file references. The extension class now requires
    // at least one letter, so pure-numeric suffixes pass through.
    expect(
      parseAgentCwdHint(
        'Ran pwd\r\n' +
          '  /home/will/projects/repo/.claude/worktrees/release-1.5\r\n'
      )
    ).toBe('/home/will/projects/repo/.claude/worktrees/release-1.5')

    expect(
      parseAgentCwdHint(
        'Ran pwd\r\n  /home/will/projects/repo/.claude/worktrees/v2.0\r\n'
      )
    ).toBe('/home/will/projects/repo/.claude/worktrees/v2.0')
  })

  test('still rejects file-extension last segments like main.rs', () => {
    // Negative companion to the versioned-dir test: real source files
    // (extension starts with a letter) MUST still be rejected.
    expect(
      parseAgentCwdHint(
        'Created and entered the dummy worktree:\r\n\r\n' +
          '/home/will/projects/repo/src/main.rs\r\n'
      )
    ).toBeNull()
  })

  test('extracts anchored cwd paths that contain spaces', () => {
    // Codex P2: paths with spaces (common on macOS — `Code Projects`,
    // `Application Support`) were dropped because the old extractor
    // split on whitespace and only inspected the last token. The new
    // extractor takes the body-after-tree-prefix verbatim.
    expect(
      parseAgentCwdHint(
        'Ran pwd\r\n' +
          '  /Users/alice/Code Projects/repo/.claude/worktrees/foo\r\n'
      )
    ).toBe('/Users/alice/Code Projects/repo/.claude/worktrees/foo')
  })

  test('PATH_LABEL_PATTERN requires a worktree anchor in recent context', () => {
    // Codex P1: bare `- Path:` matches in unrelated summaries (file
    // listings, skill reports) should NOT update pane.cwd. The handler
    // now looks back up to 10 non-empty lines for a worktree-related
    // anchor phrase. With a matching anchor it fires; without it it
    // returns null.
    expect(
      parseAgentCwdHint(
        'Worktree ready.\r\n\r\n' +
          '- Path: /home/will/projects/repo/.claude/worktrees/dummy\r\n' +
          '- Branch: worktree-dummy\r\n'
      )
    ).toBe('/home/will/projects/repo/.claude/worktrees/dummy')

    expect(
      parseAgentCwdHint(
        'Summary of files I touched:\r\n\r\n' +
          '- Path: /home/will/projects/repo/some-unrelated-directory\r\n'
      )
    ).toBeNull()
  })

  test('PATH_LABEL_PATTERN rejects file-like paths even with anchor', () => {
    // Symmetric with the anchor-driven extractor: a worktree report
    // emitting `- Path: /repo/main.rs` should still not update pane.cwd.
    expect(
      parseAgentCwdHint(
        'Worktree ready.\r\n\r\n' +
          '- Path: /home/will/projects/repo/src/main.rs\r\n'
      )
    ).toBeNull()
  })
})
