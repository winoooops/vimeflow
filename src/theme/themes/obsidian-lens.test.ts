import { expect, test } from 'vitest'
import { obsidianLens } from './obsidian-lens'

test('obsidian lens is the dark default with current rendered values', () => {
  expect(obsidianLens.id).toBe('obsidian-lens')
  expect(obsidianLens.kind).toBe('dark')
  expect(obsidianLens.ui.surface).toBe('#121221')
  expect(obsidianLens.ui.primary).toBe('#e2c7ff')
  expect(obsidianLens.ui['secondary-container']).toBe('#124988') // rendered truth, not tokens.css #57377f
  expect(obsidianLens.effects['scrollbar-thumb']).toBe('#333344')
  expect(obsidianLens.terminal.background).toBe('#1e1e2e')
  expect(obsidianLens.agents.claude.accent).toBe('#cba6f7')
  expect(obsidianLens.agents.browser.accent).toBe('#4fc8d6')
})
