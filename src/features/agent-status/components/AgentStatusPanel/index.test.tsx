import { describe, test, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AGENTS } from '../../../../agents/registry'
import type { AgentStatus } from '../../types'
import * as useGitStatusModule from '../../../diff/hooks/useGitStatus'
import { AgentStatusPanel } from '.'

const inactiveAgentStatus: AgentStatus = {
  isActive: false,
  agentExited: false,
  agentType: null,
  modelId: null,
  modelDisplayName: null,
  version: null,
  sessionId: null,
  agentSessionId: null,
  cwd: null,
  contextWindow: null,
  cost: null,
  rateLimits: null,
  numTurns: 0,
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
  testRun: null,
}

const activeAgentStatus: AgentStatus = {
  ...inactiveAgentStatus,
  isActive: true,
  agentExited: false,
  agentType: 'claude-code',
  modelId: 'claude-3-5-sonnet-20241022',
  modelDisplayName: 'Claude 3.5 Sonnet',
  sessionId: 'sess-1',
  numTurns: 4,
  contextWindow: {
    usedPercentage: 12,
    contextWindowSize: 200_000,
    totalInputTokens: 1_234,
    totalOutputTokens: 567,
    currentUsage: null,
  },
  cost: {
    totalCostUsd: 0.05,
    totalDurationMs: 60_000,
    totalApiDurationMs: 30_000,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
  },
}

vi.mock('../../../diff/hooks/useGitStatus', () => ({
  useGitStatus: (): {
    files: {
      path: string
      status: string
      insertions: number
      deletions: number
      staged: boolean
    }[]
    filesCwd: string
    loading: boolean
    error: null
    refresh: () => void
    idle: boolean
  } => ({
    files: [
      {
        path: 'a.ts',
        status: 'modified',
        insertions: 5,
        deletions: 2,
        staged: false,
      },
      {
        path: 'b.ts',
        status: 'modified',
        insertions: 7,
        deletions: 1,
        staged: false,
      },
    ],
    filesCwd: '/tmp/repo',
    loading: false,
    error: null,
    refresh: vi.fn(),
    idle: false,
  }),
}))

const defaultProps = {
  cwd: '/test',
  onOpenDiff: vi.fn(),
  agent: AGENTS.shell,
  status: 'paused' as const,
  onCollapse: (): void => undefined,
  cacheHistory: [],
}

