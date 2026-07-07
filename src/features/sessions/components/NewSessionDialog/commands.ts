import { AGENTS } from '../../../../agents/registry'
import type { AgentIcon } from '../../../../agents/brandIcons'
import type { CommandId } from '../../types'

export interface CommandDef {
  id: CommandId
  label: string
  kind: 'shell' | 'browser'
  accentVar: string
  // Mono fallback glyph (shell). Agents render their brand `Icon`, browser its
  // `materialIcon`, so those entries omit it.
  glyph?: string
  Icon?: AgentIcon
  materialIcon?: string
}

const fromAgent = (id: Exclude<CommandId, 'browser'>): CommandDef => ({
  id,
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
