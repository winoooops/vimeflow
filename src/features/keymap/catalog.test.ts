import { describe, expect, test } from 'vitest'
import { CATALOG, getCommand, type CommandId } from './catalog'
import { exactlyOneSuper } from './chord'
import { resolveDefault } from './resolve'

describe('CATALOG', () => {
  test('ids are unique', () => {
    const ids = CATALOG.map((cmd) => cmd.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('PR1 + PR2 migrated commands are rebindable; the rest are display-only', () => {
    const rebindable = CATALOG.filter((cmd) => cmd.rebindable)
      .map((cmd) => cmd.id)
      .sort()
    expect(rebindable).toEqual(
      [
        'focus-pane-1',
        'focus-pane-2',
        'focus-pane-3',
        'focus-pane-4',
        'focus-pane-left',
        'focus-pane-down',
        'focus-pane-up',
        'focus-pane-right',
        'cycle-layout',
        'dock-toggle',
        'new-session',
        'session-prev',
        'session-next',
        'sidebar-toggle',
        'sidebar-sessions',
        'sidebar-files',
        'focus-editor',
        'focus-diff',
        'burner-toggle',
      ].sort()
    )
  })

  test('every rebindable default has exactly one super (terminal-safety)', () => {
    for (const cmd of CATALOG.filter((c) => c.rebindable)) {
      expect(exactlyOneSuper(resolveDefault(cmd, true))).toBe(true)
    }
  })

  test('getCommand resolves a known id and is typed', () => {
    const id: CommandId = 'dock-toggle'
    expect(getCommand(id).label).toBe('Show / hide editor & diff dock')
  })
})
