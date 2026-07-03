import { expect, test } from 'vitest'
import { gruvboxLight } from './gruvbox-light'

test('gruvbox light exposes the canonical light palette mapping', () => {
  expect(gruvboxLight.id).toBe('gruvbox-light')
  expect(gruvboxLight.kind).toBe('light')
  expect(gruvboxLight.ui.surface).toBe('#f9f5d7')
  expect(gruvboxLight.ui['surface-container-highest']).toBe('#928374')
  expect(gruvboxLight.ui['surface-bright']).toBe('#928374')
  expect(gruvboxLight.ui.primary).toBe('#af3a03')
  expect(gruvboxLight.terminal.background).toBe('#fbf1c7')
  expect(gruvboxLight.terminal.brightRed).toBe('#9d0006')
  expect(gruvboxLight.effects['wash-subtle']).toBe('rgba(16, 15, 15, 0.05)')
})
