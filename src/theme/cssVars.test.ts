import { expect, test } from 'vitest'
import { toCssVars } from './cssVars'
import { obsidianLens } from './themes/obsidian-lens'

test('emits ui tokens under --color-*', () => {
  const vars = toCssVars(obsidianLens)
  expect(vars['--color-surface']).toBe('#121221')
  expect(vars['--color-on-surface-muted']).toBe('#8a8299')
})

test('emits effect colors, syntax, and shadows under their namespaces', () => {
  const vars = toCssVars(obsidianLens)
  expect(vars['--color-wash-subtle']).toBe('rgba(255, 255, 255, 0.05)')
  expect(vars['--color-syn-keyword']).toBe('#cba6f7')
  expect(vars['--shadow-modal']).toBe('0 24px 80px rgb(0 0 0 / 0.5)')
})

test('flattens agent accents with kebab-cased fields', () => {
  const vars = toCssVars(obsidianLens)
  expect(vars['--color-agent-claude-accent']).toBe('#cba6f7')
  expect(vars['--color-agent-claude-accent-dim']).toBe(
    'rgb(203 166 247 / 0.16)'
  )
  expect(vars['--color-agent-browser-on-accent']).toBe('#06232a')
})

test('does not emit terminal colors as CSS vars', () => {
  const vars = toCssVars(obsidianLens)
  expect(Object.keys(vars).filter((k) => k.includes('terminal'))).toHaveLength(
    0
  )
})
