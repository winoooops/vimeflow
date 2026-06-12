import { expect, test } from 'vitest'
import { obsidianLens } from '../../../theme'
import { toXtermTheme } from './toXtermTheme'

test('maps every TerminalTheme field into the xterm shape', () => {
  const xterm = toXtermTheme(obsidianLens.terminal)
  expect(xterm.background).toBe(obsidianLens.terminal.background)
  expect(xterm.brightWhite).toBe(obsidianLens.terminal.brightWhite)
  expect(Object.keys(xterm)).toHaveLength(21)
})
