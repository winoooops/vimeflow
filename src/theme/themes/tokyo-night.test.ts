import { expect, test } from 'vitest'
import { tokyoNightTheme } from './tokyo-night'

test('tokyo night uses the Terminal Colors default dark palette', () => {
  expect(tokyoNightTheme.id).toBe('tokyo-night')
  expect(tokyoNightTheme.label).toBe('Tokyo Night')
  expect(tokyoNightTheme.kind).toBe('dark')
  expect(tokyoNightTheme.ui.surface).toBe('#15161e')
  expect(tokyoNightTheme.ui['surface-container-highest']).toBe('#3b4263')
  expect(tokyoNightTheme.ui['surface-bright']).toBe('#3b4263')
  expect(tokyoNightTheme.ui.primary).toBe('#7aa2f7')
  expect(tokyoNightTheme.ui['on-surface']).toBe('#c0caf5')
  expect(tokyoNightTheme.terminal.background).toBe('#1a1b26')
  expect(tokyoNightTheme.terminal.foreground).toBe('#c0caf5')
  expect(tokyoNightTheme.terminal.selectionBackground).toBe('#283457')
  expect(tokyoNightTheme.terminal.black).toBe('#15161e')
  expect(tokyoNightTheme.terminal.brightBlack).toBe('#414868')
  expect(tokyoNightTheme.terminal.brightWhite).toBe('#c0caf5')
})
