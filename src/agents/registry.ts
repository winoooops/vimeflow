import {
  ClaudeCode,
  Codex,
  Kimi,
  OpenCode,
  Shell,
  type AgentIcon,
} from './brandIcons'
import type { AgentStatus } from '../features/agent-status/types'
import type { SessionStatus } from '../features/sessions/types'

export interface PaneIdentity {
  name: string
  short: string
  glyph: string
  accent: string
  accentDim: string
  accentSoft: string
  onAccent: string
}

/**
 * Notice shown in the agent status card's quota slot for an agent that exposes
 * no readable usage/quota API, in place of rate-limit bars.
 */
export interface QuotaNotice {
  /** One-line reason the quota bars are absent. */
  message: string
  /** Upstream feature-request URL the "track" link opens. */
  trackUrl: string
  /** Tooltip label for the "track" link. */
  tooltipLabel: string
}

export interface AgentDef extends PaneIdentity {
  id: string
  model: string | null
  resumeCommands: {
    latest: string
    byIdPrefix: string
  } | null
  Icon?: AgentIcon
  /**
   * Set only for agents that have no readable usage/quota API: the status card
   * renders this notice + a link to the upstream feature request instead of
   * 5-hour / weekly bars. Currently opencode (see sst/opencode#16017); cleared
   * once opencode ships a usage endpoint.
   */
  quotaNotice?: QuotaNotice
}

export const AGENTS = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    short: 'CLAUDE',
    glyph: '∴',
    Icon: ClaudeCode,
    model: 'sonnet-4',
    resumeCommands: {
      latest: '--continue',
      byIdPrefix: '--resume',
    },
    accent: 'var(--color-agent-claude-accent)',
    accentDim: 'var(--color-agent-claude-accent-dim)',
    accentSoft: 'var(--color-agent-claude-accent-soft)',
    onAccent: 'var(--color-agent-claude-on-accent)',
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    short: 'CODEX',
    glyph: '◇',
    Icon: Codex,
    model: 'gpt-5-codex',
    resumeCommands: {
      latest: 'resume --last',
      byIdPrefix: 'resume',
    },
    accent: 'var(--color-agent-codex-accent)',
    accentDim: 'var(--color-agent-codex-accent-dim)',
    accentSoft: 'var(--color-agent-codex-accent-soft)',
    onAccent: 'var(--color-agent-codex-on-accent)',
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi',
    short: 'KIMI',
    glyph: '☾',
    Icon: Kimi,
    model: 'k2.7',
    resumeCommands: {
      latest: '--continue',
      byIdPrefix: '--session',
    },
    accent: 'var(--color-agent-kimi-accent)',
    accentDim: 'var(--color-agent-kimi-accent-dim)',
    accentSoft: 'var(--color-agent-kimi-accent-soft)',
    onAccent: 'var(--color-agent-kimi-on-accent)',
  },
  shell: {
    id: 'shell',
    name: 'Shell',
    short: 'SHELL',
    glyph: '$',
    Icon: Shell,
    model: null,
    resumeCommands: null,
    accent: 'var(--color-agent-shell-accent)',
    accentDim: 'var(--color-agent-shell-accent-dim)',
    accentSoft: 'var(--color-agent-shell-accent-soft)',
    onAccent: 'var(--color-agent-shell-on-accent)',
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    short: 'OPENCODE',
    glyph: '◈',
    Icon: OpenCode,
    model: null,
    resumeCommands: {
      latest: '--continue',
      byIdPrefix: '--session',
    },
    accent: 'var(--color-agent-opencode-accent)',
    accentDim: 'var(--color-agent-opencode-accent-dim)',
    accentSoft: 'var(--color-agent-opencode-accent-soft)',
    onAccent: 'var(--color-agent-opencode-on-accent)',
    // opencode exposes no readable usage/quota API (Zen is pay-as-you-go
    // credits; Go's 5h/weekly windows live in opencode.ai's cloud with no
    // queryable endpoint). Show a notice + link to the upstream request rather
    // than fabricating empty bars.
    quotaNotice: {
      message: 'Usage limits not exposed by OpenCode yet',
      trackUrl: 'https://github.com/sst/opencode/issues/16017',
      tooltipLabel:
        'OpenCode usage API — open the feature request (sst/opencode#16017)',
    },
  },
} as const satisfies Record<string, AgentDef>

export type AgentId = keyof typeof AGENTS

export type Agent = (typeof AGENTS)[AgentId]

export const agentTypeToRegistryKey = (
  agentType: AgentStatus['agentType']
): AgentId => {
  switch (agentType) {
    case 'claude-code':
      return 'claude'
    case 'codex':
      return 'codex'
    case 'kimi':
      return 'kimi'
    case 'opencode':
      return 'opencode'
    default:
      return 'shell'
  }
}

export const agentStatusToSessionStatus = (
  agentStatus: AgentStatus
): SessionStatus => (agentStatus.isActive ? 'running' : 'idle')
