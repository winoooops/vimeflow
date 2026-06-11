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
      render(<AgentStatusCard title="ignored" isShell />)
    ).not.toThrow()

    expect(useAgentStatus).not.toHaveBeenCalled()
  })

  test('renders the model-name title for an agent pane', () => {
    render(<AgentStatusCard title="claude-sonnet-4-6" />)

    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
  })

  test('splits a "(<size> context)" title into a name + compact context badge', () => {
    render(<AgentStatusCard title="Opus 4.8 (1M context)" />)

    expect(screen.getByText('Opus 4.8')).toBeInTheDocument()
    expect(screen.getByTestId('agent-card-context-badge')).toHaveTextContent(
      '1M'
    )

    // The raw "(1M context)" suffix must not render inline — it truncated to
    // "Opus 4.8 (1M cont…" before this split.
    expect(screen.queryByText('Opus 4.8 (1M context)')).not.toBeInTheDocument()
  })

  test('omits the context badge when the title has no context suffix', () => {
    render(<AgentStatusCard title="claude-sonnet-4-6" />)

    expect(
      screen.queryByTestId('agent-card-context-badge')
    ).not.toBeInTheDocument()
  })

  test('no longer renders the in-card sidebar toggle (moved to the top bar / tab bar)', () => {
    render(<AgentStatusCard title="m" />)

    expect(
      screen.queryByTestId('sidebar-toggle-incard')
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Hide sidebar')).not.toBeInTheDocument()
  })

  test('does not render an explicit running status indicator (removed)', () => {
    render(<AgentStatusCard title="claude" />)

    expect(screen.queryByText('Running')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('agent-card-status-dot')
    ).not.toBeInTheDocument()
  })

  test('renders a shell placeholder without a SHELL title', () => {
    render(
      <AgentStatusCard
        title="ignored-model"
       
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
       
        isShell
        shellName="C:\\Program Files\\PowerShell\\7\\pwsh.exe"
      />
    )

    expect(screen.getByText('Idle · pwsh shell')).toBeInTheDocument()

    // pwsh has no cheat.sh topic of its own — cheat.sh serves it as a bare
    // "alias of powershell" stub — so the link maps to the populated
    // `powershell` topic while the label still names the real binary.
    const link = screen.getByRole('link', { name: /pwsh cheatsheet/u })
    expect(link).toHaveAttribute('href', 'https://cheat.sh/powershell')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  test('links to the cheat.sh cheatsheet for the resolved shell (bash, not just zsh)', () => {
    const { rerender } = render(
      <AgentStatusCard title="x" isShell shellName="/bin/zsh" />
    )

    expect(
      screen.getByRole('link', { name: /zsh cheatsheet/u })
    ).toHaveAttribute('href', 'https://cheat.sh/zsh')

    rerender(
      <AgentStatusCard title="x" isShell shellName="/bin/bash" />
    )

    expect(
      screen.getByRole('link', { name: /bash cheatsheet/u })
    ).toHaveAttribute('href', 'https://cheat.sh/bash')
  })

  test('falls back to the POSIX sh cheatsheet when no concrete shell name is resolved', () => {
    // `activePtyBackedPane?.shell ?? null` can pass null for a shell pane;
    // normalizeShellName yields the `shell` sentinel, which is NOT a cheat.sh
    // topic — so the link must resolve to the real POSIX `sh` cheatsheet.
    render(<AgentStatusCard title="x" isShell shellName={null} />)

    expect(
      screen.getByRole('link', { name: /shell cheatsheet/u })
    ).toHaveAttribute('href', 'https://cheat.sh/sh')
  })

  test('falls back to the POSIX sh cheatsheet for unknown shells', () => {
    // Unknown shells (e.g. nushell installed to a custom path, or a company
    // wrapper) must not be passed through to cheat.sh as a 404 topic.
    render(
      <AgentStatusCard
        title="x"
       
        isShell
        shellName="/opt/bin/nushell"
      />
    )

    expect(
      screen.getByRole('link', { name: /shell cheatsheet/u })
    ).toHaveAttribute('href', 'https://cheat.sh/sh')
  })

  test('hides agent metrics and usage bars on a shell pane', () => {
    render(
      <AgentStatusCard
        title="x"
       
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
       
        turns={3}
        fiveHourPct={12}
        weekPct={34}
      />
    )

    const card = screen.getByTestId('sidebar-agent-status-card')
    expect(card).toHaveStyle({
      width: '100%',
      maxWidth: '360px',
      height: '125px',
    })

    rerender(
      <AgentStatusCard title="ignored" isShell shellName="bash" />
    )

    expect(screen.getByTestId('sidebar-agent-status-card')).toHaveStyle({
      width: '100%',
      maxWidth: '360px',
      height: '125px',
    })
  })
})
