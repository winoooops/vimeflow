import { render, screen } from '@testing-library/react'
import { test, expect } from 'vitest'
import { AGENTS } from '../../../../agents/registry'
import { AgentStatusPanelHeader } from './Header'

test('renders agent glyph and short label', () => {
  render(<AgentStatusPanelHeader agent={AGENTS.claude} />)
  const glyphChip = screen.getByTestId('agent-glyph-chip')
  // eslint-disable-next-line testing-library/no-node-access -- claude renders an svg brand mark
  const brandMark = glyphChip.querySelector('svg')

  expect(brandMark).toBeInTheDocument()
  expect(screen.getByText('CLAUDE')).toBeInTheDocument()
})

test('reserves a fixed 44px header height', () => {
  render(<AgentStatusPanelHeader agent={AGENTS.claude} />)

  expect(screen.getByTestId('agent-status-panel-header')).toHaveClass('h-11')
})

test('shows compact refresh affordance without replacing status', () => {
  render(<AgentStatusPanelHeader agent={AGENTS.claude} isRefreshing />)

  expect(screen.queryByTestId('status-dot')).not.toBeInTheDocument()
  expect(screen.getByText('fetching latest')).toBeInTheDocument()
  expect(screen.getByText('sync')).toBeInTheDocument()
  expect(screen.getByTestId('agent-glyph-chip')).toHaveAttribute(
    'data-refreshing',
    'true'
  )
})

test('adds macOS drag coverage with a no-drag clearance for the floating toggle', () => {
  render(<AgentStatusPanelHeader agent={AGENTS.claude} reserveWindowControls />)

  expect(screen.getByTestId('agent-status-panel-header')).toHaveClass(
    'vf-app-drag-region'
  )

  expect(screen.getByTestId('activity-toggle-clearance')).toHaveClass(
    'vf-app-no-drag'
  )
})

test('omits drag coverage and clearance when native controls are not reserved', () => {
  render(<AgentStatusPanelHeader agent={AGENTS.claude} />)

  expect(screen.getByTestId('agent-status-panel-header')).not.toHaveClass(
    'vf-app-drag-region'
  )

  expect(
    screen.queryByTestId('activity-toggle-clearance')
  ).not.toBeInTheDocument()
})

test('shows the red needs-reattach state when stale', () => {
  render(<AgentStatusPanelHeader agent={AGENTS.codex} needsReattach />)

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
  render(<AgentStatusPanelHeader agent={AGENTS.codex} needsReattach />)

  expect(
    screen.queryByRole('button', { name: /reattach agent session/i })
  ).not.toBeInTheDocument()
})
