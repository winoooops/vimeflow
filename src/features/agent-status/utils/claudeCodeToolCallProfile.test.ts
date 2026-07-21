import { describe, expect, test } from 'vitest'
import {
  CLAUDE_CODE_BUILT_IN_TOOLS,
  CLAUDE_CODE_TOOL_SOURCE,
} from './claudeCodeToolCallProfile'
import { classifyToolCall } from './toolCallProfiles'

describe('Claude Code tool-call profile', () => {
  test('pins the current official Claude Code contract source', () => {
    expect(CLAUDE_CODE_TOOL_SOURCE).toMatchObject({
      packageName: '@anthropic-ai/claude-code',
      version: '2.1.215',
      checkedAt: '2026-07-19',
    })
    expect(CLAUDE_CODE_BUILT_IN_TOOLS).toHaveLength(42)
    expect(new Set(CLAUDE_CODE_BUILT_IN_TOOLS)).toHaveLength(42)
  })

  test('resolves every documented built-in to a non-empty label', () => {
    for (const tool of CLAUDE_CODE_BUILT_IN_TOOLS) {
      const presentation = classifyToolCall('claude-code', tool)

      expect(presentation.label.trim()).not.toBe('')
    }
  })

  test.each([
    ['Edit', 'edit', 'EDIT'],
    ['NotebookEdit', 'write', 'NOTEBOOK'],
    ['PowerShell', 'bash', 'POWERSHELL'],
    ['EnterPlanMode', 'plan', 'ENTER PLAN'],
    ['TaskOutput', 'wait', 'TASK OUTPUT'],
    ['Agent', 'agent', 'AGENT'],
    ['WebSearch', 'web', 'WEB SEARCH'],
    ['AskUserQuestion', 'interaction', 'ASK USER'],
    ['ReadMcpResourceTool', 'external', 'MCP RESOURCE'],
  ] as const)('maps %s to %s / %s', (tool, kind, label) => {
    expect(classifyToolCall('claude-code', tool)).toMatchObject({ kind, label })
  })

  test('keeps legacy aliases scoped to Claude Code', () => {
    expect(classifyToolCall('claude-code', 'MultiEdit')).toMatchObject({
      kind: 'edit',
      label: 'EDIT',
    })

    expect(classifyToolCall('codex', 'MultiEdit')).toMatchObject({
      kind: 'meta',
      label: 'MULTIEDIT',
    })
  })
})
