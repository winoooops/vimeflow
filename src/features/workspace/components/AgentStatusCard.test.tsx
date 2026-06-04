// cspell:ignore incard
import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import type { AgentCardState } from './AgentStatusCard'
import { AgentStatusCard } from './AgentStatusCard'

describe('AgentStatusCard', () => {
  test('renders the title', () => {
    render(
      <AgentStatusCard
        title="my session"
        state="idle"
        onToggleSidebar={vi.fn()}
      />
    )

    expect(screen.getByText('my session')).toBeInTheDocument()
  })

  test.each<[AgentCardState, string]>([
    ['running', 'Running'],
    ['awaiting', 'Awaiting you'],
    ['completed', 'Completed'],
    ['errored', 'Errored'],
    ['idle', 'Idle'],
  ])('maps the %s state to the "%s" label', (state, label) => {
    render(
      <AgentStatusCard
        title="my session"
        state={state}
        onToggleSidebar={vi.fn()}
      />
    )

    expect(screen.getByText(label)).toBeInTheDocument()
  })

  test('renders the status dot', () => {
    render(
      <AgentStatusCard
        title="my session"
        state="running"
        onToggleSidebar={vi.fn()}
      />
    )

    expect(screen.getByTestId('agent-card-status-dot')).toBeInTheDocument()
  })

  test('collapses the metric row when all metrics are absent', () => {
    render(
      <AgentStatusCard
        title="my session"
        state="idle"
        elapsed={null}
        turns={null}
        contextPct={null}
        onToggleSidebar={vi.fn()}
      />
    )

    expect(screen.queryByText('schedule')).not.toBeInTheDocument()
    expect(screen.queryByText('forum')).not.toBeInTheDocument()
    expect(screen.queryByText('data_usage')).not.toBeInTheDocument()
  })

  test('renders all three metrics when provided', () => {
    render(
      <AgentStatusCard
        title="my session"
        state="running"
        elapsed="2m"
        turns={12}
        contextPct={64}
        onToggleSidebar={vi.fn()}
      />
    )

    expect(screen.getByText('schedule')).toBeInTheDocument()
    expect(screen.getByText('2m')).toBeInTheDocument()
    expect(screen.getByText('forum')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('data_usage')).toBeInTheDocument()
    expect(screen.getByText('64%')).toBeInTheDocument()
  })

  test('guards a zero turn count from the metric row', () => {
    render(
      <AgentStatusCard
        title="my session"
        state="running"
        elapsed="2m"
        turns={0}
        contextPct={64}
        onToggleSidebar={vi.fn()}
      />
    )

    expect(screen.queryByText('forum')).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.getByText('schedule')).toBeInTheDocument()
    expect(screen.getByText('data_usage')).toBeInTheDocument()
  })

  test('renders the subtitle when provided', () => {
    render(
      <AgentStatusCard
        title="my session"
        state="running"
        subtitle="Editing src/main.tsx"
        onToggleSidebar={vi.fn()}
      />
    )

    expect(screen.getByText('Editing src/main.tsx')).toBeInTheDocument()
  })

  test('omits the subtitle when null', () => {
    render(
      <AgentStatusCard
        title="my session"
        state="running"
        subtitle={null}
        onToggleSidebar={vi.fn()}
      />
    )

    expect(screen.queryByText('Editing src/main.tsx')).not.toBeInTheDocument()
  })

  test('renders the in-card toggle and invokes onToggleSidebar on click', async () => {
    const user = userEvent.setup()
    const onToggleSidebar = vi.fn()
    render(
      <AgentStatusCard
        title="my session"
        state="running"
        onToggleSidebar={onToggleSidebar}
      />
    )

    const toggle = screen.getByTestId('sidebar-toggle-incard')
    expect(toggle).toBeInTheDocument()

    await user.click(toggle)

    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
  })
})
