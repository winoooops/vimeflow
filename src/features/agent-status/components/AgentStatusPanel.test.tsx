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
})
