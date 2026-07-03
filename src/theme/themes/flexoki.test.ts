import { expect, test } from 'vitest'
import { flexoki } from './flexoki'

test('flexoki is the light proof theme on official palette values', () => {
  expect(flexoki.id).toBe('flexoki')
  expect(flexoki.kind).toBe('light')
  expect(flexoki.ui.surface).toBe('#f2f0e5')
  expect(flexoki.ui['on-surface']).toBe('#100f0f')
  expect(flexoki.terminal.background).toBe('#fffcf0')
  expect(flexoki.effects['wash-subtle']).toBe('rgba(16, 15, 15, 0.05)')
})