describe('AgentStatusPanel', () => {
  test('renders at 280px width when agent is not active', () => {
    render(
      <AgentStatusPanel {...defaultProps} agentStatus={inactiveAgentStatus} />
    )
    const panel = screen.getByTestId('agent-status-panel')
    expect(panel.style.width).toBe('280px')
  })

  test('renders at 280px width when agent is active', () => {
    render(
      <AgentStatusPanel {...defaultProps} agentStatus={activeAgentStatus} />
    )
    const panel = screen.getByTestId('agent-status-panel')
    expect(panel.style.width).toBe('280px')
  })

  test('keeps inactive context and cache placeholders mounted', () => {
    render(
      <AgentStatusPanel {...defaultProps} agentStatus={inactiveAgentStatus} />
    )

    expect(screen.getByText(/CURRENT CONTEXT/)).toBeInTheDocument()
    expect(screen.getByTestId('context-percentage')).toHaveTextContent('\u2014')
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
    expect(screen.getByText(/No activity yet/i)).toBeInTheDocument()
  })

  test('has overflow-hidden to clip content inside the fixed panel', () => {
    render(
      <AgentStatusPanel {...defaultProps} agentStatus={inactiveAgentStatus} />
    )
    const panel = screen.getByTestId('agent-status-panel')
    expect(panel).toHaveClass('overflow-hidden')
  })

  test('does not render StatusCard inside the panel', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={activeAgentStatus}
        cwd="/tmp/repo"
        onOpenDiff={vi.fn()}
      />
    )

    expect(screen.queryByTestId('agent-status-card')).not.toBeInTheDocument()
  })

  test('does not render the deprecated bottom metrics strip', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={activeAgentStatus}
        cwd="/tmp/repo"
        onOpenDiff={vi.fn()}
      />
    )

    expect(screen.queryByText('4 turns')).not.toBeInTheDocument()
    expect(screen.queryByText('1m')).not.toBeInTheDocument()
    expect(screen.queryByText('+12 / -3')).not.toBeInTheDocument()
  })

  test('uses shared git status when provided by the parent', () => {
    // Spy on the internal hook so we can assert it was called with
    // `enabled: false` — the load-bearing invariant of the lifted-state
    // refactor (parent-provided gitStatus must disable the child's
    // own watcher to prevent duplicate `start_git_watcher` IPCs).
    // The module-level `vi.mock` factory above can't satisfy this
    // assertion because it is not a `vi.fn()` — vi.spyOn here gives
    // us a proper call-args record while still falling through to the
    // module mock for the actual return shape.
    const useGitStatusSpy = vi.spyOn(useGitStatusModule, 'useGitStatus')

    try {
      render(
        <AgentStatusPanel
          {...defaultProps}
          agentStatus={activeAgentStatus}
          cwd="/tmp/repo"
          onOpenDiff={vi.fn()}
          gitStatus={{
            files: [
              {
                path: 'shared.ts',
                status: 'modified',
                insertions: 20,
                deletions: 4,
                staged: false,
              },
            ],
            filesCwd: '/tmp/repo',
            loading: false,
            error: null,
            refresh: vi.fn(),
            idle: false,
          }}
        />
      )

      expect(screen.getByText('+20 / -4')).toBeInTheDocument()
      // Watcher-deduplication invariant: when parent injects gitStatus,
      // the internal hook must run with enabled: false so no duplicate
      // start_git_watcher IPC fires.
      expect(useGitStatusSpy).toHaveBeenCalledWith(
        '/tmp/repo',
        expect.objectContaining({ enabled: false })
      )
    } finally {
      // Guarantee spy cleanup even if render() or any expect() above
      // throws — without this guard, an inline spy leaks past the
      // failing test and inflates call counts on every subsequent
      // test that consumes the same module export.
      useGitStatusSpy.mockRestore()
    }
  })

  test('renders ToolCallSummary and ActivityFeed inside the scrollable region', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={{
          ...activeAgentStatus,
          toolCalls: {
            total: 1,
            byType: { Edit: 1 },
            active: null,
          },
          recentToolCalls: [
            {
              id: 'r-1',
              tool: 'Edit',
              args: 'src/foo.ts',
              status: 'done',
              durationMs: 100,
              timestamp: '2026-04-22T11:59:42Z',
              isTestFile: false,
            },
          ],
        }}
      />
    )

    const toolCallsHeader = screen.getByRole('button', { name: /tool calls/i })

    const activityHeader = screen.getByRole('button', {
      name: /activity\s*1/i,
    })

    expect(toolCallsHeader.compareDocumentPosition(activityHeader)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  test('scrollable content area uses the thin-scrollbar convention', () => {
    const { container } = render(
      <AgentStatusPanel {...defaultProps} agentStatus={activeAgentStatus} />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const scrollableDiv = container.querySelector('.overflow-y-auto')
    expect(scrollableDiv).toHaveClass('thin-scrollbar')
    expect(scrollableDiv).toHaveClass('overflow-x-clip')
    expect(scrollableDiv).toHaveClass('min-h-0')
  })

  test('keeps ToolCallSummary consumer mounted alongside the ActivityFeed', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={{
          ...activeAgentStatus,
          toolCalls: {
            total: 1,
            byType: { Edit: 1 },
            active: null,
          },
          recentToolCalls: [
            {
              id: 'r-1',
              tool: 'Edit',
              args: 'src/foo.ts',
              status: 'done',
              durationMs: 100,
              timestamp: '2026-04-22T11:59:42Z',
              isTestFile: false,
            },
          ],
        }}
      />
    )

    expect(screen.getAllByText('Edit').length).toBeGreaterThan(0)
    expect(
      screen.getByRole('button', { name: /activity\s*1/i })
    ).toBeInTheDocument()
  })

  test('renders TokenCache populated with the canonical hit rate', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={{
          ...activeAgentStatus,
          contextWindow: {
            usedPercentage: 10,
            contextWindowSize: 200000,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            currentUsage: {
              inputTokens: 700,
              outputTokens: 0,
              cacheCreationInputTokens: 1800,
              cacheReadInputTokens: 7500,
            },
          },
        }}
      />
    )

    const percent = screen.getByTestId('token-cache-percent')
    expect(percent).toHaveTextContent('75')
  })

  test('renders TokenCache empty state when currentUsage is null', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={{
          ...activeAgentStatus,
          contextWindow: null,
        }}
      />
    )

    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  test('mounts TokenCache between ContextBucket and the scrollable region', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        cacheHistory={[42, 75]}
        agentStatus={{
          ...activeAgentStatus,
          contextWindow: {
            usedPercentage: 10,
            contextWindowSize: 200000,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            currentUsage: {
              inputTokens: 700,
              outputTokens: 0,
              cacheCreationInputTokens: 1800,
              cacheReadInputTokens: 7500,
            },
          },
        }}
      />
    )

    const panel = screen.getByTestId('agent-status-panel')
    const tokenCache = screen.getByTestId('token-cache')
    const context = screen.getByText(/CURRENT CONTEXT/)

    /* eslint-disable testing-library/no-node-access */
    const scrollable = panel.querySelector('.thin-scrollbar')
    expect(scrollable).not.toBeNull()

    expect(
      context.compareDocumentPosition(tokenCache) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    expect(
      tokenCache.compareDocumentPosition(scrollable as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    /* eslint-enable testing-library/no-node-access */

    // Sparkline renders when history is present.
    expect(screen.getByTestId('token-cache-sparkline')).toBeInTheDocument()
  })

  test('renders Header above the body with the provided agent status and onCollapse', async () => {
    const onCollapse = vi.fn()
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={inactiveAgentStatus}
        cwd="/home/x"
        agent={AGENTS.claude}
        status="paused"
        onCollapse={onCollapse}
      />
    )

    const header = screen.getByTestId('agent-status-panel-header')
    const body = screen.getByTestId('token-cache')
    expect(
      header.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    await userEvent.click(
      screen.getByRole('button', { name: /collapse activity panel/i })
    )
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })
})

