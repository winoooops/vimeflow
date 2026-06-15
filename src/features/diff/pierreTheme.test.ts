import { expect, test } from 'vitest'
import { pierreThemeForKind } from './pierreTheme'

test('maps workspace theme kind to the nearest Pierre theme', () => {
  expect(pierreThemeForKind('dark')).toBe('pierre-dark')
  expect(pierreThemeForKind('light')).toBe('pierre-light')
})
