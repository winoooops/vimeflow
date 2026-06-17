import { describe, expect, test } from 'vitest'
import {
  exactlyOneSuper,
  formatChord,
  parseChord,
  type Chord,
  type Mod,
} from './chord'

const chord = (code: string, ...mods: Mod[]): Chord => ({
  code,
  mods: new Set(mods),
})

describe('formatChord', () => {
  test('orders mods canonically (Mod, Ctrl, Alt, Shift) then code', () => {
    expect(formatChord(chord('KeyC', 'Mod'))).toBe('Mod+KeyC')
    expect(formatChord(chord('ArrowLeft', 'Shift', 'Mod'))).toBe(
      'Mod+Shift+ArrowLeft'
    )
    expect(formatChord(chord('Backquote', 'Ctrl'))).toBe('Ctrl+Backquote')
  })
})

describe('parseChord', () => {
  test('round-trips every token shape', () => {
    for (const token of [
      'Mod+KeyC',
      'Mod+Shift+ArrowLeft',
      'Ctrl+Backquote',
      'Mod+Digit1',
    ]) {
      expect(formatChord(parseChord(token)!)).toBe(token)
    }
  })

  test('returns null on malformed / empty / unknown-mod / both-super', () => {
    expect(parseChord('')).toBeNull()
    expect(parseChord('Mod+')).toBeNull()
    expect(parseChord('+KeyC')).toBeNull()
    expect(parseChord('Hyper+KeyC')).toBeNull()
    expect(parseChord('Mod+Mod+KeyC')).toBeNull() // duplicate
    expect(parseChord('Mod+Ctrl+KeyC')).toBeNull() // both supers — unsatisfiable
  })
})

describe('exactlyOneSuper', () => {
  test('true iff exactly one of Mod / literal Ctrl', () => {
    expect(exactlyOneSuper(chord('KeyC', 'Mod'))).toBe(true)
    expect(exactlyOneSuper(chord('Backquote', 'Ctrl'))).toBe(true)
    expect(exactlyOneSuper(chord('KeyC', 'Mod', 'Shift'))).toBe(true)
    expect(exactlyOneSuper(chord('KeyJ'))).toBe(false) // bare key — zero supers
  })
})
