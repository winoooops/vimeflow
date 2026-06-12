import { expect, test } from 'vitest'
import * as theme from './index'

test('public surface exposes service, hook, types helpers', () => {
  expect(theme.themeService).toBeDefined()
  expect(theme.useTheme).toBeTypeOf('function')
  expect(theme.toCssVars).toBeTypeOf('function')
})
