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
}

vi.mock('../hooks/useAgentStatus', () => ({
  useAgentStatus: vi.fn(() => defaultStatus),
}))

describe('AgentStatusPanel', () => {
  test('renders at 0px width when agent is not active', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      ...defaultStatus,
      isActive: false,
    })

    render(<AgentStatusPanel sessionId={null} />)

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

    render(<AgentStatusPanel sessionId="session-1" />)

    const panel = screen.getByTestId('agent-status-panel')
    expect(panel.style.width).toBe('280px')
  })

  test('applies ease-out transition when collapsing', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      ...defaultStatus,
      isActive: false,
    })

    render(<AgentStatusPanel sessionId={null} />)

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

    render(<AgentStatusPanel sessionId="session-1" />)

    const panel = screen.getByTestId('agent-status-panel')
    expect(panel.style.transition).toBe('width 200ms ease-in')
  })

  test('has overflow-hidden to clip content during collapse', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue(defaultStatus)

    render(<AgentStatusPanel sessionId={null} />)

    const panel = screen.getByTestId('agent-status-panel')
    expect(panel).toHaveClass('overflow-hidden')
  })

  test('passes sessionId to useAgentStatus', async () => {
    const { useAgentStatus } = await import('../hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue(defaultStatus)

    render(<AgentStatusPanel sessionId="session-42" />)

    expect(useAgentStatus).toHaveBeenCalledWith('session-42')
  })

  test('renders ActivityFeed between ContextBucket and ToolCallSummary', async () => {
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
        },
      ],
    })

    render(<AgentStatusPanel sessionId="session-1" />)

    const activityHeader = screen.getByRole('button', { name: /activity/i })
    const toolCallsHeader = screen.getByText(/tool calls/i)

    // ActivityFeed's Activity header appears before the ToolCallSummary's
    // "Tool Calls" header in DOM order.
    expect(activityHeader.compareDocumentPosition(toolCallsHeader)).toBe(
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

    const { container } = render(<AgentStatusPanel sessionId="session-1" />)

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
        },
      ],
    })

    render(<AgentStatusPanel sessionId="session-1" />)

    // ToolCallSummary: renders the byType chip label "Edit".
    expect(screen.getAllByText('Edit').length).toBeGreaterThan(0)
    // ActivityFeed: collapsible header exists.
    expect(
      screen.getByRole('button', { name: /activity/i })
    ).toBeInTheDocument()
  })
})
