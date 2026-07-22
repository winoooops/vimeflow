import type { AgentStatus } from '../types'
import type { ToolActivityEventKind } from '../types/activityEvent'
import { CLAUDE_CODE_TOOL_CALL_PROFILE } from './claudeCodeToolCallProfile'
import { CODEX_TOOL_CALL_PROFILE } from './codexToolCallProfile'
import { KIMI_CODE_TOOL_CALL_PROFILE } from './kimiCodeToolCallProfile'

export interface ToolCallPresentation {
  readonly kind: ToolActivityEventKind
  readonly label: string
}

export interface AgentToolCallProfile {
  readonly tools: Readonly<Partial<Record<string, ToolCallPresentation>>>
  readonly aliases?: Readonly<Partial<Record<string, ToolCallPresentation>>>
  readonly infer?: (tool: string) => ToolCallPresentation | undefined
}

const baseTools = {
  Bash: { kind: 'bash', label: 'BASH' },
  Edit: { kind: 'edit', label: 'EDIT' },
  Glob: { kind: 'glob', label: 'GLOB' },
  Grep: { kind: 'grep', label: 'GREP' },
  Read: { kind: 'read', label: 'READ' },
  Write: { kind: 'write', label: 'WRITE' },
} satisfies Readonly<Record<string, ToolCallPresentation>>

type BaseToolCallName = keyof typeof baseTools

export type AgentToolCallOverrides<UpstreamTool extends string> = Readonly<
  Record<Exclude<UpstreamTool, BaseToolCallName>, ToolCallPresentation>
>

const BASE_TOOL_CALL_PROFILE: AgentToolCallProfile = {
  tools: baseTools,
}

type ProfileAgentType = Exclude<AgentStatus['agentType'], null>

const AGENT_TOOL_CALL_PROFILES: Partial<
  Record<ProfileAgentType, AgentToolCallProfile>
> = {
  'claude-code': CLAUDE_CODE_TOOL_CALL_PROFILE,
  codex: CODEX_TOOL_CALL_PROFILE,
  kimi: KIMI_CODE_TOOL_CALL_PROFILE,
}

const formatToolSegment = (segment: string): string =>
  segment.replace(/[_-]+/g, ' ').trim().toUpperCase()

const inferExternalTool = (tool: string): ToolCallPresentation | undefined => {
  const [prefix, provider, ...action] = tool.split('__')

  if (prefix !== 'mcp' || !provider || action.length === 0) {
    return undefined
  }

  return {
    kind: 'external',
    label: `${formatToolSegment(provider)} · ${formatToolSegment(
      action.join(' ')
    )}`,
  }
}

const getOwnPresentation = (
  tools: AgentToolCallProfile['tools'] | undefined,
  tool: string
): ToolCallPresentation | undefined =>
  tools !== undefined && Object.prototype.hasOwnProperty.call(tools, tool)
    ? tools[tool]
    : undefined

export const classifyToolCall = (
  agentType: AgentStatus['agentType'],
  tool: string
): ToolCallPresentation => {
  const profile =
    agentType === null ? undefined : AGENT_TOOL_CALL_PROFILES[agentType]

  return (
    getOwnPresentation(profile?.tools, tool) ??
    getOwnPresentation(profile?.aliases, tool) ??
    getOwnPresentation(BASE_TOOL_CALL_PROFILE.tools, tool) ??
    profile?.infer?.(tool) ??
    inferExternalTool(tool) ?? {
      kind: 'meta',
      label: tool.toUpperCase(),
    }
  )
}
