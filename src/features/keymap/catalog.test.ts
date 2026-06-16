import { describe, expect, test } from 'vitest'
import { CATALOG, getCommand, type CommandId } from './catalog'
import { exactlyOneSuper } from './chord'

describe('CATALOG', () => {
  test('ids are unique', () => {
    const ids = CATALOG.map((cmd) => cmd.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('the ten PR1-migrated commands are rebindable; the rest are display-only', () => {
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
      ].sort()
    )
  })

  test('every rebindable default has exactly one super (terminal-safety)', () => {
    for (const cmd of CATALOG.filter((c) => c.rebindable)) {
      const def =
        typeof cmd.defaultCombo === 'function'
          ? cmd.defaultCombo(true)
          : cmd.defaultCombo
      expect(exactlyOneSuper(def)).toBe(true)
    }
  })

  test('getCommand resolves a known id and is typed', () => {
    const id: CommandId = 'dock-toggle'
    expect(getCommand(id).label).toBe('Show / hide editor & diff dock')
  })
})
