import { test, expect } from 'vitest'
import { AGENTS, type AgentId } from './registry'

const ALL_AGENTS: readonly AgentId[] = ['claude', 'codex', 'gemini', 'shell']

test('AGENTS keys are claude, codex, gemini, shell', () => {
  expect(Object.keys(AGENTS).sort()).toEqual([...ALL_AGENTS].sort())
})

test('every agent has the required fields with correct shapes', () => {
  for (const id of ALL_AGENTS) {
    const a = AGENTS[id]
    expect(a.id).toBe(id)
    expect(typeof a.name).toBe('string')
    expect(a.name[0]).toBe(a.name[0]?.toUpperCase())
    expect(a.short).toMatch(/^[A-Z]+$/)
    expect(a.glyph).toHaveLength(1)
    expect(a.accent).toMatch(/^#[0-9a-f]{6}$/i)
    expect(a.accentDim).toMatch(/^rgb\(/)
    expect(a.accentSoft).toMatch(/^rgb\(/)
    expect(a.onAccent).toMatch(/^#[0-9a-f]{6}$/i)
  }
})

test('claude is lavender', () => {
  expect(AGENTS.claude.accent).toBe('#cba6f7')
  expect(AGENTS.claude.short).toBe('CLAUDE')
  expect(AGENTS.claude.glyph).toBe('∴')
  expect(AGENTS.claude.model).toBe('sonnet-4')
})

test('codex is mint', () => {
  expect(AGENTS.codex.accent).toBe('#7defa1')
  expect(AGENTS.codex.short).toBe('CODEX')
  expect(AGENTS.codex.glyph).toBe('◇')
  expect(AGENTS.codex.model).toBe('gpt-5-codex')
})

test('gemini is azure', () => {
  expect(AGENTS.gemini.accent).toBe('#a8c8ff')
  expect(AGENTS.gemini.short).toBe('GEMINI')
  expect(AGENTS.gemini.glyph).toBe('✦')
  expect(AGENTS.gemini.model).toBe('gemini-2.5')
})

test('shell is yellow with null model and title-cased name', () => {
  expect(AGENTS.shell.accent).toBe('#f0c674')
  expect(AGENTS.shell.short).toBe('SHELL')
  expect(AGENTS.shell.glyph).toBe('$')
  expect(AGENTS.shell.model).toBeNull()
  expect(AGENTS.shell.name).toBe('Shell')
})
