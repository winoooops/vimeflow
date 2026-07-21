import { describe, expect, test } from 'vitest'
import { CODEX_BUILT_IN_TOOLS, CODEX_TOOL_SOURCE } from './codexToolCallProfile'
import { classifyToolCall } from './toolCallProfiles'

describe('Codex tool-call profile', () => {
  test('pins the current official Codex registry source', () => {
    expect(CODEX_TOOL_SOURCE).toMatchObject({
      packageName: '@openai/codex',
      version: '0.144.6',
      tag: 'rust-v0.144.6',
      revision: '5d1fbf26c43abc65a203928b2e31561cb039e06d',
      checkedAt: '2026-07-21',
    })
    expect(CODEX_BUILT_IN_TOOLS).toHaveLength(55)
    expect(new Set(CODEX_BUILT_IN_TOOLS)).toHaveLength(55)
  })

  test('resolves every pinned built-in to a non-empty label', () => {
    for (const tool of CODEX_BUILT_IN_TOOLS) {
      expect(classifyToolCall('codex', tool).label.trim()).not.toBe('')
    }
  })

  test.each([
    ['exec', 'meta', 'CODE'],
    ['wait', 'wait', 'WAIT'],
    ['exec_command', 'bash', 'BASH'],
    ['write_stdin', 'bash', 'STDIN'],
    ['apply_patch', 'edit', 'PATCH'],
    ['view_image', 'read', 'IMAGE'],
    ['update_plan', 'plan', 'UPDATE PLAN'],
    ['create_goal', 'plan', 'CREATE GOAL'],
    ['tool_search', 'external', 'TOOL SEARCH'],
    ['web__run', 'web', 'WEB SEARCH'],
    ['request_user_input', 'interaction', 'ASK USER'],
    ['collaboration__spawn_agent', 'agent', 'SPAWN AGENT'],
    ['memories__read', 'read', 'MEMORY'],
    ['skills__read', 'external', 'SKILL'],
  ] as const)('maps %s to %s / %s', (tool, kind, label) => {
    expect(classifyToolCall('codex', tool)).toMatchObject({ kind, label })
  })

  test.each([
    ['mcp__github__get_issue', 'GITHUB · GET ISSUE'],
    ['mcp__codex_apps__linear__save_issue', 'LINEAR · SAVE ISSUE'],
    ['filesystem__read_file', 'FILESYSTEM · READ FILE'],
  ] as const)('formats dynamic Codex tool %s as %s', (tool, label) => {
    expect(classifyToolCall('codex', tool)).toMatchObject({
      kind: 'external',
      label,
    })
  })

  test('keeps non-prefixed Codex inference scoped to Codex', () => {
    expect(
      classifyToolCall('claude-code', 'filesystem__read_file')
    ).toMatchObject({
      kind: 'meta',
      label: 'FILESYSTEM__READ_FILE',
    })
  })

  test('keeps unknown upstream names open and readable', () => {
    expect(classifyToolCall('codex', 'future_tool_name')).toMatchObject({
      kind: 'meta',
      label: 'FUTURE TOOL NAME',
    })
  })
})
