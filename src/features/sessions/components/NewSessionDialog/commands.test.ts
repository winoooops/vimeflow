import { describe, expect, test } from 'vitest'
import { COMMANDS, COMMAND_ORDER } from './commands'

describe('COMMANDS', () => {
  test('orders claude, codex, kimi, opencode, browser, shell', () => {
    expect(COMMAND_ORDER).toEqual(['claude', 'codex', 'kimi', 'opencode', 'browser', 'shell'])
  })
  test('browser is a browser-kind entry with its own accent', () => {
    expect(COMMANDS.browser.kind).toBe('browser')
    expect(COMMANDS.browser.accentVar).toBe('--color-agent-browser-accent')
  })
  test('agent entries reuse the registry label + glyph', () => {
    expect(COMMANDS.claude.label).toBe('Claude Code')
    expect(COMMANDS.claude.kind).toBe('shell')
    expect(COMMANDS.shell.kind).toBe('shell')
  })
})
