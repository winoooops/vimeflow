import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, vi } from 'vitest'
import { AGENTS } from '../../../../agents/registry'
import { AgentStatusPanelHeader } from './Header'

test('renders agent glyph and short label', () => {
  render(
    <AgentStatusPanelHeader
      agent={AGENTS.claude}
      onCollapse={() => undefined}
    />
  )
  expect(screen.getByText('∴')).toBeInTheDocument()
  expect(screen.getByText('CLAUDE')).toBeInTheDocument()
})

test('chevron button fires onCollapse when clicked', async () => {
  const onCollapse = vi.fn()
  render(
    <AgentStatusPanelHeader agent={AGENTS.claude} onCollapse={onCollapse} />
  )

  await userEvent.click(
    screen.getByRole('button', { name: /collapse activity panel/i })
  )
  expect(onCollapse).toHaveBeenCalledTimes(1)
})

test('gradient wash uses agent.accentDim in inline style', () => {
  render(
    <AgentStatusPanelHeader agent={AGENTS.codex} onCollapse={() => undefined} />
  )
  const header = screen.getByTestId('agent-status-panel-header')
  expect(header.getAttribute('style')).toMatch(/linear-gradient\(180deg/)
  expect(header.getAttribute('style')).toMatch(
    /var\(--color-agent-codex-accent-dim\)/
  )
})

test('adds macOS drag coverage while keeping collapse clickable', () => {
  render(
    <AgentStatusPanelHeader
      agent={AGENTS.claude}
      onCollapse={() => undefined}
      reserveWindowControls
    />
  )

  expect(screen.getByTestId('agent-status-panel-header')).toHaveClass(
    'vf-app-drag-region'
  )

  expect(
    screen.getByRole('button', { name: /collapse activity panel/i })
  ).toHaveClass('vf-app-no-drag')
})

test('does not add drag coverage when native controls are not reserved', () => {
  render(
    <AgentStatusPanelHeader
      agent={AGENTS.claude}
      onCollapse={() => undefined}
    />
  )

  expect(screen.getByTestId('agent-status-panel-header')).not.toHaveClass(
    'vf-app-drag-region'
  )
})
