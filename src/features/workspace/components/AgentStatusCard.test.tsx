// cspell:ignore cheatsheet deepseek incard powershell pwsh zsh
import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import { AgentStatusCard } from './AgentStatusCard'
import { useAgentStatus } from '../../agent-status/hooks/useAgentStatus'

vi.mock('../../agent-status/hooks/useAgentStatus', () => ({
  useAgentStatus: vi.fn(() => {
    throw new Error('AgentStatusCard must not subscribe to useAgentStatus')
  }),
}))

// Stub the gate so this stays a branch test (the real gate does consent IPC).
vi.mock('../../agent-status/components/KimiUsageGate', () => ({
  KimiUsageGate: (): ReactElement => <div data-testid="kimi-usage-gate" />,
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
    expect(screen.getByTestId('sidebar-agent-status-card')).toHaveAttribute(
      'data-agent-state',
      'active'
    )
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
      <AgentStatusCard title="ignored-model" isShell shellName="/bin/zsh" />
    )

    expect(screen.queryByText('SHELL')).not.toBeInTheDocument()
    expect(screen.queryByText('ignored-model')).not.toBeInTheDocument()
    expect(
      screen.getByTestId('agent-status-card-shell-body')
    ).toBeInTheDocument()

    expect(screen.getByTestId('sidebar-agent-status-card')).toHaveAttribute(
      'data-agent-state',
      'idle'
    )
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

    rerender(<AgentStatusCard title="x" isShell shellName="/bin/bash" />)

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
    render(<AgentStatusCard title="x" isShell shellName="/opt/bin/nushell" />)

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

  test('renders compact context and cache metrics with the turn count', () => {
    render(
      <AgentStatusCard
        title="m"
        elapsed="2m"
        turns={12}
        contextPct={64}
        cacheHitPct={75}
      />
    )

    expect(screen.queryByText('schedule')).not.toBeInTheDocument()
    expect(screen.queryByText('2m')).not.toBeInTheDocument()
    expect(screen.queryByText('data_usage')).not.toBeInTheDocument()
    expect(screen.getByText('forum')).toBeInTheDocument()
    expect(screen.getByText('12 turns')).toBeInTheDocument()
    expect(screen.getByTestId('agent-card-budget-metrics')).toHaveTextContent(
      'ctx64%cache75%'
    )
  })

  test('omits compact budget metrics when no readings are available', () => {
    render(<AgentStatusCard title="m" turns={12} />)

    expect(screen.queryByTestId('agent-card-budget-metrics')).toBeNull()
  })

  test('renders 5-hour and weekly usage bars when provided', () => {
    render(<AgentStatusCard title="m" fiveHourPct={12} weekPct={34} />)

    expect(screen.getByText('5-hour Session')).toBeInTheDocument()
    expect(screen.getByText('12%')).toBeInTheDocument()
    expect(screen.getByText('Weekly Usage')).toBeInTheDocument()
    expect(screen.getByText('34%')).toBeInTheDocument()
  })

  test('keeps compact budget metrics out of the fixed quota body when both usage bars render', () => {
    render(
      <AgentStatusCard
        title="m"
        turns={12}
        contextPct={64}
        cacheHitPct={75}
        fiveHourPct={12}
        weekPct={34}
      />
    )

    const budgetMetrics = screen.getByTestId('agent-card-budget-metrics')
    const body = screen.getByTestId('agent-card-body')
    const rateLimits = screen.getByTestId('agent-card-rate-limits')

    expect(budgetMetrics).toHaveTextContent('ctx64%cache75%')
    expect(body).toHaveStyle({ height: '66px' })
    expect(body).toContainElement(rateLimits)
    expect(body).not.toContainElement(budgetMetrics)
    expect(rateLimits).toHaveTextContent('5-hour Session12%Weekly Usage34%')
  })

  test('omits the usage bars when both usages are null', () => {
    render(<AgentStatusCard title="m" fiveHourPct={null} weekPct={null} />)

    expect(screen.queryByText('5-hour Session')).not.toBeInTheDocument()
    expect(screen.queryByText('Weekly Usage')).not.toBeInTheDocument()
  })

  test('renders the kimi usage gate instead of the bars for a kimi pane', () => {
    render(<AgentStatusCard title="k2.7" isKimi fiveHourPct={0} weekPct={0} />)

    expect(screen.getByTestId('kimi-usage-gate')).toBeInTheDocument()
    expect(screen.queryByText('5-hour Session')).not.toBeInTheDocument()
  })

  test('renders the default bars (not the gate) for a non-kimi pane', () => {
    render(<AgentStatusCard title="claude" fiveHourPct={12} weekPct={34} />)

    expect(screen.queryByTestId('kimi-usage-gate')).not.toBeInTheDocument()
    expect(screen.getByText('5-hour Session')).toBeInTheDocument()
  })

  test('renders the quota-unavailable notice + feature-request link (not bars) when quotaNotice is set', () => {
    render(
      <AgentStatusCard
        title="deepseek-v4-pro"
        fiveHourPct={null}
        weekPct={null}
        quotaNotice={{
          message: 'Usage limits not exposed by OpenCode yet',
          trackUrl: 'https://github.com/sst/opencode/issues/16017',
          tooltipLabel:
            'OpenCode usage API — open the feature request (sst/opencode#16017)',
        }}
      />
    )

    expect(
      screen.getByText('Usage limits not exposed by OpenCode yet')
    ).toBeInTheDocument()

    expect(
      screen.getByRole('link', { name: /track the request/i })
    ).toHaveAttribute('href', 'https://github.com/sst/opencode/issues/16017')
    expect(screen.queryByText('5-hour Session')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kimi-usage-gate')).not.toBeInTheDocument()
  })

  test('renders zero turns in the header pill', () => {
    render(<AgentStatusCard title="m" elapsed="2m" turns={0} contextPct={64} />)

    expect(screen.getByText('forum')).toBeInTheDocument()
    expect(screen.getByText('0 turns')).toBeInTheDocument()
    expect(screen.queryByText('schedule')).not.toBeInTheDocument()
    expect(screen.queryByText('data_usage')).not.toBeInTheDocument()
  })

  test('keeps a stable height and caps responsive width across agent and shell states', () => {
    const { rerender } = render(
      <AgentStatusCard title="m" turns={3} fiveHourPct={12} weekPct={34} />
    )

    const card = screen.getByTestId('sidebar-agent-status-card')
    expect(card).toHaveStyle({
      width: '100%',
      maxWidth: '360px',
      height: '125px',
    })

    rerender(<AgentStatusCard title="ignored" isShell shellName="bash" />)

    expect(screen.getByTestId('sidebar-agent-status-card')).toHaveStyle({
      width: '100%',
      maxWidth: '360px',
      height: '125px',
    })
  })
})
