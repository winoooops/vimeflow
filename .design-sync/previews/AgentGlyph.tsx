import { AgentGlyph } from 'vibm'

const surface = {
  background: 'var(--color-surface)',
  color: 'var(--color-on-surface)',
  padding: 24,
  borderRadius: 12,
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: 16,
}

// Agent-shaped records mirroring src/agents/registry.ts (the bundle exports
// neither AGENTS nor the brand Icon SVGs, so Icon-less entries exercise the
// component's glyph-fallback branch — the same path the app hits for shell).
const AGENTS = [
  {
    id: 'claude',
    name: 'Claude Code',
    short: 'CLAUDE',
    glyph: '∴',
    accent: 'var(--color-agent-claude-accent)',
    accentDim: 'var(--color-agent-claude-accent-dim)',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    short: 'CODEX',
    glyph: '◇',
    accent: 'var(--color-agent-codex-accent)',
    accentDim: 'var(--color-agent-codex-accent-dim)',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    short: 'KIMI',
    glyph: '☾',
    accent: 'var(--color-agent-kimi-accent)',
    accentDim: 'var(--color-agent-kimi-accent-dim)',
  },
  {
    id: 'shell',
    name: 'Shell',
    short: 'SHELL',
    glyph: '$',
    accent: 'var(--color-agent-shell-accent)',
    accentDim: 'var(--color-agent-shell-accent-dim)',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    short: 'OPENCODE',
    glyph: '◈',
    accent: 'var(--color-agent-opencode-accent)',
    accentDim: 'var(--color-agent-opencode-accent-dim)',
  },
] as const

// The session-tab chip treatment from src/features/sessions/components/Tab.tsx:
// 16px rounded square, accent-dim fill, accent glyph.
const chip = (agent: (typeof AGENTS)[number], box = 16, font = 10) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: box,
  height: box,
  flexShrink: 0,
  borderRadius: Math.round(box / 4),
  background: agent.accentDim,
  color: agent.accent,
  fontFamily: 'var(--font-mono)',
  fontSize: font,
  fontWeight: 700,
})

// Every registry agent, rendered as its accent chip + short name.
export const RegistryAgents = () => (
  <div style={{ ...surface, gap: 24 }}>
    {AGENTS.map((agent) => (
      <div
        key={agent.id}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={chip(agent, 28, 15)} aria-hidden>
          <AgentGlyph agent={agent} size={20} />
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.08em',
            color: 'var(--color-on-surface-variant)',
          }}
        >
          {agent.short}
        </span>
      </div>
    ))}
  </div>
)

// Glyphs in situ — the session-tab row composition the app uses.
export const SessionTabRows = () => {
  const sessions = [
    { agent: AGENTS[0], name: 'vim-362 kimi resume', active: true },
    { agent: AGENTS[1], name: 'review: ds-bundle sync', active: false },
    { agent: AGENTS[2], name: 'transcript locator', active: false },
    { agent: AGENTS[3], name: 'zsh ~/projects/vimeflow', active: false },
  ]
  return (
    <div style={surface}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          width: 260,
        }}
      >
        {sessions.map(({ agent, name, active }) => (
          <div
            key={name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 8,
              background: active
                ? 'var(--color-surface-container-high)'
                : 'transparent',
            }}
          >
            <span style={chip(agent)} aria-hidden>
              <AgentGlyph agent={agent} size={12} />
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12.5,
                fontWeight: active ? 500 : 400,
                color: active
                  ? 'var(--color-on-surface)'
                  : 'var(--color-on-surface-variant)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// The registry's Icon slot (brand SVGs, fill=currentColor) honors `size`;
// a stand-in mark demos that branch since the brand SVGs aren't bundled.
const PromptMark = ({ size = 14, ...props }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={3}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M4 5l8 7-8 7" />
    <path d="M14 19h7" />
  </svg>
)

export const IconSlotSizes = () => {
  const iconAgent = {
    id: 'claude',
    name: 'Claude Code',
    short: 'CLAUDE',
    glyph: '∴',
    Icon: PromptMark,
    accent: 'var(--color-agent-claude-accent)',
    accentDim: 'var(--color-agent-claude-accent-dim)',
  }
  return (
    <div style={{ ...surface, alignItems: 'flex-end', gap: 24 }}>
      {[12, 16, 24, 36].map((size) => (
        <div
          key={size}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            color: iconAgent.accent,
          }}
        >
          <AgentGlyph agent={iconAgent} size={size} />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: 'var(--color-on-surface-variant)',
            }}
          >
            {size}px
          </span>
        </div>
      ))}
      <span
        style={{
          fontSize: 10,
          color: 'var(--color-on-surface-muted)',
          maxWidth: 180,
        }}
      >
        Icon slot (stand-in mark — brand SVGs live in src/agents/brandIcons)
      </span>
    </div>
  )
}
