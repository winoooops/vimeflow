import type {
  AgentToolCallOverrides,
  AgentToolCallProfile,
  ToolCallPresentation,
} from './toolCallProfiles'

// cspell:ignore imagegen

/**
 * Production-visible core and bundled-extension names from Codex 0.144.6.
 * Availability varies by model, feature flags, tool mode, and configuration.
 * Namespaced entries use the `namespace__name` form emitted by Vimeflow.
 */
export const CODEX_BUILT_IN_TOOLS = [
  'exec',
  'wait',
  'exec_command',
  'write_stdin',
  'shell_command',
  'request_permissions',
  'list_mcp_resources',
  'list_mcp_resource_templates',
  'read_mcp_resource',
  'update_plan',
  'wait_for_environment',
  'request_user_input',
  'new_context',
  'get_context_remaining',
  'clock__curr_time',
  'clock__sleep',
  'list_available_plugins_to_install',
  'request_plugin_install',
  'apply_patch',
  'view_image',
  'multi_agent_v1__spawn_agent',
  'multi_agent_v1__send_input',
  'multi_agent_v1__resume_agent',
  'multi_agent_v1__wait_agent',
  'multi_agent_v1__close_agent',
  'collaboration__spawn_agent',
  'collaboration__send_message',
  'collaboration__followup_task',
  'collaboration__wait_agent',
  'collaboration__interrupt_agent',
  'collaboration__list_agents',
  'spawn_agent',
  'send_input',
  'resume_agent',
  'wait_agent',
  'close_agent',
  'send_message',
  'followup_task',
  'interrupt_agent',
  'list_agents',
  'spawn_agents_on_csv',
  'report_agent_job_result',
  'tool_search',
  'web_search',
  'web__run',
  'image_gen__imagegen',
  'create_goal',
  'get_goal',
  'update_goal',
  'memories__add_ad_hoc_note',
  'memories__list',
  'memories__read',
  'memories__search',
  'skills__list',
  'skills__read',
] as const

export type CodexBuiltInTool = (typeof CODEX_BUILT_IN_TOOLS)[number]

export const CODEX_TOOL_SOURCE = {
  packageName: '@openai/codex',
  version: '0.144.6',
  tag: 'rust-v0.144.6',
  revision: '5d1fbf26c43abc65a203928b2e31561cb039e06d',
  checkedAt: '2026-07-21',
  registryPath: 'codex-rs/core/src/tools/spec_plan.rs',
  mcpPath: 'codex-rs/codex-mcp/src/tools.rs',
} as const

const agentTools = {
  spawn_agent: { kind: 'agent', label: 'SPAWN AGENT' },
  send_input: { kind: 'agent', label: 'SEND INPUT' },
  resume_agent: { kind: 'agent', label: 'RESUME AGENT' },
  wait_agent: { kind: 'wait', label: 'WAIT FOR AGENT' },
  close_agent: { kind: 'agent', label: 'CLOSE AGENT' },
  send_message: { kind: 'agent', label: 'MESSAGE' },
  followup_task: { kind: 'agent', label: 'FOLLOW UP' },
  interrupt_agent: { kind: 'agent', label: 'INTERRUPT AGENT' },
  list_agents: { kind: 'agent', label: 'AGENTS' },
} satisfies Readonly<Record<string, ToolCallPresentation>>

