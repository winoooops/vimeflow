// cspell:words Wakeup
import type {
  AgentToolCallOverrides,
  AgentToolCallProfile,
} from './toolCallProfiles'

/**
 * Exact built-in names from the official Claude Code tools reference.
 * The generated npm schemas provide the corresponding input/output shapes;
 * availability still varies by platform, provider, plan, and settings.
 */
export const CLAUDE_CODE_BUILT_IN_TOOLS = [
  'Agent',
  'Artifact',
  'AskUserQuestion',
  'Bash',
  'CronCreate',
  'CronDelete',
  'CronList',
  'Edit',
  'EnterPlanMode',
  'EnterWorktree',
  'ExitPlanMode',
  'ExitWorktree',
  'Glob',
  'Grep',
  'ListMcpResourcesTool',
  'LSP',
  'Monitor',
  'NotebookEdit',
  'PowerShell',
  'PushNotification',
  'Read',
  'ReadMcpResourceTool',
  'RemoteTrigger',
  'ReportFindings',
  'ScheduleWakeup',
  'SendMessage',
  'SendUserFile',
  'ShareOnboardingGuide',
  'Skill',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
  'TodoWrite',
  'ToolSearch',
  'WaitForMcpServers',
  'WebFetch',
  'WebSearch',
  'Workflow',
  'Write',
] as const

export type ClaudeCodeBuiltInTool = (typeof CLAUDE_CODE_BUILT_IN_TOOLS)[number]

export const CLAUDE_CODE_TOOL_SOURCE = {
  packageName: '@anthropic-ai/claude-code',
  version: '2.1.215',
  checkedAt: '2026-07-19',
  schemasPath: 'package/sdk-tools.d.ts',
  toolsReference: 'https://code.claude.com/docs/en/tools-reference.md',
} as const

const claudeCodeTools = {
  Agent: { kind: 'agent', label: 'AGENT' },
  Artifact: { kind: 'external', label: 'ARTIFACT' },
  AskUserQuestion: { kind: 'interaction', label: 'ASK USER' },
  CronCreate: { kind: 'plan', label: 'SCHEDULE' },
  CronDelete: { kind: 'plan', label: 'UNSCHEDULE' },
  CronList: { kind: 'plan', label: 'SCHEDULES' },
  EnterPlanMode: { kind: 'plan', label: 'ENTER PLAN' },
  EnterWorktree: { kind: 'meta', label: 'ENTER WORKTREE' },
  ExitPlanMode: { kind: 'plan', label: 'EXIT PLAN' },
  ExitWorktree: { kind: 'meta', label: 'EXIT WORKTREE' },
  ListMcpResourcesTool: { kind: 'external', label: 'MCP RESOURCES' },
  LSP: { kind: 'external', label: 'LSP' },
  Monitor: { kind: 'wait', label: 'MONITOR' },
  NotebookEdit: { kind: 'write', label: 'NOTEBOOK' },
  PowerShell: { kind: 'bash', label: 'POWERSHELL' },
  PushNotification: { kind: 'interaction', label: 'NOTIFY' },
  ReadMcpResourceTool: { kind: 'external', label: 'MCP RESOURCE' },
  RemoteTrigger: { kind: 'external', label: 'REMOTE TRIGGER' },
  ReportFindings: { kind: 'plan', label: 'FINDINGS' },
  ScheduleWakeup: { kind: 'wait', label: 'WAKEUP' },
  SendMessage: { kind: 'agent', label: 'MESSAGE' },
  SendUserFile: { kind: 'interaction', label: 'SEND FILE' },
  ShareOnboardingGuide: {
    kind: 'interaction',
    label: 'ONBOARDING GUIDE',
  },
  Skill: { kind: 'external', label: 'SKILL' },
  TaskCreate: { kind: 'plan', label: 'CREATE TASK' },
  TaskGet: { kind: 'plan', label: 'GET TASK' },
  TaskList: { kind: 'plan', label: 'TASKS' },
  TaskOutput: { kind: 'wait', label: 'TASK OUTPUT' },
  TaskStop: { kind: 'agent', label: 'STOP TASK' },
  TaskUpdate: { kind: 'plan', label: 'UPDATE TASK' },
  TodoWrite: { kind: 'plan', label: 'TODOS' },
  ToolSearch: { kind: 'external', label: 'TOOL SEARCH' },
  WaitForMcpServers: { kind: 'wait', label: 'WAIT FOR MCP' },
  WebFetch: { kind: 'web', label: 'WEB FETCH' },
  WebSearch: { kind: 'web', label: 'WEB SEARCH' },
  Workflow: { kind: 'agent', label: 'WORKFLOW' },
} satisfies AgentToolCallOverrides<ClaudeCodeBuiltInTool>

export const CLAUDE_CODE_TOOL_CALL_PROFILE: AgentToolCallProfile = {
  tools: claudeCodeTools,
  aliases: {
    MultiEdit: { kind: 'edit', label: 'EDIT' },
  },
}
