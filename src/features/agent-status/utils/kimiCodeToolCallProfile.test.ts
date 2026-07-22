import { describe, expect, test } from 'vitest'
import {
  KIMI_CODE_BUILT_IN_TOOLS,
  KIMI_CODE_TOOL_SOURCE,
} from './kimiCodeToolCallProfile'
import { classifyToolCall } from './toolCallProfiles'

describe('Kimi Code tool-call profile', () => {
  test('pins the installed Kimi Code default-agent tool source', () => {
    expect(KIMI_CODE_TOOL_SOURCE).toMatchObject({
      productName: 'Kimi Code CLI',
      version: '0.29.0',
      checkedAt: '2026-07-22',
    })
    expect(KIMI_CODE_BUILT_IN_TOOLS).toHaveLength(26)
    expect(new Set(KIMI_CODE_BUILT_IN_TOOLS)).toHaveLength(26)
  })

  test('resolves every pinned built-in to a non-empty label', () => {
    for (const tool of KIMI_CODE_BUILT_IN_TOOLS) {
      expect(classifyToolCall('kimi', tool).label.trim()).not.toBe('')
    }
  })

  test.each([
    ['ReadMediaFile', 'read', 'MEDIA'],
    ['TaskList', 'plan', 'TASKS'],
    ['TaskOutput', 'wait', 'TASK OUTPUT'],
    ['TaskStop', 'agent', 'STOP TASK'],
    ['CronCreate', 'plan', 'SCHEDULE'],
    ['TodoList', 'plan', 'TODOS'],
    ['WebSearch', 'web', 'WEB SEARCH'],
    ['FetchURL', 'web', 'FETCH URL'],
    ['Agent', 'agent', 'AGENT'],
    ['AgentSwarm', 'agent', 'AGENT SWARM'],
    ['AskUserQuestion', 'interaction', 'ASK USER'],
    ['Skill', 'external', 'SKILL'],
    ['EnterPlanMode', 'plan', 'ENTER PLAN'],
    ['CreateGoal', 'plan', 'CREATE GOAL'],
    ['SetGoalBudget', 'plan', 'SET GOAL BUDGET'],
    ['UpdateGoal', 'plan', 'UPDATE GOAL'],
  ] as const)('maps %s to %s / %s', (tool, kind, label) => {
    expect(classifyToolCall('kimi', tool)).toMatchObject({ kind, label })
  })

  test('formats Kimi MCP tools through the shared external-tool fallback', () => {
    expect(classifyToolCall('kimi', 'mcp__github__get_issue')).toMatchObject({
      kind: 'external',
      label: 'GITHUB · GET ISSUE',
    })
  })
})
