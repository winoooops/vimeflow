import { describe, expect, test } from 'vitest'
import {
  COMMAND_PALETTE_SHORTCUT_KEYS,
  commandPaletteShortcutModifierForPlatform,
  isCommandPaletteToggle,
} from './shortcutConfig'

describe('command palette shortcut config', () => {
  test('uses platform-conditional display keys', () => {
    expect(COMMAND_PALETTE_SHORTCUT_KEYS).toEqual(['Mod', ';'])
  })

  test('selects meta on macOS and ctrl elsewhere', () => {
    expect(commandPaletteShortcutModifierForPlatform('MacIntel')).toBe('meta')
    expect(commandPaletteShortcutModifierForPlatform('Linux x86_64')).toBe(
      'ctrl'
    )
    expect(commandPaletteShortcutModifierForPlatform('Win32')).toBe('ctrl')
  })

  test('matches the configured ctrl shortcut', () => {
    expect(
      isCommandPaletteToggle(
        new KeyboardEvent('keydown', {
          key: ';',
          ctrlKey: true,
        }),
        'ctrl'
      )
    ).toBe(true)

    expect(
      isCommandPaletteToggle(
        new KeyboardEvent('keydown', {
          key: ';',
          ctrlKey: true,
          shiftKey: true,
        }),
        'ctrl'
      )
    ).toBe(false)

    expect(
      isCommandPaletteToggle(
        new KeyboardEvent('keydown', {
          key: ';',
          metaKey: true,
        }),
        'ctrl'
      )
    ).toBe(false)
  })

  test('matches the configured meta shortcut', () => {
    expect(
      isCommandPaletteToggle(
        new KeyboardEvent('keydown', {
          key: ';',
          metaKey: true,
        }),
        'meta'
      )
    ).toBe(true)

    expect(
      isCommandPaletteToggle(
        new KeyboardEvent('keydown', {
          key: ';',
          metaKey: true,
          shiftKey: true,
        }),
        'meta'
      )
    ).toBe(false)

    expect(
      isCommandPaletteToggle(
        new KeyboardEvent('keydown', {
          key: ';',
          ctrlKey: true,
        }),
        'meta'
      )
    ).toBe(false)
  })
})
