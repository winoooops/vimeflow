import { describe, expect, test } from 'vitest'
import type { AgentAlias } from '@/bindings'
import {
  agentLauncherFromCommand,
  buildAgentResumeCommand,
  buildAgentStartCommand,
  type AgentAliasConfig,
} from './agentResumeCommand'

const alias = (name: string, agent: string, extra = ''): AgentAlias => ({
  id: `alias-${name}`,
  alias: name,
  agent,
  extra,
  account: null,
})

const enabledAliases = (
  ...aliases: readonly AgentAlias[]
): AgentAliasConfig => ({
  enabled: true,
  aliases,
})

describe('buildAgentResumeCommand', () => {
  test.each([
    ['claude-code', "claude --resume 'conversation-1'"],
    ['codex', "codex resume 'conversation-1'"],
    ['kimi', "kimi --session 'conversation-1'"],
    ['opencode', "opencode --session 'conversation-1'"],
  ] as const)('builds the canonical %s command', (agentType, expected) => {
    expect(buildAgentResumeCommand(agentType, 'conversation-1')).toBe(expected)
  })

  test.each([
    ['claude-code', 'claude --continue'],
    ['codex', 'codex resume --last'],
    ['kimi', 'kimi --continue'],
    ['opencode', 'opencode --continue'],
  ] as const)(
    'builds the latest-conversation %s command when identity is missing',
    (agentType, expected) => {
      expect(buildAgentResumeCommand(agentType, null)).toBe(expected)
      expect(buildAgentResumeCommand(agentType, undefined)).toBe(expected)
    }
  )

  test.each([
    ['generic', 'conversation-1'],
    ['aider', 'conversation-1'],
    ['claude-code', ''],
    ['codex', "valid'; touch /tmp/injected; echo '"],
    ['kimi', 'contains whitespace'],
  ] as const)('rejects unsupported or unsafe input', (agentType, sessionId) => {
    expect(buildAgentResumeCommand(agentType, sessionId)).toBeNull()
  })

  test('uses the first safe configured alias for exact and latest resume', () => {
    const aliases = enabledAliases(alias('CC', 'claude'), alias('CDX', 'codex'))

    expect(
      buildAgentResumeCommand('claude-code', 'conversation-1', {
        aliasConfig: aliases,
        launcher: 'CC',
      })
    ).toBe("CC --resume 'conversation-1'")

    expect(
      buildAgentResumeCommand('codex', null, { aliasConfig: aliases })
    ).toBe('CDX resume --last')
  })

  test.each([
    [{ enabled: false, aliases: [alias('CDX', 'codex')] }, 'codex'],
    [enabledAliases(alias('CC', 'claude')), 'codex'],
    [enabledAliases(alias('cdx; touch /tmp/pwned', 'codex')), 'codex'],
  ] as const)(
    'falls back to the canonical launcher for disabled, missing, or unsafe aliases',
    (aliases, expectedLauncher) => {
      expect(
        buildAgentResumeCommand('codex', null, { aliasConfig: aliases })
      ).toBe(`${expectedLauncher} resume --last`)
    }
  )

  test('builds start commands from configured aliases with canonical fallback', () => {
    const aliases = enabledAliases(alias('CC', 'claude'), alias('CDX', 'codex'))

    expect(
      buildAgentStartCommand('claude', {
        aliasConfig: aliases,
        launcher: 'CC',
      })
    ).toBe('CC')
    expect(buildAgentStartCommand('codex', { launcher: 'codex' })).toBe('codex')
    expect(buildAgentStartCommand('kimi', { aliasConfig: aliases })).toBe(
      'kimi'
    )

    expect(
      buildAgentStartCommand('browser', { aliasConfig: aliases })
    ).toBeNull()
    expect(buildAgentStartCommand('shell', { aliasConfig: aliases })).toBeNull()
  })

  test('does not guess between multiple aliases for a legacy pane', () => {
    const aliases = enabledAliases(
      alias('CC', 'claude'),
      alias('CC_WORK', 'claude')
    )

    expect(
      buildAgentResumeCommand('claude-code', null, { aliasConfig: aliases })
    ).toBe('claude --continue')
  })

  test('falls back when a saved launcher no longer belongs to the agent', () => {
    const aliases = enabledAliases(alias('CC', 'claude'))

    expect(
      buildAgentResumeCommand('codex', 'conversation-1', {
        aliasConfig: aliases,
        launcher: 'CC',
      })
    ).toBe("codex resume 'conversation-1'")
  })

  test('recognizes submitted canonical and configured alias launchers', () => {
    const aliases = enabledAliases(alias('CC', 'claude'))

    expect(agentLauncherFromCommand('  CC --verbose', aliases)).toBe('CC')
    expect(agentLauncherFromCommand('codex --search', aliases)).toBe('codex')
    expect(agentLauncherFromCommand('printf CC', aliases)).toBeNull()
    expect(
      agentLauncherFromCommand('CC', { ...aliases, enabled: false })
    ).toBeNull()
  })
})
