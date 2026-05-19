import { describe, expect, test } from 'vitest'
import { formatShortcut } from './formatShortcut'

describe('formatShortcut', () => {
  describe('macOS rendering', () => {
    test('Mod resolves to ⌘ and chord has no separators', () => {
      expect(formatShortcut(['Mod', 'E'], { isMac: true })).toBe('⌘E')
    })

    test('multi-modifier chord stays separator-free per Apple HIG', () => {
      expect(formatShortcut(['Mod', 'Shift', 'P'], { isMac: true })).toBe('⌘⇧P')
    })

    test('named keys map to glyphs', () => {
      expect(formatShortcut(['Mod', 'Enter'], { isMac: true })).toBe('⌘⏎')
      expect(formatShortcut(['Mod', 'Escape'], { isMac: true })).toBe('⌘⎋')
      expect(formatShortcut(['Alt', 'ArrowUp'], { isMac: true })).toBe('⌥↑')
    })

    test('single-key shortcut renders without separator', () => {
      expect(formatShortcut('Escape', { isMac: true })).toBe('⎋')
    })
  })

  describe('non-macOS rendering', () => {
    test('Mod resolves to Ctrl and chord uses + separators', () => {
      expect(formatShortcut(['Mod', 'E'], { isMac: false })).toBe('Ctrl+E')
    })

    test('multi-modifier chord joins with +', () => {
      expect(formatShortcut(['Mod', 'Shift', 'P'], { isMac: false })).toBe(
        'Ctrl+Shift+P'
      )
    })

    test('unknown keys pass through unchanged', () => {
      expect(formatShortcut(['Mod', 'Alt', 'O'], { isMac: false })).toBe(
        'Ctrl+Alt+O'
      )
    })

    test('single-key shortcut renders without separator', () => {
      expect(formatShortcut('F1', { isMac: false })).toBe('F1')
    })
  })

  test('accepts a tuple input', () => {
    expect(formatShortcut(['Mod', '\\'], { isMac: true })).toBe('⌘\\')
  })

  test('accepts a string input', () => {
    expect(formatShortcut('F2', { isMac: false })).toBe('F2')
  })
})
