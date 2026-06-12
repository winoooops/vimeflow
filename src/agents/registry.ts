import anthropicMark from '../assets/vendor-icons/anthropic.svg'
import openaiMark from '../assets/vendor-icons/openai.svg'
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

export interface AgentDef extends PaneIdentity {
  id: string
  model: string | null
}

export const AGENTS = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    short: 'CLAUDE',
    glyph: '∴',
    model: 'sonnet-4',
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
    model: 'gpt-5-codex',
    accent: 'var(--color-agent-codex-accent)',
    accentDim: 'var(--color-agent-codex-accent-dim)',
    accentSoft: 'var(--color-agent-codex-accent-soft)',
    onAccent: 'var(--color-agent-codex-on-accent)',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    short: 'GEMINI',
    glyph: '✦',
    model: 'gemini-2.5',
    accent: 'var(--color-agent-gemini-accent)',
    accentDim: 'var(--color-agent-gemini-accent-dim)',
    accentSoft: 'var(--color-agent-gemini-accent-soft)',
    onAccent: 'var(--color-agent-gemini-on-accent)',
  },
  shell: {
    id: 'shell',
    name: 'Shell',
    short: 'SHELL',
    glyph: '$',
    model: null,
    accent: 'var(--color-agent-shell-accent)',
    accentDim: 'var(--color-agent-shell-accent-dim)',
    accentSoft: 'var(--color-agent-shell-accent-soft)',
    onAccent: 'var(--color-agent-shell-on-accent)',
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
    default:
      return 'shell'
  }
}

export const agentStatusToSessionStatus = (
  agentStatus: AgentStatus
): SessionStatus => (agentStatus.isActive ? 'running' : 'idle')

export const vendorMarkFor = (agentId: AgentId): string | null => {
  switch (agentId) {
    case 'claude':
      return anthropicMark
    case 'codex':
      return openaiMark
    default:
      return null
  }
}
