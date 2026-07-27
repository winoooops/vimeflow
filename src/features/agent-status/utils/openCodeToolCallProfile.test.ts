// cspell:ignore todowrite
import { describe, expect, test } from 'vitest'
import {
  OPEN_CODE_BUILT_IN_TOOLS,
  OPEN_CODE_TOOL_SOURCE,
} from './openCodeToolCallProfile'
import { classifyToolCall } from './toolCallProfiles'

describe('OpenCode tool-call profile', () => {
  test('pins the upstream OpenCode tool registry', () => {
    expect(OPEN_CODE_TOOL_SOURCE).toMatchObject({
      packageName: 'opencode',
      version: '1.18.4',
      tag: 'v1.18.4',
      revision: '49c69c5ed3ccf706b61b3febb43c8aaff7f8325e',
      checkedAt: '2026-07-22',
    })
    expect(OPEN_CODE_BUILT_IN_TOOLS).toHaveLength(17)
    expect(new Set(OPEN_CODE_BUILT_IN_TOOLS)).toHaveLength(17)
  })

  test('resolves every pinned built-in to a non-empty label', () => {
    for (const tool of OPEN_CODE_BUILT_IN_TOOLS) {
      expect(classifyToolCall('opencode', tool).label.trim()).not.toBe('')
    }
  })

  test.each([
    ['bash', 'bash', 'BASH'],
    ['read', 'read', 'READ'],
    ['glob', 'glob', 'GLOB'],
    ['grep', 'grep', 'GREP'],
    ['edit', 'edit', 'EDIT'],
    ['write', 'write', 'WRITE'],
    ['apply_patch', 'edit', 'PATCH'],
    ['task', 'agent', 'AGENT'],
    ['todowrite', 'plan', 'TODOS'],
    ['webfetch', 'web', 'WEB FETCH'],
    ['websearch', 'web', 'WEB SEARCH'],
    ['question', 'interaction', 'ASK USER'],
    ['skill', 'external', 'SKILL'],
    ['lsp', 'external', 'LSP'],
    ['plan_exit', 'plan', 'EXIT PLAN'],
    ['execute', 'meta', 'CODE'],
    ['invalid', 'meta', 'INVALID TOOL'],
  ] as const)('maps %s to %s / %s', (tool, kind, label) => {
    expect(classifyToolCall('opencode', tool)).toMatchObject({ kind, label })
  })

  test('formats OpenCode MCP and namespaced custom tools', () => {
    expect(classifyToolCall('opencode', 'github_get_issue')).toMatchObject({
      kind: 'external',
      label: 'GITHUB · GET ISSUE',
    })
  })

  test('keeps OpenCode external-name inference scoped to OpenCode', () => {
    expect(classifyToolCall('claude-code', 'github_get_issue')).toMatchObject({
      kind: 'meta',
      label: 'GITHUB_GET_ISSUE',
    })
  })
})
