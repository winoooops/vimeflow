import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentStatusPanel } from './AgentStatusPanel'
import type { AgentStatus } from '../types'

const inactiveAgentStatus: AgentStatus = {
  isActive: false,
  agentType: null,
  modelId: null,
  modelDisplayName: null,
  version: null,
  sessionId: null,
  agentSessionId: null,
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

vi.mock('../../diff/hooks/useGitStatus', () => ({
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
}

describe('AgentStatusPanel', () => {
  test('renders at 0px width when agent is not active', () => {
    render(
      <AgentStatusPanel {...defaultProps} agentStatus={inactiveAgentStatus} />
    )
    const panel = screen.getByTestId('agent-status-panel')
    expect(panel.style.width).toBe('0px')
  })

  test('renders at 280px width when agent is active', () => {
    render(
      <AgentStatusPanel {...defaultProps} agentStatus={activeAgentStatus} />
    )
    const panel = screen.getByTestId('agent-status-panel')
    expect(panel.style.width).toBe('280px')
  })

  test('applies ease-out transition when collapsing', () => {
    render(
      <AgentStatusPanel {...defaultProps} agentStatus={inactiveAgentStatus} />
    )
    const panel = screen.getByTestId('agent-status-panel')
    expect(panel.style.transition).toBe('width 200ms ease-out')
  })

  test('applies ease-in transition when expanding', () => {
    render(
      <AgentStatusPanel {...defaultProps} agentStatus={activeAgentStatus} />
    )
    const panel = screen.getByTestId('agent-status-panel')
    expect(panel.style.transition).toBe('width 200ms ease-in')
  })

  test('has overflow-hidden to clip content during collapse', () => {
    render(
      <AgentStatusPanel {...defaultProps} agentStatus={inactiveAgentStatus} />
    )
    const panel = screen.getByTestId('agent-status-panel')
    expect(panel).toHaveClass('overflow-hidden')
  })

  test('does not render StatusCard inside the panel', () => {
    render(
      <AgentStatusPanel
        agentStatus={activeAgentStatus}
        cwd="/tmp/repo"
        onOpenDiff={vi.fn()}
      />
    )

    expect(screen.queryByTestId('agent-status-card')).not.toBeInTheDocument()
  })

  test('footer renders aggregated git-diff line totals', () => {
    render(
      <AgentStatusPanel
        agentStatus={activeAgentStatus}
        cwd="/tmp/repo"
        onOpenDiff={vi.fn()}
      />
    )

    // From the useGitStatus mock above: 5+7 added, 2+1 removed.
    expect(screen.getByText('4 turns')).toBeInTheDocument()
    expect(screen.getByText('+12 / -3')).toBeInTheDocument()
  })

  test('uses shared git status when provided by the parent', () => {
    render(
      <AgentStatusPanel
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

    expect(screen.getAllByText('+20 / -4')).toHaveLength(2)
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
    const activityHeader = screen.getByRole('button', { name: /activity/i })

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
      screen.getByRole('button', { name: /activity/i })
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
    expect(percent).toHaveTextContent('75%')
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

    /* eslint-disable testing-library/no-node-access */
    const scrollable = panel.querySelector('.thin-scrollbar')

    const staticTop = panel.firstElementChild
    expect(staticTop).not.toBeNull()
    expect(staticTop?.lastElementChild).toBe(tokenCache)

    expect(scrollable).not.toBeNull()

    const positionRelativeToScrollable = tokenCache.compareDocumentPosition(
      scrollable as Node
    )
    /* eslint-enable testing-library/no-node-access */

    expect(
      positionRelativeToScrollable & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
