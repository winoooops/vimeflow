interface AgentDef {
  id: string
  name: string
  short: string
  glyph: string
  model: string | null
  accent: string
  accentDim: string
  accentSoft: string
  onAccent: string
}

export const AGENTS = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    short: 'CLAUDE',
    glyph: '∴',
    model: 'sonnet-4',
    accent: '#cba6f7',
    accentDim: 'rgb(203 166 247 / 0.16)',
    accentSoft: 'rgb(203 166 247 / 0.32)',
    onAccent: '#2a1646',
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    short: 'CODEX',
    glyph: '◇',
    model: 'gpt-5-codex',
    accent: '#7defa1',
    accentDim: 'rgb(125 239 161 / 0.16)',
    accentSoft: 'rgb(125 239 161 / 0.32)',
    onAccent: '#0a2415',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    short: 'GEMINI',
    glyph: '✦',
    model: 'gemini-2.5',
    accent: '#a8c8ff',
    accentDim: 'rgb(168 200 255 / 0.16)',
    accentSoft: 'rgb(168 200 255 / 0.32)',
    onAccent: '#0e1c33',
  },
  shell: {
    id: 'shell',
    name: 'Shell',
    short: 'SHELL',
    glyph: '$',
    model: null,
    accent: '#f0c674',
    accentDim: 'rgb(240 198 116 / 0.14)',
    accentSoft: 'rgb(240 198 116 / 0.30)',
    onAccent: '#2a1f08',
  },
} as const satisfies Record<string, AgentDef>

export type AgentId = keyof typeof AGENTS

export type Agent = (typeof AGENTS)[AgentId]
