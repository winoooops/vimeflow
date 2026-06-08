import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { AgentStatus } from '../../agent-status/types'
import { SidebarStatusHeader } from './SidebarStatusHeader'

const inactiveStatus: AgentStatus = {
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

const activeStatus: AgentStatus = {
  ...inactiveStatus,
  isActive: true,
  agentExited: false,
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
    expect(screen.getByTestId('agent-status-card')).toHaveAttribute(
      'data-agent-state',
      'active'
    )
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

    expect(screen.getByTestId('agent-status-card')).toBeInTheDocument()
    expect(screen.getByTestId('agent-status-card')).toHaveAttribute(
      'data-agent-state',
      'idle'
    )
    expect(screen.getByText('my session')).toBeInTheDocument()
    expect(screen.getByText('Idle')).toBeInTheDocument()
  })

  test('keeps the idle state at the live card height', () => {
    render(
      <SidebarStatusHeader
        status={inactiveStatus}
        activeSessionName="my session"
      />
    )

    expect(screen.getByTestId('agent-status-card')).toHaveClass('min-h-44')
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

    expect(screen.getByTestId('agent-status-card')).toBeInTheDocument()
    expect(screen.getByText('my session')).toBeInTheDocument()
  })

  test('keeps the status card DOM node through agent switch idle gap', () => {
    const { rerender } = render(
      <SidebarStatusHeader
        status={activeStatus}
        activeSessionName="claude session"
      />
    )

    const card = screen.getByTestId('agent-status-card')
    expect(screen.getByText('Claude Code')).toBeInTheDocument()

    rerender(
      <SidebarStatusHeader
        status={inactiveStatus}
        activeSessionName="switching session"
      />
    )

    expect(screen.getByTestId('agent-status-card')).toBe(card)
    expect(screen.getByTestId('agent-status-card')).toHaveAttribute(
      'data-agent-state',
      'idle'
    )
    expect(screen.getByText('switching session')).toBeInTheDocument()
    expect(screen.getByText('Idle')).toBeInTheDocument()

    rerender(
      <SidebarStatusHeader
        status={{
          ...activeStatus,
          agentType: 'codex',
          modelId: 'gpt-5.4',
          modelDisplayName: 'GPT-5.4',
          sessionId: 'session-2',
        }}
        activeSessionName="codex session"
      />
    )

    expect(screen.getByTestId('agent-status-card')).toBe(card)
    expect(screen.getByTestId('agent-status-card')).toHaveAttribute(
      'data-agent-state',
      'active'
    )
    expect(screen.getByText('Codex')).toBeInTheDocument()
    expect(screen.getByText('GPT-5.4')).toBeInTheDocument()
  })
})
