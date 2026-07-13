import { expect, test } from 'vitest'
import { deriveTheme, themeToScheme } from './derive'
import { flexoki } from './themes/flexoki'
import { obsidianLens } from './themes/obsidian-lens'
import {
  AGENT_IDS,
  EFFECT_COLOR_TOKENS,
  SHADOW_TOKENS,
  SYN_TOKENS,
  UI_TOKENS,
} from './types'

test('derives every runtime token group from the base palette', () => {
  const scheme = themeToScheme(obsidianLens)
  const theme = deriveTheme(scheme)

  expect(Object.keys(theme.ui)).toEqual([...UI_TOKENS])
  expect(Object.keys(theme.effects)).toEqual([...EFFECT_COLOR_TOKENS])
  expect(Object.keys(theme.shadows)).toEqual([...SHADOW_TOKENS])
  expect(Object.keys(theme.syntax)).toEqual([...SYN_TOKENS])
  expect(Object.keys(theme.agents)).toEqual([...AGENT_IDS])
  expect(theme.terminal.background).not.toBe(scheme.palette.background)
  expect(theme.terminal.background).not.toBe(theme.ui.surface)
})

test('keeps the base colors bound to their runtime roles', () => {
  const scheme = themeToScheme(obsidianLens)
  const theme = deriveTheme(scheme)

  expect(theme.ui.surface).toBe(scheme.palette.surface)
  expect(theme.ui.primary).toBe(scheme.palette.primary)
  expect(theme.ui['on-surface']).toBe(scheme.palette.foreground)
  expect(theme.syntax.string).toBe(scheme.palette.green)
  expect(theme.terminal.blue).toBe(scheme.palette.blue)
  expect(theme.agents.browser.accent).toBe(scheme.palette.cyan)
})

test('keeps ANSI black dark and ANSI white light for light schemes', () => {
  const scheme = themeToScheme(flexoki)
  const theme = deriveTheme(scheme)

  expect(theme.terminal.black).toBe(scheme.palette.foreground)
  expect(theme.terminal.white).toBe(scheme.palette.surface)
})
