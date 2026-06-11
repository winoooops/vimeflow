import { expect, test } from 'vitest'
import { obsidianLens } from '../../../theme'
import { toXtermTheme } from './toXtermTheme'

test('maps every TerminalTheme field into the xterm shape', () => {
  const xterm = toXtermTheme(obsidianLens.terminal)
  expect(xterm.background).toBe('#1e1e2e')
  expect(xterm.brightWhite).toBe('#a6adc8')
  expect(Object.keys(xterm)).toHaveLength(21)
})
