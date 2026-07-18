import { describe, expect, test } from 'vitest'
import {
  resolveBindings,
  resolveDefault,
  type CustomKeybindings,
} from './resolve'
import { CATALOG, type CommandId } from './catalog'
import { formatChord } from './chord'

const tokenOf = (
  overrides: CustomKeybindings,
  id: CommandId,
  isMac = true
): string => formatChord(resolveBindings(overrides, isMac, 'meta').get(id)!)

describe('workspace keybinding defaults', () => {
  const expected: Record<string, string> = {
    'focus-pane-1': 'Mod+Digit1',
    'focus-pane-2': 'Mod+Digit2',
    'focus-pane-3': 'Mod+Digit3',
    'focus-pane-4': 'Mod+Digit4',
    'cycle-layout': 'Mod+Backslash',
    'focus-pane-left': 'Mod+Shift+ArrowLeft',
    'focus-pane-down': 'Mod+Shift+ArrowDown',
    'focus-pane-up': 'Mod+Shift+ArrowUp',
    'focus-pane-right': 'Mod+Shift+ArrowRight',
    'dock-toggle': 'Mod+Digit0',
    palette: 'Mod+Semicolon',
    'palette-leader': 'Mod+Semicolon',
    'sidebar-sessions': 'Mod+Shift+KeyS',
    'sidebar-files': 'Mod+Shift+KeyF',
    'focus-editor': 'Mod+KeyE',
    'focus-diff': 'Mod+KeyG',
    'burner-toggle': 'Ctrl+Backquote',
  }
  for (const isMac of [true, false]) {
    for (const [id, token] of Object.entries(expected)) {
      test(`${id} default = ${token} (isMac=${isMac})`, () => {
        const cmd = CATALOG.find((c) => c.id === id)!
        expect(formatChord(resolveDefault(cmd, isMac))).toBe(token)
      })
    }
  }
})

describe('platform-specific workspace keybinding defaults', () => {
  const expectedByPlatform: Record<string, { mac: string; other: string }> = {
    'activity-panel-toggle': {
      mac: 'Mod+KeyR',
      other: 'Mod+Shift+KeyR',
    },
    'new-session': { mac: 'Mod+KeyN', other: 'Mod+Shift+KeyN' },
    'session-prev': {
      mac: 'Mod+BracketLeft',
      other: 'Mod+Shift+BracketLeft',
    },
    'session-next': {
      mac: 'Mod+BracketRight',
      other: 'Mod+Shift+BracketRight',
    },
    'sidebar-toggle': { mac: 'Mod+KeyB', other: 'Mod+Shift+KeyB' },
  }

  for (const [id, expected] of Object.entries(expectedByPlatform)) {
    test(`${id} has a platform-specific default`, () => {
      const cmd = CATALOG.find((c) => c.id === id)!

      expect(formatChord(resolveDefault(cmd, true))).toBe(expected.mac)
      expect(formatChord(resolveDefault(cmd, false))).toBe(expected.other)
    })
  }
})

describe('resolveBindings', () => {
  test('a valid override on a rebindable command wins', () => {
    expect(tokenOf({ 'dock-toggle': 'Mod+KeyK' }, 'dock-toggle')).toBe(
      'Mod+KeyK'
    )
  })

  test('a Shift-only Diff override wins', () => {
    expect(
      tokenOf({ 'diff-line-next': 'Shift+ArrowDown' }, 'diff-line-next')
    ).toBe('Shift+ArrowDown')
  })

  test('confirmation commands may reuse state-exclusive submit and cancel bindings', () => {
    const overrides: CustomKeybindings = {
      'diff-confirm-accept': 'Enter',
      'diff-confirm-cancel': 'Escape',
    }

    expect(tokenOf(overrides, 'diff-confirm-accept')).toBe('Enter')
    expect(tokenOf(overrides, 'diff-confirm-cancel')).toBe('Escape')
  })

  test('an unusable hand-edited Diff code falls back to its default', () => {
    expect(tokenOf({ 'diff-line-next': 'garbage' }, 'diff-line-next')).toBe(
      'KeyJ'
    )
  })

  test('a browser-location override wins', () => {
    expect(
      tokenOf({ 'browser-location': 'Mod+KeyK' }, 'browser-location')
    ).toBe('Mod+KeyK')
  })

  test('stored overrides colliding with browser shortcuts are reverted', () => {
    expect(tokenOf({ 'focus-pane-2': 'Mod+KeyL' }, 'focus-pane-2')).toBe(
      'Mod+Digit2'
    )
  })

  test('override on the PR3-migrated palette command wins', () => {
    expect(tokenOf({ palette: 'Mod+KeyP' }, 'palette')).toBe('Mod+KeyP')
  })

  test('palette and leader overrides may intentionally share a binding', () => {
    const overrides: CustomKeybindings = {
      palette: 'Mod+KeyP',
      'palette-leader': 'Mod+KeyP',
    }

    expect(tokenOf(overrides, 'palette')).toBe('Mod+KeyP')
    expect(tokenOf(overrides, 'palette-leader')).toBe('Mod+KeyP')
  })

  test('override on a rebindable:false command is ignored', () => {
    expect(tokenOf({ settings: 'Mod+KeyP' }, 'settings')).toBe('Mod+Comma')
  })

  test('super-less / both-super / malformed overrides fall back to default', () => {
    expect(tokenOf({ 'dock-toggle': 'Digit0' }, 'dock-toggle')).toBe(
      'Mod+Digit0'
    ) // no super

    expect(tokenOf({ 'dock-toggle': 'Mod+Ctrl+Digit0' }, 'dock-toggle')).toBe(
      'Mod+Digit0'
    ) // both supers

    expect(tokenOf({ 'dock-toggle': 'garbage' }, 'dock-toggle')).toBe(
      'Mod+Digit0'
    ) // unparseable
  })

  test('a clean A↔B swap keeps BOTH overrides (final-set validation)', () => {
    const overrides: CustomKeybindings = {
      'focus-pane-1': 'Mod+Digit2', // = pane-2’s default
      'focus-pane-2': 'Mod+Digit1', // = pane-1’s default
    }
    expect(tokenOf(overrides, 'focus-pane-1')).toBe('Mod+Digit2')
    expect(tokenOf(overrides, 'focus-pane-2')).toBe('Mod+Digit1')
  })

  test('both overrides onto a key that is also another default revert to their own defaults', () => {
    const overrides: CustomKeybindings = {
      'focus-pane-1': 'Mod+Digit3',
      'focus-pane-2': 'Mod+Digit3',
    }
    expect(tokenOf(overrides, 'focus-pane-1')).toBe('Mod+Digit1')
    expect(tokenOf(overrides, 'focus-pane-2')).toBe('Mod+Digit2')
  })

  test('two overrides onto the same FREE key: catalog-order first one loses, the other keeps it', () => {
    const overrides: CustomKeybindings = {
      'focus-pane-1': 'Mod+KeyK',
      'focus-pane-2': 'Mod+KeyK',
    }
    expect(tokenOf(overrides, 'focus-pane-1')).toBe('Mod+Digit1') // reverted
    expect(tokenOf(overrides, 'focus-pane-2')).toBe('Mod+KeyK') // survivor
  })

  test('stored overrides colliding with fixed settings shortcuts are reverted', () => {
    expect(tokenOf({ 'dock-toggle': 'Mod+Comma' }, 'dock-toggle')).toBe(
      'Mod+Digit0'
    )
  })
})
