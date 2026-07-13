import type { AgentAlias } from '@/bindings'
import { AGENTS, agentTypeToRegistryKey, type AgentId } from '@/agents/registry'
import type { CommandId, Pane } from '../types'

const SAFE_AGENT_SESSION_ID = /^[A-Za-z0-9_-]{1,256}$/
const SAFE_AGENT_ALIAS = /^[A-Za-z_][A-Za-z0-9_-]*$/
const SUBMITTED_LAUNCHER = /^\s*([A-Za-z_][A-Za-z0-9_-]*)(?:\s|$)/

const CANONICAL_AGENT_LAUNCHERS = Object.values(AGENTS)
  .filter((agent) => agent.resumeCommands !== null)
  .map((agent) => agent.id)

export interface AgentAliasConfig {
  enabled: boolean
  aliases: readonly AgentAlias[]
}

export interface AgentCommandOptions {
  aliasConfig?: AgentAliasConfig
  launcher?: string
}

const effectiveAliases = (
  config: AgentAliasConfig | undefined
): readonly AgentAlias[] => {
  if (!config?.enabled) {
    return []
  }

  const lastIndexByName = new Map<string, number>()
  config.aliases.forEach((candidate, index) => {
    if (SAFE_AGENT_ALIAS.test(candidate.alias)) {
      lastIndexByName.set(candidate.alias, index)
    }
  })

  return config.aliases.filter(
    (candidate, index) => lastIndexByName.get(candidate.alias) === index
  )
}

export const configuredAgentAliases = (
  agentId: AgentId,
  config: AgentAliasConfig | undefined
): readonly AgentAlias[] =>
  effectiveAliases(config).filter((candidate) => candidate.agent === agentId)

export const submittedLauncherTokenFromCommand = (
  command: string
): string | null => SUBMITTED_LAUNCHER.exec(command)?.[1] ?? null

export const agentLauncherFromCommand = (
  command: string,
  config: AgentAliasConfig | undefined
): string | null => {
  const launcher = submittedLauncherTokenFromCommand(command)
  if (launcher === null) {
    return null
  }

  if (CANONICAL_AGENT_LAUNCHERS.some((candidate) => candidate === launcher)) {
    return launcher
  }

  return effectiveAliases(config).some(
    (candidate) => candidate.alias === launcher
  )
    ? launcher
    : null
}

export const resolveAgentLauncher = (
  agentId: AgentId,
  options: AgentCommandOptions = {},
  useUniqueAliasFallback = false
): string | null => {
  const commands = AGENTS[agentId].resumeCommands
  if (commands === null) {
    return null
  }

  const canonical = AGENTS[agentId].id
  if (options.launcher === canonical) {
    return canonical
  }

  const aliases = configuredAgentAliases(agentId, options.aliasConfig)
  if (options.launcher !== undefined) {
    return (
      aliases.find((candidate) => candidate.alias === options.launcher)
        ?.alias ?? canonical
    )
  }

  return useUniqueAliasFallback && aliases.length === 1
    ? aliases[0].alias
    : canonical
}

export const buildAgentStartCommand = (
  command: CommandId,
  options: AgentCommandOptions = {}
): string | null => {
  if (command === 'browser' || command === 'shell') {
    return null
  }

  return resolveAgentLauncher(command, options)
}

export const buildAgentResumeCommand = (
  agentType: Pane['agentType'],
  agentSessionId: string | null | undefined,
  options: AgentCommandOptions = {}
): string | null => {
  const agentId = agentTypeToRegistryKey(agentType)
  const commands = AGENTS[agentId].resumeCommands
  const launcher = resolveAgentLauncher(agentId, options, true)

  if (
    commands === null ||
    launcher === null ||
    (agentSessionId !== null &&
      agentSessionId !== undefined &&
      !SAFE_AGENT_SESSION_ID.test(agentSessionId))
  ) {
    return null
  }

  return agentSessionId === null || agentSessionId === undefined
    ? `${launcher} ${commands.latest}`
    : `${launcher} ${commands.byIdPrefix} '${agentSessionId}'`
}

export const loadAgentAliasConfig = async (): Promise<AgentAliasConfig> => {
  const aliasesBridge = window.vimeflow?.aliases
  const settingsBridge = window.vimeflow?.settings

  if (aliasesBridge === undefined || settingsBridge === undefined) {
    return { enabled: false, aliases: [] }
  }

  try {
    const [aliases, settings] = await Promise.all([
      aliasesBridge.load(),
      settingsBridge.load(),
    ])

    return { enabled: settings.agentShimEnabled, aliases }
  } catch {
    return { enabled: false, aliases: [] }
  }
}
