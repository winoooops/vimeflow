import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { AgentStatus } from '../../agent-status/types'
import { SidebarStatusHeader } from './SidebarStatusHeader'

const inactiveStatus: AgentStatus = {
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

const activeStatus: AgentStatus = {
  ...inactiveStatus,
  isActive: true,
  agentType: 'claude-code',
  modelId: 'claude-3-5-sonnet-20241022',
  modelDisplayName: 'Claude 3.5 Sonnet',
  sessionId: 'session-1',
  contextWindow: {
    usedPercentage: 12,
    contextWindowSize: 200_000,
    totalInputTokens: 1_234,
    totalOutputTokens: 567,
    currentUsage: null,
  },
}

describe('SidebarStatusHeader', () => {
  test('renders the live StatusCard when an agent is active', () => {
    render(
      <SidebarStatusHeader
        status={activeStatus}
        activeSessionName="my session"
      />
    )

    expect(screen.getByTestId('agent-status-card')).toBeInTheDocument()
    expect(screen.getByText('Claude Code')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  test('renders the idle placeholder with the active session name', () => {
    render(
      <SidebarStatusHeader
        status={inactiveStatus}
        activeSessionName="my session"
      />
    )

    expect(screen.queryByTestId('agent-status-card')).not.toBeInTheDocument()
    expect(screen.getByText('my session')).toBeInTheDocument()
    expect(screen.getByText('Idle')).toBeInTheDocument()
  })

  test('falls back to "No session" when there is no active session', () => {
    render(
      <SidebarStatusHeader status={inactiveStatus} activeSessionName={null} />
    )

    expect(screen.getByText('No session')).toBeInTheDocument()
    expect(screen.getByText('Idle')).toBeInTheDocument()
  })

  test('treats agent-detected-but-no-agentType as idle', () => {
    render(
      <SidebarStatusHeader
        status={{ ...inactiveStatus, isActive: true, agentType: null }}
        activeSessionName="my session"
      />
    )

    expect(screen.queryByTestId('agent-status-card')).not.toBeInTheDocument()
    expect(screen.getByText('my session')).toBeInTheDocument()
  })
})
