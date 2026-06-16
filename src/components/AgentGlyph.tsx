import type { ReactElement } from 'react'
import type { Agent } from '@/agents/registry'

interface AgentGlyphProps {
  agent: Agent
  size?: number
}

// Renders an agent's brand mark — the registry SVG when defined, else its glyph fallback.
export const AgentGlyph = ({
  agent,
  size = 14,
}: AgentGlyphProps): ReactElement => {
  const Icon = agent.Icon

  if (Icon) {
    return <Icon size={size} aria-hidden />
  }

  return <>{agent.glyph}</>
}
