import { test, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AGENTS, type AgentDef } from '@/agents/registry'
import { AgentGlyph } from './AgentGlyph'

test('renders the brand SVG for an agent that defines an Icon', () => {
  const { container } = render(<AgentGlyph agent={AGENTS.codex} size={14} />)
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- verifying brand SVG render
  const svg = container.querySelector('svg')

  expect(svg).toBeInTheDocument()
})

test('mono brand mark inherits currentColor for theme adaptation', () => {
  const { container } = render(<AgentGlyph agent={AGENTS.claude} />)
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- verifying themeable fill
  const svg = container.querySelector('svg')

  expect(svg?.getAttribute('fill')).toBe('currentColor')
})

test('renders the brand SVG for the shell agent', () => {
  const { container } = render(<AgentGlyph agent={AGENTS.shell} />)
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- verifying brand SVG render
  const svg = container.querySelector('svg')

  expect(svg).toBeInTheDocument()
  expect(svg?.getAttribute('fill')).toBe('currentColor')
})

test('falls back to the unicode glyph for an agent without an Icon', () => {
  const agentWithoutIcon: AgentDef = { ...AGENTS.shell, Icon: undefined }
  const { container } = render(<AgentGlyph agent={agentWithoutIcon} />)
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting no SVG in fallback
  const svg = container.querySelector('svg')

  expect(svg).toBeNull()
  expect(container).toHaveTextContent('$')
})