describe('AgentStatusPanel — live action card', () => {
  const runningEditStatus: AgentStatus = {
    ...activeAgentStatus,
    cwd: '/tmp/repo',
    toolCalls: {
      total: 1,
      byType: { Edit: 1 },
      active: {
        tool: 'Edit',
        args: 'a.ts',
        startedAt: '2026-04-22T11:59:42Z',
        toolUseId: 'live-1',
      },
    },
    recentToolCalls: [],
  }

  test('renders the NOW live-action card while a tool call is active', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        agentStatus={runningEditStatus}
      />
    )

    expect(screen.getByText('NOW')).toBeInTheDocument()
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  test('omits the live card when no tool call is active', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        agentStatus={activeAgentStatus}
      />
    )

    expect(screen.queryByText('NOW')).not.toBeInTheDocument()
    expect(screen.queryByTestId('live-action-card')).not.toBeInTheDocument()
  })

  test('does not also list the running action in the activity feed', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        agentStatus={{
          ...runningEditStatus,
          recentToolCalls: [
            {
              id: 'r-1',
              tool: 'Read',
              args: 'b.ts',
              status: 'done',
              durationMs: 100,
              timestamp: '2026-04-22T11:59:00Z',
              isTestFile: false,
            },
          ],
        }}
      />
    )

    // 1 active + 1 recent: the active row is promoted to the NOW card, so the
    // feed lists only the single recent event (count 1, not 2).
    expect(
      screen.getByRole('button', { name: /activity\s*1/i })
    ).toBeInTheDocument()
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  test('shows the real git diff counts on the live card', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        agentStatus={runningEditStatus}
      />
    )

    const card = screen.getByTestId('live-action-card')
    expect(within(card).getByText('+5')).toBeInTheDocument()
    expect(within(card).getByText('−2')).toBeInTheDocument()
  })

  test('clicking the live card opens the running file diff in the dock', async () => {
    const onOpenDiff = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        onOpenDiff={onOpenDiff}
        agentStatus={runningEditStatus}
      />
    )

    await user.click(screen.getByTestId('live-action-card'))

    expect(onOpenDiff).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a.ts' })
    )
  })

  test('matches by absolute tool path and opens the repo-relative diff', async () => {
    const onOpenDiff = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        onOpenDiff={onOpenDiff}
        agentStatus={{
          ...runningEditStatus,
          toolCalls: {
            total: 1,
            byType: { Edit: 1 },
            active: {
              tool: 'Edit',
              args: '/tmp/repo/a.ts',
              startedAt: '2026-04-22T11:59:42Z',
              toolUseId: 'live-abs',
            },
          },
        }}
      />
    )

    const card = screen.getByTestId('live-action-card')
    // diff counts resolve from git status despite the absolute tool path
    expect(within(card).getByText('+5')).toBeInTheDocument()

    await user.click(card)
    // opened with the repo-relative path the diff viewer requires, not absolute
    expect(onOpenDiff).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a.ts' })
    )
  })
})
