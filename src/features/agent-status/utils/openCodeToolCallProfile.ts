// cspell:ignore todowrite
import type {
  AgentToolCallOverrides,
  AgentToolCallProfile,
  ToolCallPresentation,
} from './toolCallProfiles'

/**
 * Built-ins registered by OpenCode 1.18.4. Availability varies by client,
 * model, provider, feature flags, and configuration.
 */
export const OPEN_CODE_BUILT_IN_TOOLS = [
  'invalid',
  'question',
  'bash',
  'read',
  'glob',
  'grep',
  'edit',
  'write',
  'task',
  'webfetch',
  'todowrite',
  'websearch',
  'skill',
  'apply_patch',
  'execute',
  'lsp',
  'plan_exit',
] as const

export type OpenCodeBuiltInTool = (typeof OPEN_CODE_BUILT_IN_TOOLS)[number]

export const OPEN_CODE_TOOL_SOURCE = {
  packageName: 'opencode',
  version: '1.18.4',
  tag: 'v1.18.4',
  revision: '49c69c5ed3ccf706b61b3febb43c8aaff7f8325e',
  checkedAt: '2026-07-22',
  registryPath: 'packages/opencode/src/tool/registry.ts',
  mcpPath: 'packages/opencode/src/mcp/catalog.ts',
  toolsReference: 'https://opencode.ai/docs/tools/',
} as const

const openCodeTools = {
  invalid: { kind: 'meta', label: 'INVALID TOOL' },
  question: { kind: 'interaction', label: 'ASK USER' },
  bash: { kind: 'bash', label: 'BASH' },
  read: { kind: 'read', label: 'READ' },
  glob: { kind: 'glob', label: 'GLOB' },
  grep: { kind: 'grep', label: 'GREP' },
  edit: { kind: 'edit', label: 'EDIT' },
  write: { kind: 'write', label: 'WRITE' },
  task: { kind: 'agent', label: 'AGENT' },
  webfetch: { kind: 'web', label: 'WEB FETCH' },
  todowrite: { kind: 'plan', label: 'TODOS' },
  websearch: { kind: 'web', label: 'WEB SEARCH' },
  skill: { kind: 'external', label: 'SKILL' },
  apply_patch: { kind: 'edit', label: 'PATCH' },
  execute: { kind: 'meta', label: 'CODE' },
  lsp: { kind: 'external', label: 'LSP' },
  plan_exit: { kind: 'plan', label: 'EXIT PLAN' },
} satisfies AgentToolCallOverrides<OpenCodeBuiltInTool>

const formatSegment = (segment: string): string =>
  segment.replace(/[_-]+/g, ' ').trim().toUpperCase()

const inferOpenCodeTool = (tool: string): ToolCallPresentation | undefined => {
  const separator = tool.indexOf('_')

  if (separator <= 0 || separator === tool.length - 1) {
    return undefined
  }

  return {
    kind: 'external',
    label: `${formatSegment(tool.slice(0, separator))} · ${formatSegment(
      tool.slice(separator + 1)
    )}`,
  }
}

export const OPEN_CODE_TOOL_CALL_PROFILE: AgentToolCallProfile = {
  tools: openCodeTools,
  infer: inferOpenCodeTool,
}
