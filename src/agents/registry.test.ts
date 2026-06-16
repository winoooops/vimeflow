import { test, expect } from 'vitest'
import type { AgentStatus } from '../features/agent-status/types'
import {
  AGENTS,
  agentStatusToSessionStatus,
  agentTypeToRegistryKey,
  type AgentId,
} from './registry'

const ALL_AGENTS: readonly AgentId[] = ['claude', 'codex', 'kimi', 'shell']

test('AGENTS keys are claude, codex, kimi, shell', () => {
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
    expect(a.accent).toMatch(/^var\(--color-agent-/)
    expect(a.accentDim).toMatch(/^var\(--color-agent-/)
    expect(a.accentSoft).toMatch(/^var\(--color-agent-/)
    expect(a.onAccent).toMatch(/^var\(--color-agent-/)
    expect(a.model === null || typeof a.model === 'string').toBe(true)
  }
})

test('claude is lavender', () => {
  expect(AGENTS.claude.accent).toBe('var(--color-agent-claude-accent)')
  expect(AGENTS.claude.short).toBe('CLAUDE')
  expect(AGENTS.claude.glyph).toBe('∴')
  expect(AGENTS.claude.model).toBe('sonnet-4')
})

test('codex is mint', () => {
  expect(AGENTS.codex.accent).toBe('var(--color-agent-codex-accent)')
  expect(AGENTS.codex.short).toBe('CODEX')
  expect(AGENTS.codex.glyph).toBe('◇')
  expect(AGENTS.codex.model).toBe('gpt-5-codex')
})

test('shell is yellow with null model and title-cased name', () => {
  expect(AGENTS.shell.accent).toBe('var(--color-agent-shell-accent)')
  expect(AGENTS.shell.short).toBe('SHELL')
  expect(AGENTS.shell.glyph).toBe('$')
  expect(AGENTS.shell.model).toBeNull()
  expect(AGENTS.shell.name).toBe('Shell')
})

test('agentTypeToRegistryKey maps claude-code to claude', () => {
  expect(agentTypeToRegistryKey('claude-code')).toBe('claude')
})

test('agentTypeToRegistryKey maps codex to codex', () => {
  expect(agentTypeToRegistryKey('codex')).toBe('codex')
})

test('kimi is peach with model k2.7', () => {
  expect(AGENTS.kimi.accent).toBe('var(--color-agent-kimi-accent)')
  expect(AGENTS.kimi.short).toBe('KIMI')
  expect(AGENTS.kimi.glyph).toBe('☾')
  expect(AGENTS.kimi.model).toBe('k2.7')
})

test('agentTypeToRegistryKey maps kimi to kimi', () => {
  expect(agentTypeToRegistryKey('kimi')).toBe('kimi')
})

test.each(['aider', 'generic', null] as const)(
  'agentTypeToRegistryKey maps %s to shell',
  (agentType) => {
    expect(agentTypeToRegistryKey(agentType)).toBe('shell')
  }
)

test('agentTypeToRegistryKey falls back to shell for unknown values', () => {
  expect(
    agentTypeToRegistryKey('mystery-cli' as unknown as AgentStatus['agentType'])
  ).toBe('shell')
})

test('agentStatusToSessionStatus reports running when isActive', () => {
  expect(agentStatusToSessionStatus({ isActive: true } as AgentStatus)).toBe(
    'running'
  )
})

test('agentStatusToSessionStatus reports idle when not isActive', () => {
  expect(agentStatusToSessionStatus({ isActive: false } as AgentStatus)).toBe(
    'idle'
  )
})

test('supported agents carry a brand Icon; others fall back to their glyph', () => {
  expect(AGENTS.claude.Icon).toBeDefined()
  expect(AGENTS.codex.Icon).toBeDefined()
  expect(AGENTS.kimi.Icon).toBeDefined()
  expect(AGENTS.shell.Icon).toBeUndefined()
})
