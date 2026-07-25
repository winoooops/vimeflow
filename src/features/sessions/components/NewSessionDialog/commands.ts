import type { AgentIcon } from '@/agents/brandIcons'
import { AGENTS } from '@/agents/registry'
import type { CommandId } from '@/features/sessions/types'
import {
  configuredAgentAliases,
  type AgentAliasConfig,
} from '@/features/sessions/utils/agentResumeCommand'

export interface CommandDef {
  id: string
  command: CommandId
  agentLauncher?: string
  label: string
  kind: 'shell' | 'browser'
  accentVar: string
  // Mono fallback glyph, rendered only when a command has neither `Icon` nor
  // `materialIcon`. Every agent carries a brand `Icon` and browser its
  // `materialIcon`, so this is a fallback for future icon-less entries.
  glyph?: string
  Icon?: AgentIcon
  materialIcon?: string
}

const fromAgent = (id: Exclude<CommandId, 'browser'>): CommandDef => ({
  id,
  command: id,
  ...(id === 'shell' ? {} : { agentLauncher: id }),
  label: AGENTS[id].name,
  kind: 'shell',
  accentVar: `--color-agent-${id}-accent`,
  glyph: AGENTS[id].glyph,
  Icon: AGENTS[id].Icon,
})

export const COMMANDS: Record<CommandId, CommandDef> = {
  claude: fromAgent('claude'),
  codex: fromAgent('codex'),
  kimi: fromAgent('kimi'),
  opencode: fromAgent('opencode'),
  shell: fromAgent('shell'),
  browser: {
    id: 'browser',
    command: 'browser',
    label: 'Browser pane',
    kind: 'browser',
    accentVar: '--color-agent-browser-accent',
    materialIcon: 'language',
  },
}

export const COMMAND_ORDER: CommandId[] = [
  'claude',
  'codex',
  'kimi',
  'opencode',
  'browser',
  'shell',
]

export const buildCommandOptions = (
  aliasConfig: AgentAliasConfig | undefined
): readonly CommandDef[] =>
  COMMAND_ORDER.flatMap((command) => {
    const canonical = COMMANDS[command]
    if (command === 'browser' || command === 'shell') {
      return [canonical]
    }

    return [
      canonical,
      ...configuredAgentAliases(command, aliasConfig).map(
        (candidate): CommandDef => ({
          ...canonical,
          id: `alias:${candidate.alias}`,
          agentLauncher: candidate.alias,
          label: `${candidate.alias} · ${canonical.label}`,
        })
      ),
    ]
  })

export const commandForId = (
  commands: readonly CommandDef[],
  id: string
): CommandDef => commands.find((command) => command.id === id) ?? COMMANDS.shell
