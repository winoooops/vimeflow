import { describe, expect, test } from 'vitest'
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

// Moved from src/features/workspace/WorkspaceView.visual.test.tsx (P2 policy)
describe('Color Tokens: Obsidian Lens theme', () => {
  test('surface hierarchy tokens', () => {
    expect(obsidianLens.ui.surface).toBe('#121221')
    expect(obsidianLens.ui['surface-container-lowest']).toBe('#0d0d1c')
    expect(obsidianLens.ui['surface-container-low']).toBe('#1a1a2a')
    expect(obsidianLens.ui['surface-container']).toBe('#1e1e2e')
    expect(obsidianLens.ui['surface-container-high']).toBe('#292839')
    expect(obsidianLens.ui['surface-container-highest']).toBe('#333344')
    expect(obsidianLens.ui['surface-bright']).toBe('#383849')
  })

  test('primary tokens', () => {
    expect(obsidianLens.ui.primary).toBe('#e2c7ff')
    expect(obsidianLens.ui['primary-container']).toBe('#cba6f7')
    expect(obsidianLens.ui['primary-dim']).toBe('#d3b9f0')
  })

  test('semantic feedback tokens', () => {
    expect(obsidianLens.ui.success).toBe('#50fa7b')
    expect(obsidianLens.ui['success-muted']).toBe('#7defa1')
    expect(obsidianLens.ui.tertiary).toBe('#ff94a5')
    expect(obsidianLens.ui['tertiary-container']).toBe('#fd7e94')
    expect(obsidianLens.ui.error).toBe('#ffb4ab')
    expect(obsidianLens.ui['error-dim']).toBe('#d73357')
  })

  test('text tokens', () => {
    expect(obsidianLens.ui['on-surface']).toBe('#e3e0f7')
    expect(obsidianLens.ui['on-surface-variant']).toBe('#cdc3d1')
    expect(obsidianLens.ui['outline-variant']).toBe('#4a444f')
  })
})

// Moved from src/features/terminal/types/index.test.ts (P2 policy)
describe('terminal palette', () => {
  test('foreground and background pin to Catppuccin Mocha', () => {
    expect(obsidianLens.terminal.foreground).toBe('#cdd6f4')
    expect(obsidianLens.terminal.background).toBe('#1e1e2e')
    expect(obsidianLens.terminal.cursor).toBe('#f5e0dc')
    expect(obsidianLens.terminal.cursorAccent).toBe('#1e1e2e')
    expect(obsidianLens.terminal.selectionBackground).toBe('#585b70')
    expect(obsidianLens.terminal.black).toBe('#45475a')
    expect(obsidianLens.terminal.red).toBe('#f38ba8')
    expect(obsidianLens.terminal.green).toBe('#a6e3a1')
    expect(obsidianLens.terminal.yellow).toBe('#f9e2af')
    expect(obsidianLens.terminal.blue).toBe('#89b4fa')
    expect(obsidianLens.terminal.magenta).toBe('#f5c2e7')
    expect(obsidianLens.terminal.cyan).toBe('#94e2d5')
    expect(obsidianLens.terminal.white).toBe('#bac2de')
    expect(obsidianLens.terminal.brightBlack).toBe('#585b70')
    expect(obsidianLens.terminal.brightRed).toBe('#f38ba8')
    expect(obsidianLens.terminal.brightGreen).toBe('#a6e3a1')
    expect(obsidianLens.terminal.brightYellow).toBe('#f9e2af')
    expect(obsidianLens.terminal.brightBlue).toBe('#89b4fa')
    expect(obsidianLens.terminal.brightMagenta).toBe('#f5c2e7')
    expect(obsidianLens.terminal.brightCyan).toBe('#94e2d5')
    expect(obsidianLens.terminal.brightWhite).toBe('#a6adc8')
  })
})
