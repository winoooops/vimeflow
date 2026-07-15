import { describe, expect, test } from 'vitest'
import { CATALOG, DIFF_COMMANDS, getCommand, type CommandId } from './catalog'
import { formatChord } from './chord'
import { isValidBinding, resolveDefault } from './resolve'

describe('CATALOG', () => {
  test('ids are unique', () => {
    const ids = CATALOG.map((cmd) => cmd.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('workspace, browser, and Diff commands are rebindable', () => {
    const rebindable = CATALOG.filter((cmd) => cmd.rebindable)
      .map((cmd) => cmd.id)
      .sort()
    expect(rebindable).toEqual(
      [
        'focus-pane-1',
        'focus-pane-2',
        'focus-pane-3',
        'focus-pane-4',
        'focus-pane-5',
        'focus-pane-6',
        'focus-pane-7',
        'focus-pane-8',
        'focus-pane-9',
        'focus-pane-left',
        'focus-pane-down',
        'focus-pane-up',
        'focus-pane-right',
        'cycle-layout',
        'single-pane-focus',
        'dock-toggle',
        'activity-panel-toggle',
        'palette',
        'palette-leader',
        'new-session',
        'session-prev',
        'session-next',
        'sidebar-toggle',
        'sidebar-sessions',
        'sidebar-files',
        'focus-editor',
        'focus-diff',
        'burner-toggle',
        'browser-location',
        ...DIFF_COMMANDS.map((cmd) => cmd.id),
      ].sort()
    )
  })

  test('every rebindable default is valid for its context', () => {
    for (const cmd of CATALOG.filter((c) => c.rebindable)) {
      expect(isValidBinding(cmd, resolveDefault(cmd, true))).toBe(true)
    }
  })

  test('getCommand resolves a known id and is typed', () => {
    const id: CommandId = 'dock-toggle'
    expect(getCommand(id).label).toBe('Show / hide editor & diff dock')
  })

  test('registers every focus-scoped Diff command as rebindable', () => {
    expect(
      DIFF_COMMANDS.map((cmd) => [
        cmd.id,
        formatChord(resolveDefault(cmd, true)),
      ])
    ).toEqual([
      ['diff-line-next', 'KeyJ'],
      ['diff-line-previous', 'KeyK'],
      ['diff-scroll-page-down', 'Ctrl+KeyD'],
      ['diff-scroll-page-up', 'Ctrl+KeyU'],
      ['diff-file-next', 'KeyN'],
      ['diff-file-previous', 'KeyP'],
      ['diff-search-open', 'Slash'],
      ['diff-search-or-visual-cancel', 'Escape'],
      ['diff-search-commit-next', 'Enter'],
      ['diff-search-commit-previous', 'Shift+Enter'],
      ['diff-files-toggle', 'KeyE'],
      ['diff-files-pin', 'Shift+KeyE'],
      ['diff-refresh', 'KeyR'],
      ['diff-hunk-previous', 'BracketLeft'],
      ['diff-hunk-next', 'BracketRight'],
      ['diff-side-deletions', 'KeyH'],
      ['diff-side-additions', 'KeyL'],
      ['diff-view-toggle', 'KeyT'],
      ['diff-comment-line', 'KeyI'],
      ['diff-comment-file', 'Shift+KeyI'],
      ['diff-comment-update', 'KeyU'],
      ['diff-file-comment-update', 'Shift+KeyU'],
      ['diff-comment-delete', 'KeyX'],
      ['diff-comment-category-previous', 'Ctrl+KeyH'],
      ['diff-comment-category-next', 'Ctrl+KeyL'],
      ['diff-comment-insert-newline', 'Ctrl+KeyJ'],
      ['diff-comment-cursor-up', 'Ctrl+KeyK'],
      ['diff-comment-submit', 'Enter'],
      ['diff-comment-cancel', 'Escape'],
      ['diff-visual-start', 'KeyV'],
      ['diff-visual-yank', 'KeyY'],
      ['diff-review-finish', 'Shift+KeyY'],
      ['diff-review-request', 'Shift+Digit2'],
      ['diff-request-review-scope-file', 'KeyF'],
      ['diff-request-review-scope-changelist', 'KeyA'],
      ['diff-review-copy', 'KeyC'],
      ['diff-request-review-submit', 'Shift+KeyY'],
      ['diff-feedback-send', 'Shift+KeyY'],
      ['diff-commit-review-submit', 'Shift+KeyY'],
      ['diff-confirm-accept', 'KeyY'],
      ['diff-confirm-cancel', 'KeyN'],
      ['diff-hunk-stage', 'KeyS'],
      ['diff-hunk-discard', 'KeyD'],
      ['diff-file-discard', 'Shift+KeyD'],
    ])

    expect(
      DIFF_COMMANDS.every(
        (cmd) =>
          cmd.context === 'diff' &&
          cmd.group === 'Diff (when focused)' &&
          cmd.rebindable
      )
    ).toBe(true)
  })
})
