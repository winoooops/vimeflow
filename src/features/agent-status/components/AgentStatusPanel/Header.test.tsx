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
  const glyphChip = screen.getByTestId('agent-glyph-chip')
  // eslint-disable-next-line testing-library/no-node-access -- claude renders an svg brand mark
  const brandMark = glyphChip.querySelector('svg')

  expect(brandMark).toBeInTheDocument()
  expect(screen.getByText('CLAUDE')).toBeInTheDocument()
})

test('reserves a fixed 44px header height', () => {
  render(
    <AgentStatusPanelHeader
      agent={AGENTS.claude}
      onCollapse={() => undefined}
    />
  )

  expect(screen.getByTestId('agent-status-panel-header')).toHaveClass('h-11')
})

test('shows compact refresh affordance without replacing status', () => {
  render(
    <AgentStatusPanelHeader
      agent={AGENTS.claude}
      isRefreshing
      onCollapse={() => undefined}
    />
  )

  expect(screen.queryByTestId('status-dot')).not.toBeInTheDocument()
  expect(screen.getByText('fetching latest')).toBeInTheDocument()
  expect(screen.getByText('sync')).toBeInTheDocument()
  expect(screen.getByTestId('agent-glyph-chip')).toHaveAttribute(
    'data-refreshing',
    'true'
  )
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

test('shows the red needs-reattach state when stale', () => {
  render(
    <AgentStatusPanelHeader
      agent={AGENTS.codex}
      needsReattach
      onCollapse={() => undefined}
    />
  )

  expect(screen.getByTestId('agent-glyph-chip')).toHaveAttribute(
    'data-stale',
    'true'
  )
  // The red state is an instruction (recovery is automatic once the user sends
  // a prompt), not a clickable action.
  expect(screen.getByText('send a prompt to reattach')).toBeInTheDocument()
  expect(screen.getByText('link_off')).toBeInTheDocument()
})

test('never renders a manual reattach button (recovery is automatic)', () => {
  render(
    <AgentStatusPanelHeader
      agent={AGENTS.codex}
      needsReattach
      onCollapse={() => undefined}
    />
  )

  expect(
    screen.queryByRole('button', { name: /reattach agent session/i })
  ).not.toBeInTheDocument()
})
