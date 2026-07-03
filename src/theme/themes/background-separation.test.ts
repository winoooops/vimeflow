import { expect, test } from 'vitest'
import { dracula } from './dracula'
import { flexoki } from './flexoki'
import { gruvboxDark } from './gruvbox/gruvbox-dark'
import { gruvboxLight } from './gruvbox/gruvbox-light'
import { obsidianLens } from './obsidian-lens'
import { tokyoNightTheme } from './tokyo-night'

const themes = [
  obsidianLens,
  flexoki,
  gruvboxDark,
  gruvboxLight,
  tokyoNightTheme,
  dracula,
] as const

test('app surface backgrounds stay distinct from terminal canvas backgrounds', () => {
  for (const theme of themes) {
    expect(theme.ui.surface).not.toBe(theme.terminal.background)

    expect(theme.ui['surface-container-lowest']).not.toBe(
      theme.terminal.background
    )

    expect(theme.ui['surface-container']).not.toBe(theme.terminal.background)
  }
})
