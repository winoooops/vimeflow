import { AGENTS, type AgentIcon } from '../../../../agents/registry'
import { BROWSER_IDENTITY } from '../../../browser/browserIdentity'
import type { CommandId } from '../../types'

export interface CommandDef {
  id: CommandId
  label: string
  kind: 'shell' | 'browser'
  accentVar: string
  glyph: string
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
    glyph: BROWSER_IDENTITY.glyph,
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
