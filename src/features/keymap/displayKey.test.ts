import { describe, expect, test } from 'vitest'
import { chordToShortcutInput } from './displayKey'
import { formatShortcut } from '../../lib/formatShortcut'
import type { Chord, Mod } from './chord'

const c = (code: string, ...mods: Mod[]): Chord => ({
  code,
  mods: new Set(mods),
})

describe('chordToShortcutInput', () => {
  test('maps code + mods to formatShortcut tokens in display order', () => {
    expect(chordToShortcutInput(c('KeyC', 'Mod'))).toEqual(['Mod', 'C'])
    expect(chordToShortcutInput(c('Digit1', 'Mod'))).toEqual(['Mod', '1'])
    expect(chordToShortcutInput(c('Backslash', 'Mod'))).toEqual(['Mod', '\\'])
    expect(chordToShortcutInput(c('ArrowLeft', 'Mod', 'Shift'))).toEqual([
      'Mod',
      'Shift',
      '←',
    ])
    expect(chordToShortcutInput(c('Backquote', 'Ctrl'))).toEqual(['Ctrl', '`'])
  })

  test('round-trips through formatShortcut to the right glyphs', () => {
    expect(
      formatShortcut(chordToShortcutInput(c('KeyC', 'Mod')), { isMac: true })
    ).toBe('⌘C')
    expect(
      formatShortcut(chordToShortcutInput(c('KeyB', 'Mod', 'Shift')), {
        isMac: false,
      })
    ).toBe('Ctrl+Shift+B')
  })
})
