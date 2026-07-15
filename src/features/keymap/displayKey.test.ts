import { describe, expect, test } from 'vitest'
import {
  chordToAriaShortcut,
  chordToKeycapShortcut,
  chordToShortcutInput,
  chordToVisibleShortcutInput,
} from './displayKey'
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
    expect(chordToShortcutInput(c('Slash'))).toEqual(['/'])
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

describe('chordToAriaShortcut', () => {
  test('uses platform-specific primary modifier names', () => {
    expect(chordToAriaShortcut(c('KeyC', 'Mod'), true)).toBe('Meta+c')
    expect(chordToAriaShortcut(c('KeyC', 'Mod'), false)).toBe('Control+c')
  })

  test('preserves secondary modifiers and logical key values', () => {
    expect(chordToAriaShortcut(c('KeyI', 'Shift'), true)).toBe('Shift+I')
    expect(chordToAriaShortcut(c('ArrowDown', 'Shift'), false)).toBe(
      'Shift+ArrowDown'
    )
    expect(chordToAriaShortcut(c('Slash'), false)).toBe('/')
  })
})

describe('chordToVisibleShortcutInput', () => {
  test('renders bare letter chords in typed case', () => {
    expect(chordToVisibleShortcutInput(c('KeyJ'))).toEqual(['j'])
    expect(chordToVisibleShortcutInput(c('KeyJ', 'Shift'))).toEqual([
      'Shift',
      'J',
    ])
  })

  test('keeps modifier shortcut labels conventional', () => {
    expect(chordToVisibleShortcutInput(c('KeyC', 'Mod'))).toEqual(['Mod', 'C'])
  })
})

describe('chordToKeycapShortcut', () => {
  test('renders platform modifiers as individual keycaps', () => {
    expect(
      chordToKeycapShortcut(c('KeyK', 'Mod', 'Alt', 'Shift'), true)
    ).toEqual(['⌘', '⌥', '⇧', 'K'])

    expect(
      chordToKeycapShortcut(c('KeyK', 'Mod', 'Alt', 'Shift'), false)
    ).toEqual(['Ctrl', 'Alt', '⇧', 'K'])

    expect(chordToKeycapShortcut(c('Backquote', 'Ctrl'), true)).toEqual([
      '⌃',
      '`',
    ])
  })
})
