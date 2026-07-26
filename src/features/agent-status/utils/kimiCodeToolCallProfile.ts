import type {
  AgentToolCallOverrides,
  AgentToolCallProfile,
} from './toolCallProfiles'

/**
 * Default-agent built-ins from Kimi Code CLI 0.29.0's embedded agent spec.
 * The official reference documents the public tools; the embedded spec also
 * includes the Goal tools currently exposed to the default agent.
 */
export const KIMI_CODE_BUILT_IN_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Grep',
  'Glob',
  'Bash',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'CronCreate',
  'CronList',
  'CronDelete',
  'ReadMediaFile',
  'TodoList',
  'Skill',
  'WebSearch',
  'Agent',
  'AgentSwarm',
  'FetchURL',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'CreateGoal',
  'GetGoal',
  'SetGoalBudget',
  'UpdateGoal',
] as const

export type KimiCodeBuiltInTool = (typeof KIMI_CODE_BUILT_IN_TOOLS)[number]

export const KIMI_CODE_TOOL_SOURCE = {
  productName: 'Kimi Code CLI',
  version: '0.29.0',
  checkedAt: '2026-07-22',
  defaultAgentSpec: 'embedded agent_default tools',
  toolsReference:
    'https://www.kimi.com/code/docs/kimi-code-cli/reference/tools.html',
} as const

const kimiCodeTools = {
  TaskList: { kind: 'plan', label: 'TASKS' },
  TaskOutput: { kind: 'wait', label: 'TASK OUTPUT' },
  TaskStop: { kind: 'agent', label: 'STOP TASK' },
  CronCreate: { kind: 'plan', label: 'SCHEDULE' },
  CronList: { kind: 'plan', label: 'SCHEDULES' },
  CronDelete: { kind: 'plan', label: 'UNSCHEDULE' },
  ReadMediaFile: { kind: 'read', label: 'MEDIA' },
  TodoList: { kind: 'plan', label: 'TODOS' },
  Skill: { kind: 'external', label: 'SKILL' },
  WebSearch: { kind: 'web', label: 'WEB SEARCH' },
  Agent: { kind: 'agent', label: 'AGENT' },
  AgentSwarm: { kind: 'agent', label: 'AGENT SWARM' },
  FetchURL: { kind: 'web', label: 'FETCH URL' },
  AskUserQuestion: { kind: 'interaction', label: 'ASK USER' },
  EnterPlanMode: { kind: 'plan', label: 'ENTER PLAN' },
  ExitPlanMode: { kind: 'plan', label: 'EXIT PLAN' },
  CreateGoal: { kind: 'plan', label: 'CREATE GOAL' },
  GetGoal: { kind: 'plan', label: 'GET GOAL' },
  SetGoalBudget: { kind: 'plan', label: 'SET GOAL BUDGET' },
  UpdateGoal: { kind: 'plan', label: 'UPDATE GOAL' },
} satisfies AgentToolCallOverrides<KimiCodeBuiltInTool>

export const KIMI_CODE_TOOL_CALL_PROFILE: AgentToolCallProfile = {
  tools: kimiCodeTools,
}
