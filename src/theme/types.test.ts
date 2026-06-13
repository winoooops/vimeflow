import { expect, test } from 'vitest'
import {
  AGENT_ACCENT_FIELDS,
  AGENT_IDS,
  EFFECT_COLOR_TOKENS,
  SHADOW_TOKENS,
  SYN_TOKENS,
  UI_TOKENS,
} from './types'

test('ui token list has no duplicates', () => {
  expect(new Set(UI_TOKENS).size).toBe(UI_TOKENS.length)
})

test('vcs and editor tokens are part of the ui set', () => {
  expect(UI_TOKENS).toContain('vcs-modified')
  expect(UI_TOKENS).toContain('editor-fg')
})

test('effect colors include washes, scrollbar, and diff tokens', () => {
  expect(EFFECT_COLOR_TOKENS).toContain('wash-subtle')
  expect(EFFECT_COLOR_TOKENS).toContain('scrollbar-thumb')
  expect(EFFECT_COLOR_TOKENS).toContain('diff-highlight-removed')
})

test('shadow tokens cover the composite shadows', () => {
  expect(SHADOW_TOKENS).toEqual([
    'pane-focus',
    'modal',
    'pip-glow',
    'ambient',
    'glow-primary',
    'ring-primary',
  ])
})

test('agents cover the six identities with four fields', () => {
  expect(AGENT_IDS).toEqual([
    'claude',
    'codex',
    'gemini',
    'shell',
    'browser',
    'kimi',
  ])

  expect(AGENT_ACCENT_FIELDS).toEqual([
    'accent',
    'accentDim',
    'accentSoft',
    'onAccent',
  ])
})

test('syntax tokens cover the markdown and editor needs', () => {
  expect(SYN_TOKENS).toContain('keyword')
  expect(SYN_TOKENS).toContain('class')
  expect(SYN_TOKENS).toContain('operator')
})
