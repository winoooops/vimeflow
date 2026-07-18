import { describe, expect, test } from 'vitest'
import { CATALOG, DIFF_COMMANDS, getCommand, type CommandId } from './catalog'
import { formatChord, type Chord } from './chord'
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
        'session-switch-next',
        'session-switch-prev',
        'session-close',
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

describe('session switching commands', () => {
  test('registers the switcher pair and close command in the Sessions group', () => {
    const next = getCommand('session-switch-next')
    const prev = getCommand('session-switch-prev')
    const close = getCommand('session-close')

    for (const cmd of [next, prev, close]) {
      expect(cmd.group).toBe('Sessions')
      expect(cmd.context).toBe('global')
      expect(cmd.matchPolicy).toBe('exact')
      expect(cmd.rebindable).toBe(true)
    }
  })

  test('switcher defaults are literal Ctrl+Tab on both platforms', () => {
    const next = getCommand('session-switch-next')
    const prev = getCommand('session-switch-prev')
    expect(next.defaultCombo).toEqual({ code: 'Tab', mods: new Set(['Ctrl']) })
    expect(prev.defaultCombo).toEqual({
      code: 'Tab',
      mods: new Set(['Ctrl', 'Shift']),
    })
  })

  test('session-close is Mod+W on mac and Mod+Shift+W elsewhere', () => {
    const combo = getCommand('session-close').defaultCombo
    expect(typeof combo).toBe('function')
    const resolve = combo as (isMac: boolean) => Chord
    expect(resolve(true)).toEqual({ code: 'KeyW', mods: new Set(['Mod']) })
    expect(resolve(false)).toEqual({
      code: 'KeyW',
      mods: new Set(['Mod', 'Shift']),
    })
  })

  test('existing session commands moved to the Sessions group', () => {
    expect(getCommand('new-session').group).toBe('Sessions')
    expect(getCommand('session-prev').group).toBe('Sessions')
    expect(getCommand('session-next').group).toBe('Sessions')
  })

  test('pane digits stay tolerant (layout contract regression guard)', () => {
    for (let digit = 1; digit <= 9; digit += 1) {
      const id = `focus-pane-${digit}` as CommandId
      expect(getCommand(id).matchPolicy).toBe('tolerant')
    }
  })
})
