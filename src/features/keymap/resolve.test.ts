import { describe, expect, test } from 'vitest'
import { resolveBindings, resolveDefault, type CustomKeybindings } from './resolve'
import { CATALOG, type CommandId } from './catalog'
import { formatChord } from './chord'

const tokenOf = (
  overrides: CustomKeybindings,
  id: CommandId,
  isMac = true
): string => formatChord(resolveBindings(overrides, isMac, 'meta').get(id)!)

describe('behavior preservation — migrated defaults equal today’s hardcoded combos', () => {
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

describe('resolveBindings', () => {
  test('a valid override on a rebindable command wins', () => {
    expect(tokenOf({ 'dock-toggle': 'Mod+KeyK' }, 'dock-toggle')).toBe('Mod+KeyK')
  })

  test('override on a rebindable:false command is ignored', () => {
    expect(tokenOf({ palette: 'Mod+KeyP' }, 'palette')).toBe('Mod+Semicolon')
  })

  test('super-less / both-super / malformed overrides fall back to default', () => {
    expect(tokenOf({ 'dock-toggle': 'Digit0' }, 'dock-toggle')).toBe('Mod+Digit0') // no super
    expect(tokenOf({ 'dock-toggle': 'Mod+Ctrl+Digit0' }, 'dock-toggle')).toBe('Mod+Digit0') // both supers
    expect(tokenOf({ 'dock-toggle': 'garbage' }, 'dock-toggle')).toBe('Mod+Digit0') // unparseable
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
})