const codexTools = {
  exec: { kind: 'meta', label: 'CODE' },
  wait: { kind: 'wait', label: 'WAIT' },
  exec_command: { kind: 'bash', label: 'BASH' },
  write_stdin: { kind: 'bash', label: 'STDIN' },
  shell_command: { kind: 'bash', label: 'SHELL' },
  request_permissions: { kind: 'interaction', label: 'PERMISSIONS' },
  list_mcp_resources: { kind: 'external', label: 'MCP RESOURCES' },
  list_mcp_resource_templates: { kind: 'external', label: 'MCP TEMPLATES' },
  read_mcp_resource: { kind: 'external', label: 'MCP RESOURCE' },
  update_plan: { kind: 'plan', label: 'UPDATE PLAN' },
  wait_for_environment: { kind: 'wait', label: 'WAIT FOR ENVIRONMENT' },
  request_user_input: { kind: 'interaction', label: 'ASK USER' },
  new_context: { kind: 'meta', label: 'NEW CONTEXT' },
  get_context_remaining: { kind: 'meta', label: 'CONTEXT' },
  clock__curr_time: { kind: 'meta', label: 'TIME' },
  clock__sleep: { kind: 'wait', label: 'SLEEP' },
  list_available_plugins_to_install: {
    kind: 'external',
    label: 'AVAILABLE PLUGINS',
  },
  request_plugin_install: { kind: 'interaction', label: 'INSTALL PLUGIN' },
  apply_patch: { kind: 'edit', label: 'PATCH' },
  view_image: { kind: 'read', label: 'IMAGE' },
  multi_agent_v1__spawn_agent: agentTools.spawn_agent,
  multi_agent_v1__send_input: agentTools.send_input,
  multi_agent_v1__resume_agent: agentTools.resume_agent,
  multi_agent_v1__wait_agent: agentTools.wait_agent,
  multi_agent_v1__close_agent: agentTools.close_agent,
  collaboration__spawn_agent: agentTools.spawn_agent,
  collaboration__send_message: agentTools.send_message,
  collaboration__followup_task: agentTools.followup_task,
  collaboration__wait_agent: agentTools.wait_agent,
  collaboration__interrupt_agent: agentTools.interrupt_agent,
  collaboration__list_agents: agentTools.list_agents,
  ...agentTools,
  spawn_agents_on_csv: { kind: 'agent', label: 'SPAWN AGENTS' },
  report_agent_job_result: { kind: 'agent', label: 'JOB RESULT' },
  tool_search: { kind: 'external', label: 'TOOL SEARCH' },
  web_search: { kind: 'web', label: 'WEB SEARCH' },
  web__run: { kind: 'web', label: 'WEB SEARCH' },
  image_gen__imagegen: { kind: 'external', label: 'IMAGE GEN' },
  create_goal: { kind: 'plan', label: 'CREATE GOAL' },
  get_goal: { kind: 'plan', label: 'GET GOAL' },
  update_goal: { kind: 'plan', label: 'UPDATE GOAL' },
  memories__add_ad_hoc_note: { kind: 'write', label: 'MEMORY NOTE' },
  memories__list: { kind: 'external', label: 'MEMORIES' },
  memories__read: { kind: 'read', label: 'MEMORY' },
  memories__search: { kind: 'grep', label: 'MEMORY SEARCH' },
  skills__list: { kind: 'external', label: 'SKILLS' },
  skills__read: { kind: 'external', label: 'SKILL' },
} satisfies AgentToolCallOverrides<CodexBuiltInTool>

const formatSegment = (segment: string): string =>
  segment.replace(/[_-]+/g, ' ').trim().toUpperCase()

const inferCodexTool = (tool: string): ToolCallPresentation => {
  const segments = tool.split('__').filter(Boolean)
  const isPrefixedMcp = segments[0] === 'mcp'

  const rawProviderSegments = isPrefixedMcp
    ? segments.slice(1, -1)
    : segments.slice(0, -1)

  const providerSegments =
    rawProviderSegments[0] === 'codex_apps'
      ? rawProviderSegments.slice(1)
      : rawProviderSegments
  const action = segments[segments.length - 1]

  if (providerSegments.length > 0) {
    return {
      kind: 'external',
      label: `${formatSegment(providerSegments.join(' '))} · ${formatSegment(
        action
      )}`,
    }
  }

  return { kind: 'meta', label: formatSegment(tool) }
}

export const CODEX_TOOL_CALL_PROFILE: AgentToolCallProfile = {
  tools: codexTools,
  infer: inferCodexTool,
}
