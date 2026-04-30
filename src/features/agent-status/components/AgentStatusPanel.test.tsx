import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentStatusPanel } from './AgentStatusPanel'
import type { AgentStatus } from '../types'

const defaultStatus: AgentStatus = {
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
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
  testRun: null,
}

const defaultGitStatus = {
  files: [],
  filesCwd: '/test',
  loading: false,
  error: null,
  refresh: vi.fn(),
  idle: false,
}

vi.mock('../hooks/useAgentStatus', () => ({
  useAgentStatus: vi.fn(() => defaultStatus),
}))

vi.mock('../../diff/hooks/useGitStatus', () => ({
  useGitStatus: vi.fn(() => defaultGitStatus),
}))

const defaultProps = {
  sessionId: null as string | null,
  cwd: '/test',
  onOpenDiff: vi.fn(),
}

describe('AgentStatusPanel', () => {
  test('renders at 0px width when agent is not active', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      ...defaultStatus,
      isActive: false,
    })

    render(<AgentStatusPanel {...defaultProps} sessionId={null} />)

    const panel = screen.getByTestId('agent-status-panel')
    expect(panel.style.width).toBe('0px')
  })

  test('renders at 280px width when agent is active', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      ...defaultStatus,
      isActive: true,
      agentType: 'claude-code',
      sessionId: 'session-1',
    })

    render(<AgentStatusPanel {...defaultProps} sessionId="session-1" />)

    const panel = screen.getByTestId('agent-status-panel')
    expect(panel.style.width).toBe('280px')
  })

  test('applies ease-out transition when collapsing', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      ...defaultStatus,
      isActive: false,
    })

    render(<AgentStatusPanel {...defaultProps} sessionId={null} />)

    const panel = screen.getByTestId('agent-status-panel')
    expect(panel.style.transition).toBe('width 200ms ease-out')
  })

  test('applies ease-in transition when expanding', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      ...defaultStatus,
      isActive: true,
      agentType: 'claude-code',
      sessionId: 'session-1',
    })

    render(<AgentStatusPanel {...defaultProps} sessionId="session-1" />)

    const panel = screen.getByTestId('agent-status-panel')
    expect(panel.style.transition).toBe('width 200ms ease-in')
  })

  test('has overflow-hidden to clip content during collapse', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue(defaultStatus)

    render(<AgentStatusPanel {...defaultProps} sessionId={null} />)

    const panel = screen.getByTestId('agent-status-panel')
    expect(panel).toHaveClass('overflow-hidden')
  })

  test('passes sessionId to useAgentStatus', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue(defaultStatus)

    render(<AgentStatusPanel {...defaultProps} sessionId="session-42" />)

    expect(useAgentStatus).toHaveBeenCalledWith('session-42')
  })

  test('renders ToolCallSummary and ActivityFeed inside the scrollable region', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      ...defaultStatus,
      isActive: true,
      agentType: 'claude-code',
      sessionId: 'session-1',
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
    })

    render(<AgentStatusPanel {...defaultProps} sessionId="session-1" />)

    const toolCallsHeader = screen.getByRole('button', { name: /tool calls/i })
    const activityHeader = screen.getByRole('button', { name: /activity/i })

    // Current order: ToolCallSummary header appears before the ActivityFeed
    // header. Both are now CollapsibleSection buttons so they share the same
    // visual rhythm as FilesChanged and Tests below.
    expect(toolCallsHeader.compareDocumentPosition(activityHeader)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  test('scrollable content area uses the thin-scrollbar convention', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      ...defaultStatus,
      isActive: true,
      agentType: 'claude-code',
      sessionId: 'session-1',
    })

    const { container } = render(
      <AgentStatusPanel {...defaultProps} sessionId="session-1" />
    )

    // The scroll region wraps ActivityFeed + ToolCallSummary + FilesChanged +
    // TestResults so the lower sections remain reachable when the ActivityFeed
    // grows. Must use thin-scrollbar per rules convention (see
    // src/features/editor/components/ExplorerPane.tsx:74).
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const scrollableDiv = container.querySelector('.overflow-y-auto')
    expect(scrollableDiv).toHaveClass('thin-scrollbar')
  })

  test('keeps ToolCallSummary consumer mounted alongside the ActivityFeed', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      ...defaultStatus,
      isActive: true,
      agentType: 'claude-code',
      sessionId: 'session-1',
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
    })

    render(<AgentStatusPanel {...defaultProps} sessionId="session-1" />)

    // ToolCallSummary: renders the byType chip label "Edit".
    expect(screen.getAllByText('Edit').length).toBeGreaterThan(0)
    // ActivityFeed: collapsible header exists.
    expect(
      screen.getByRole('button', { name: /activity/i })
    ).toBeInTheDocument()
  })

  test('renders TokenCache populated with the canonical hit rate', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      ...defaultStatus,
      isActive: true,
      agentType: 'claude-code',
      sessionId: 'session-1',
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
    })

    render(<AgentStatusPanel {...defaultProps} sessionId="session-1" />)

    const percent = screen.getByTestId('token-cache-percent')
    expect(percent).toHaveTextContent('75%')
  })

  test('renders TokenCache empty state when currentUsage is null', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      ...defaultStatus,
      isActive: true,
      agentType: 'claude-code',
      sessionId: 'session-1',
      contextWindow: null,
    })

    render(<AgentStatusPanel {...defaultProps} sessionId="session-1" />)

    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  test('mounts TokenCache between ContextBucket and the scrollable region', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      ...defaultStatus,
      isActive: true,
      agentType: 'claude-code',
      sessionId: 'session-1',
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
    })

    render(<AgentStatusPanel {...defaultProps} sessionId="session-1" />)

    const panel = screen.getByTestId('agent-status-panel')
    const tokenCache = screen.getByTestId('token-cache')

    // DOM-order requirements from the design spec:
    //   StatusCard → ContextBucket → TokenCache  (static top region, in this order)
    //                                ↓
    //                         scrollable region

    /* eslint-disable testing-library/no-node-access */
    const scrollable = panel.querySelector('.thin-scrollbar')

    // 1. TokenCache must be the LAST child of the static top region
    //    (i.e., it follows StatusCard and ContextBucket, never precedes them).
    const staticTop = panel.firstElementChild
    expect(staticTop).not.toBeNull()
    expect(staticTop?.lastElementChild).toBe(tokenCache)

    // 2. TokenCache must precede the scrollable region in document order.
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
