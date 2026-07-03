import { expect, test } from 'vitest'
import { gruvboxDark } from './gruvbox-dark'

test('gruvbox dark exposes the canonical dark palette mapping', () => {
  expect(gruvboxDark.id).toBe('gruvbox-dark')
  expect(gruvboxDark.kind).toBe('dark')
  expect(gruvboxDark.ui.surface).toBe('#1d2021')
  expect(gruvboxDark.ui['surface-container']).toBe('#5a514a')
  expect(gruvboxDark.ui['surface-container-highest']).toBe('#4d4743')
  expect(gruvboxDark.ui['surface-bright']).toBe('#4d4743')
  expect(gruvboxDark.ui.primary).toBe('#fe8019')
  expect(gruvboxDark.terminal.background).toBe('#282828')
  expect(gruvboxDark.effects['wash-subtle']).toBe('rgba(255, 255, 255, 0.05)')
})
