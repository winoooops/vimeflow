import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, vi } from 'vitest'
import { AGENTS } from '../../../../agents/registry'
import { AgentStatusPanelHeader } from './Header'

test('renders agent glyph, short label, and a status dot', () => {
  render(
    <AgentStatusPanelHeader
      agent={AGENTS.claude}
      status="running"
      onCollapse={() => undefined}
    />
  )
  const glyphChip = screen.getByTestId('agent-glyph-chip')
  // eslint-disable-next-line testing-library/no-node-access -- claude renders an svg brand mark
  const brandMark = glyphChip.querySelector('svg')

  expect(brandMark).toBeInTheDocument()
  expect(screen.getByText('CLAUDE')).toBeInTheDocument()
  expect(screen.getByTestId('status-dot')).toBeInTheDocument()
})

test('chevron button fires onCollapse when clicked', async () => {
  const onCollapse = vi.fn()
  render(
    <AgentStatusPanelHeader
      agent={AGENTS.claude}
      status="running"
      onCollapse={onCollapse}
    />
  )

  await userEvent.click(
    screen.getByRole('button', { name: /collapse activity panel/i })
  )
  expect(onCollapse).toHaveBeenCalledTimes(1)
})

test('gradient wash uses agent.accentDim in inline style', () => {
  render(
    <AgentStatusPanelHeader
      agent={AGENTS.codex}
      status="idle"
      onCollapse={() => undefined}
    />
  )
  const header = screen.getByTestId('agent-status-panel-header')
  expect(header.getAttribute('style')).toMatch(/linear-gradient\(180deg/)
  expect(header.getAttribute('style')).toMatch(
    /var\(--color-agent-codex-accent-dim\)/
  )
})
