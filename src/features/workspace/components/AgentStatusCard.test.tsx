// cspell:ignore cheatsheet incard powershell pwsh zsh
import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
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
      render(<AgentStatusCard title="ignored" state="idle" isShell />)
    ).not.toThrow()

    expect(useAgentStatus).not.toHaveBeenCalled()
  })

  test('renders the model-name title for an agent pane', () => {
    render(<AgentStatusCard title="claude-sonnet-4-6" state="running" />)

    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
  })

  test('no longer renders the in-card sidebar toggle (moved to the top bar / tab bar)', () => {
    render(<AgentStatusCard title="m" state="running" />)

    expect(
      screen.queryByTestId('sidebar-toggle-incard')
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Hide sidebar')).not.toBeInTheDocument()
  })

  test('does not render an explicit running status indicator (removed)', () => {
    render(<AgentStatusCard title="claude" state="running" />)

    expect(screen.queryByText('Running')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('agent-card-status-dot')
    ).not.toBeInTheDocument()
  })

  test('renders a shell placeholder without a SHELL title', () => {
    render(
      <AgentStatusCard
        title="ignored-model"
        state="idle"
        isShell
        shellName="/bin/zsh"
      />
    )

    expect(screen.queryByText('SHELL')).not.toBeInTheDocument()
    expect(screen.queryByText('ignored-model')).not.toBeInTheDocument()
    expect(
      screen.getByTestId('agent-status-card-shell-body')
    ).toBeInTheDocument()
    expect(screen.getByText('No active agent')).toBeInTheDocument()
    expect(screen.getByText('Idle · zsh shell')).toBeInTheDocument()
    expect(screen.getByText('terminal')).toBeInTheDocument()
  })

  test('normalizes shell executable names for shell status and cheatsheet link', () => {
    render(
      <AgentStatusCard
        title="ignored-model"
        state="idle"
        isShell
        shellName="C:\\Program Files\\PowerShell\\7\\pwsh.exe"
      />
    )

    expect(screen.getByText('Idle · pwsh shell')).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /pwsh cheatsheet/u })
    expect(link).toHaveAttribute(
      'href',
      'https://www.google.com/search?q=pwsh%20commands%20cheatsheet'
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
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
      />
    )

    expect(screen.queryByText('schedule')).not.toBeInTheDocument()
    expect(screen.queryByText('5-hour Session')).not.toBeInTheDocument()
    expect(screen.queryByText('Weekly Usage')).not.toBeInTheDocument()
  })

  test('renders only the turn count from the old metrics row', () => {
    render(
      <AgentStatusCard
        title="m"
        state="running"
        elapsed="2m"
        turns={12}
        contextPct={64}
      />
    )

    expect(screen.queryByText('schedule')).not.toBeInTheDocument()
    expect(screen.queryByText('2m')).not.toBeInTheDocument()
    expect(screen.queryByText('data_usage')).not.toBeInTheDocument()
    expect(screen.queryByText('64%')).not.toBeInTheDocument()
    expect(screen.getByText('forum')).toBeInTheDocument()
    expect(screen.getByText('12 turns')).toBeInTheDocument()
  })

  test('renders 5-hour and weekly usage bars when provided', () => {
    render(
      <AgentStatusCard
        title="m"
        state="running"
        fiveHourPct={12}
        weekPct={34}
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
      />
    )

    expect(screen.queryByText('5-hour Session')).not.toBeInTheDocument()
    expect(screen.queryByText('Weekly Usage')).not.toBeInTheDocument()
  })

  test('renders zero turns in the header pill', () => {
    render(
      <AgentStatusCard
        title="m"
        state="running"
        elapsed="2m"
        turns={0}
        contextPct={64}
      />
    )

    expect(screen.getByText('forum')).toBeInTheDocument()
    expect(screen.getByText('0 turns')).toBeInTheDocument()
    expect(screen.queryByText('schedule')).not.toBeInTheDocument()
    expect(screen.queryByText('data_usage')).not.toBeInTheDocument()
  })

  test('keeps a stable height and caps responsive width across agent and shell states', () => {
    const { rerender } = render(
      <AgentStatusCard
        title="m"
        state="running"
        turns={3}
        fiveHourPct={12}
        weekPct={34}
      />
    )

    const card = screen.getByTestId('sidebar-agent-status-card')
    expect(card).toHaveStyle({
      width: '100%',
      maxWidth: '320px',
      height: '125px',
    })

    rerender(
      <AgentStatusCard title="ignored" state="idle" isShell shellName="bash" />
    )

    expect(screen.getByTestId('sidebar-agent-status-card')).toHaveStyle({
      width: '100%',
      maxWidth: '320px',
      height: '125px',
    })
  })
})
