import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import StatusCard from './StatusCard'
import type { Session } from '../../types'

describe('StatusCard', () => {
  const mockSession: Session = {
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'auth middleware',
    status: 'running',
    workingDirectory: '/home/user/vimeflow',
    agentType: 'claude-code',
    currentAction: 'Creating auth middleware...',
    createdAt: '2026-04-07T03:45:00Z',
    lastActivityAt: '2026-04-07T03:47:30Z',
    activity: {
      fileChanges: [],
      toolCalls: [],
      testResults: [],
      contextWindow: {
        used: 75000,
        total: 200000,
        percentage: 37,
        emoji: '😊',
      },
      usage: {
        sessionDuration: 154,
        turnCount: 12,
        messages: { sent: 142, limit: 200 },
        tokens: { input: 45000, output: 30000, total: 75000 },
      },
    },
  }

  test('renders agent name correctly', () => {
    render(<StatusCard session={mockSession} />)

    expect(screen.getByText('Claude Code')).toBeInTheDocument()
  })

  test('renders status badge for running session', () => {
    render(<StatusCard session={mockSession} />)

    expect(screen.getByText('● running')).toBeInTheDocument()
  })

  test('renders current action description', () => {
    render(<StatusCard session={mockSession} />)

    expect(screen.getByText('Creating auth middleware...')).toBeInTheDocument()
  })

  test('renders status badge for paused session', () => {
    const pausedSession: Session = {
      ...mockSession,
      status: 'paused',
    }

    render(<StatusCard session={pausedSession} />)

    expect(screen.getByText('⏸ paused')).toBeInTheDocument()
  })

  test('renders status badge for completed session', () => {
    const completedSession: Session = {
      ...mockSession,
      status: 'completed',
    }

    render(<StatusCard session={completedSession} />)

    expect(screen.getByText('○ completed')).toBeInTheDocument()
  })

  test('renders status badge for errored session', () => {
    const erroredSession: Session = {
      ...mockSession,
      status: 'errored',
    }

    render(<StatusCard session={erroredSession} />)

    expect(screen.getByText('✗ errored')).toBeInTheDocument()
  })

  test('applies correct background color using design token', () => {
    render(<StatusCard session={mockSession} />)

    const card = screen.getByTestId('status-card')

    expect(card).toHaveClass('bg-surface-container-high')
  })

  test('applies correct border radius (8px = rounded-lg)', () => {
    render(<StatusCard session={mockSession} />)

    const card = screen.getByTestId('status-card')

    expect(card).toHaveClass('rounded-lg')
  })

  test('applies correct padding for card spacing', () => {
    render(<StatusCard session={mockSession} />)

    const card = screen.getByTestId('status-card')

    expect(card).toHaveClass('p-3')
  })

  test('displays different agent names based on agentType', () => {
    const codexSession: Session = {
      ...mockSession,
      agentType: 'codex',
    }

    render(<StatusCard session={codexSession} />)

    expect(screen.getByText('Codex')).toBeInTheDocument()
  })

  test('displays agent name for aider type', () => {
    const aiderSession: Session = {
      ...mockSession,
      agentType: 'aider',
    }

    render(<StatusCard session={aiderSession} />)

    expect(screen.getByText('Aider')).toBeInTheDocument()
  })

  test('displays agent name for generic type', () => {
    const genericSession: Session = {
      ...mockSession,
      agentType: 'generic',
    }

    render(<StatusCard session={genericSession} />)

    expect(screen.getByText('Agent')).toBeInTheDocument()
  })

  test('renders placeholder text when no current action', () => {
    const sessionWithoutAction: Session = {
      ...mockSession,
      currentAction: undefined,
    }

    render(<StatusCard session={sessionWithoutAction} />)

    expect(screen.getByText('Idle')).toBeInTheDocument()
  })

  test('status badge uses correct color for running status', () => {
    render(<StatusCard session={mockSession} />)

    const badge = screen.getByText('● running')

    expect(badge).toHaveClass('text-success')
  })

  test('status badge uses correct color for paused status', () => {
    const pausedSession: Session = {
      ...mockSession,
      status: 'paused',
    }

    render(<StatusCard session={pausedSession} />)

    const badge = screen.getByText('⏸ paused')

    expect(badge).toHaveClass('text-secondary')
  })

  test('status badge uses correct color for completed status', () => {
    const completedSession: Session = {
      ...mockSession,
      status: 'completed',
    }

    render(<StatusCard session={completedSession} />)

    const badge = screen.getByText('○ completed')

    expect(badge).toHaveClass('text-on-surface')
  })

  test('status badge uses correct color for errored status', () => {
    const erroredSession: Session = {
      ...mockSession,
      status: 'errored',
    }

    render(<StatusCard session={erroredSession} />)

    const badge = screen.getByText('✗ errored')

    expect(badge).toHaveClass('text-error')
  })

  test('current action text uses muted color', () => {
    render(<StatusCard session={mockSession} />)

    const actionText = screen.getByText('Creating auth middleware...')

    expect(actionText).toHaveClass('text-on-surface')
  })

  test('applies correct layout structure with flex column', () => {
    render(<StatusCard session={mockSession} />)

    const card = screen.getByTestId('status-card')

    expect(card).toHaveClass('flex')
    expect(card).toHaveClass('flex-col')
  })

  test('applies correct gap between elements', () => {
    render(<StatusCard session={mockSession} />)

    const card = screen.getByTestId('status-card')

    expect(card).toHaveClass('gap-2')
  })
})
