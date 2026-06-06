// cspell:ignore incard
import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { AgentStatusCard } from './AgentStatusCard'
import { useAgentStatus } from '../../agent-status/hooks/useAgentStatus'

vi.mock('../../agent-status/hooks/useAgentStatus', () => ({
  useAgentStatus: vi.fn(() => {
    throw new Error('AgentStatusCard must not subscribe to useAgentStatus')
  }),
}))

describe('AgentStatusCard', () => {
  test('does not subscribe to useAgentStatus so the single-subscription invariant stays in WorkspaceView', () => {
    expect(() =>
      render(
        <AgentStatusCard
          title="ignored"
          state="idle"
          isShell
          onToggleSidebar={vi.fn()}
        />
      )
    ).not.toThrow()

    expect(useAgentStatus).not.toHaveBeenCalled()
  })

  test('renders the model-name title for an agent pane', () => {
    render(
      <AgentStatusCard
        title="claude-sonnet-4-6"
        state="running"
        onToggleSidebar={vi.fn()}
      />
    )

    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
  })

  test('does not render an explicit running status indicator (removed)', () => {
    render(
      <AgentStatusCard
        title="claude"
        state="running"
        onToggleSidebar={vi.fn()}
      />
    )

    expect(screen.queryByText('Running')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('agent-card-status-dot')
    ).not.toBeInTheDocument()
  })

  test('renders the SHELL placeholder for a shell pane', () => {
    render(
      <AgentStatusCard
        title="ignored-model"
        state="idle"
        isShell
        onToggleSidebar={vi.fn()}
      />
    )

    expect(screen.getByText('SHELL')).toBeInTheDocument()
    expect(screen.queryByText('ignored-model')).not.toBeInTheDocument()
    expect(
      screen.getByTestId('agent-status-card-shell-body')
    ).toBeInTheDocument()
    expect(screen.getByText('No active agent')).toBeInTheDocument()
    expect(screen.getByText('Idle · shell only')).toBeInTheDocument()
    expect(screen.getByText('terminal')).toBeInTheDocument()
  })

  test('hides agent metrics and usage bars on a shell pane', () => {
    render(
      <AgentStatusCard
        title="x"
        state="idle"
        isShell
        elapsed="8m"
        turns={6}
        contextPct={57}
        fiveHourPct={12}
        weekPct={34}
        onToggleSidebar={vi.fn()}
      />
    )

    expect(screen.queryByText('schedule')).not.toBeInTheDocument()
    expect(screen.queryByText('5-hour Session')).not.toBeInTheDocument()
    expect(screen.queryByText('Weekly Usage')).not.toBeInTheDocument()
  })

  test('renders the session metrics when provided', () => {
    render(
      <AgentStatusCard
        title="m"
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

  test('renders 5-hour and weekly usage bars when provided', () => {
    render(
      <AgentStatusCard
        title="m"
        state="running"
        fiveHourPct={12}
        weekPct={34}
        onToggleSidebar={vi.fn()}
      />
    )

    expect(screen.getByText('5-hour Session')).toBeInTheDocument()
    expect(screen.getByText('12%')).toBeInTheDocument()
    expect(screen.getByText('Weekly Usage')).toBeInTheDocument()
    expect(screen.getByText('34%')).toBeInTheDocument()
  })

  test('omits the usage bars when both usages are null', () => {
    render(
      <AgentStatusCard
        title="m"
        state="running"
        fiveHourPct={null}
        weekPct={null}
        onToggleSidebar={vi.fn()}
      />
    )

    expect(screen.queryByText('5-hour Session')).not.toBeInTheDocument()
    expect(screen.queryByText('Weekly Usage')).not.toBeInTheDocument()
  })

  test('guards a zero turn count from the metric row', () => {
    render(
      <AgentStatusCard
        title="m"
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

  test('renders the in-card toggle and invokes onToggleSidebar on click', async () => {
    const user = userEvent.setup()
    const onToggleSidebar = vi.fn()
    render(
      <AgentStatusCard
        title="m"
        state="running"
        onToggleSidebar={onToggleSidebar}
      />
    )

    await user.click(screen.getByTestId('sidebar-toggle-incard'))

    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
  })
})
