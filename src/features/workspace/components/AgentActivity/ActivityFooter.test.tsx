import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ActivityFooter from './ActivityFooter'
import type { AgentActivity } from '../../types'

describe('ActivityFooter', () => {
  const mockActivity: AgentActivity = {
    fileChanges: [
      {
        id: 'fc-1',
        path: 'src/auth/middleware.ts',
        type: 'new',
        linesAdded: 48,
        linesRemoved: 0,
        timestamp: '2026-04-07T03:46:15Z',
      },
      {
        id: 'fc-2',
        path: 'src/auth/types.ts',
        type: 'modified',
        linesAdded: 12,
        linesRemoved: 3,
        timestamp: '2026-04-07T03:47:02Z',
      },
      {
        id: 'fc-3',
        path: 'src/routes/auth.ts',
        type: 'modified',
        linesAdded: 5,
        linesRemoved: 1,
        timestamp: '2026-04-07T03:47:28Z',
      },
    ],
    toolCalls: [],
    testResults: [],
    contextWindow: {
      used: 75000,
      total: 200000,
      percentage: 37,
      emoji: '😊',
    },
    usage: {
      sessionDuration: 154, // 2m 34s
      turnCount: 12,
      messages: { sent: 142, limit: 200 },
      tokens: { input: 45000, output: 30000, total: 75000 },
      cost: { amount: 0.45, currency: 'USD' },
    },
  }

  test('renders session duration formatted correctly', () => {
    render(<ActivityFooter activity={mockActivity} />)

    expect(screen.getByText(/2m 34s/)).toBeInTheDocument()
  })

  test('renders session duration with hours when duration >= 3600s', () => {
    const longActivity: AgentActivity = {
      ...mockActivity,
      usage: {
        ...mockActivity.usage,
        sessionDuration: 3661, // 1h 1m 1s
      },
    }

    render(<ActivityFooter activity={longActivity} />)

    expect(screen.getByText(/1h 1m 1s/)).toBeInTheDocument()
  })

  test('renders turn count', () => {
    render(<ActivityFooter activity={mockActivity} />)

    expect(screen.getByText(/12 turns/)).toBeInTheDocument()
  })

  test('renders lines added and removed summary', () => {
    render(<ActivityFooter activity={mockActivity} />)

    // 48 + 12 + 5 = 65 lines added
    // 0 + 3 + 1 = 4 lines removed
    expect(screen.getByText(/\+65 -4/)).toBeInTheDocument()
  })

  test('renders all three metrics separated by bullets', () => {
    render(<ActivityFooter activity={mockActivity} />)

    const footer = screen.getByRole('contentinfo')
    expect(footer.textContent).toMatch(/2m 34s.*12 turns.*\+65 -4/)
  })

  test('applies muted text styling', () => {
    render(<ActivityFooter activity={mockActivity} />)

    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveClass('text-on-surface/60')
  })

  test('uses font-label class', () => {
    render(<ActivityFooter activity={mockActivity} />)

    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveClass('font-label')
  })

  test('renders clock icon', () => {
    render(<ActivityFooter activity={mockActivity} />)

    expect(screen.getByText(/⏱/)).toBeInTheDocument()
  })

  test('renders chat bubble icon', () => {
    render(<ActivityFooter activity={mockActivity} />)

    expect(screen.getByText(/💬/)).toBeInTheDocument()
  })

  test('handles zero file changes', () => {
    const noChangesActivity: AgentActivity = {
      ...mockActivity,
      fileChanges: [],
    }

    render(<ActivityFooter activity={noChangesActivity} />)

    expect(screen.getByText(/\+0 -0/)).toBeInTheDocument()
  })

  test('handles single turn', () => {
    const singleTurnActivity: AgentActivity = {
      ...mockActivity,
      usage: {
        ...mockActivity.usage,
        turnCount: 1,
      },
    }

    render(<ActivityFooter activity={singleTurnActivity} />)

    expect(screen.getByText(/1 turn/)).toBeInTheDocument()
  })

  test('handles duration less than 1 minute', () => {
    const shortActivity: AgentActivity = {
      ...mockActivity,
      usage: {
        ...mockActivity.usage,
        sessionDuration: 42, // 42s
      },
    }

    render(<ActivityFooter activity={shortActivity} />)

    expect(screen.getByText(/42s/)).toBeInTheDocument()
  })

  test('handles duration exactly 1 minute', () => {
    const oneMinuteActivity: AgentActivity = {
      ...mockActivity,
      usage: {
        ...mockActivity.usage,
        sessionDuration: 60, // 1m 0s
      },
    }

    render(<ActivityFooter activity={oneMinuteActivity} />)

    expect(screen.getByText(/1m 0s/)).toBeInTheDocument()
  })

  test('handles duration exactly 1 hour', () => {
    const oneHourActivity: AgentActivity = {
      ...mockActivity,
      usage: {
        ...mockActivity.usage,
        sessionDuration: 3600, // 1h 0m 0s
      },
    }

    render(<ActivityFooter activity={oneHourActivity} />)

    expect(screen.getByText(/1h 0m 0s/)).toBeInTheDocument()
  })

  test('renders with correct layout and spacing', () => {
    render(<ActivityFooter activity={mockActivity} />)

    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveClass('flex')
    expect(footer).toHaveClass('items-center')
    expect(footer).toHaveClass('gap-2')
  })

  test('calculates lines correctly with only additions', () => {
    const additionsOnly: AgentActivity = {
      ...mockActivity,
      fileChanges: [
        {
          id: 'fc-1',
          path: 'file.ts',
          type: 'new',
          linesAdded: 100,
          linesRemoved: 0,
          timestamp: '2026-04-07T03:46:15Z',
        },
      ],
    }

    render(<ActivityFooter activity={additionsOnly} />)

    expect(screen.getByText(/\+100 -0/)).toBeInTheDocument()
  })

  test('calculates lines correctly with only deletions', () => {
    const deletionsOnly: AgentActivity = {
      ...mockActivity,
      fileChanges: [
        {
          id: 'fc-1',
          path: 'file.ts',
          type: 'deleted',
          linesAdded: 0,
          linesRemoved: 50,
          timestamp: '2026-04-07T03:46:15Z',
        },
      ],
    }

    render(<ActivityFooter activity={deletionsOnly} />)

    expect(screen.getByText(/\+0 -50/)).toBeInTheDocument()
  })

  test('renders bullet separators', () => {
    render(<ActivityFooter activity={mockActivity} />)

    const footer = screen.getByRole('contentinfo')

    // Should have 2 bullet separators (·)
    expect(footer.textContent).toMatch(/⏱.*·.*💬.*·.*\+/)
  })
})
