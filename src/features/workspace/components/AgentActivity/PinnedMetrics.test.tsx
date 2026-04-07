import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import PinnedMetrics from './PinnedMetrics'
import type { AgentActivity } from '../../types'

describe('PinnedMetrics', () => {
  const mockActivity: AgentActivity = {
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
  }

  test('renders context window emoji indicator', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    expect(screen.getByText('😊')).toBeInTheDocument()
  })

  test('renders context window label', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    expect(screen.getByText('Context')).toBeInTheDocument()
  })

  test('renders different emoji for moderate context usage', () => {
    const moderateActivity: AgentActivity = {
      ...mockActivity,
      contextWindow: {
        used: 140000,
        total: 200000,
        percentage: 70,
        emoji: '😐',
      },
    }

    render(<PinnedMetrics activity={moderateActivity} />)

    expect(screen.getByText('😐')).toBeInTheDocument()
  })

  test('renders different emoji for high context usage', () => {
    const highActivity: AgentActivity = {
      ...mockActivity,
      contextWindow: {
        used: 160000,
        total: 200000,
        percentage: 80,
        emoji: '😟',
      },
    }

    render(<PinnedMetrics activity={highActivity} />)

    expect(screen.getByText('😟')).toBeInTheDocument()
  })

  test('renders different emoji for critical context usage', () => {
    const criticalActivity: AgentActivity = {
      ...mockActivity,
      contextWindow: {
        used: 190000,
        total: 200000,
        percentage: 95,
        emoji: '🥵',
      },
    }

    render(<PinnedMetrics activity={criticalActivity} />)

    expect(screen.getByText('🥵')).toBeInTheDocument()
  })

  test('renders 5-hour usage message count', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    expect(screen.getByText(/142/)).toBeInTheDocument()
    expect(screen.getByText(/200/)).toBeInTheDocument()
  })

  test('renders messages label', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    expect(screen.getByText(/messages/i)).toBeInTheDocument()
  })

  test('renders progress bar for usage', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    const progressBar = screen.getByTestId('usage-progress-bar')

    expect(progressBar).toBeInTheDocument()
  })

  test('progress bar shows correct fill percentage', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    const progressFill = screen.getByTestId('usage-progress-fill')
    const expectedWidth = (142 / 200) * 100

    expect(progressFill).toHaveStyle({ width: `${expectedWidth}%` })
  })

  test('applies purple gradient to progress fill', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    const progressFill = screen.getByTestId('usage-progress-fill')

    expect(progressFill).toHaveClass('bg-gradient-to-r')
    expect(progressFill).toHaveClass('from-primary-container')
    expect(progressFill).toHaveClass('to-primary')
  })

  test('progress bar has correct height', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    const progressBar = screen.getByTestId('usage-progress-bar')

    expect(progressBar).toHaveClass('h-1')
  })

  test('progress bar has dark background', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    const progressBar = screen.getByTestId('usage-progress-bar')

    expect(progressBar).toHaveClass('bg-surface-container')
  })

  test('applies correct spacing between metrics', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    const container = screen.getByTestId('pinned-metrics')

    expect(container).toHaveClass('flex')
    expect(container).toHaveClass('flex-col')
    expect(container).toHaveClass('gap-3')
  })

  test('context window uses muted text color', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    const contextIndicator = screen.getByTestId('context-window-indicator')

    expect(contextIndicator).toHaveClass('text-on-surface/60')
  })

  test('usage count uses correct text styling', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    const usageDisplay = screen.getByTestId('usage-display')

    expect(usageDisplay).toHaveClass('text-sm')
  })

  test('applies correct font classes', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    const container = screen.getByTestId('pinned-metrics')

    expect(container).toHaveClass('font-label')
  })

  test('renders usage as fraction format', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    const usageDisplay = screen.getByText('142 / 200')

    expect(usageDisplay).toBeInTheDocument()
  })

  test('renders progress bar with rounded corners', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    const progressBar = screen.getByTestId('usage-progress-bar')

    expect(progressBar).toHaveClass('rounded-full')
  })

  test('progress fill has rounded corners', () => {
    render(<PinnedMetrics activity={mockActivity} />)

    const progressFill = screen.getByTestId('usage-progress-fill')

    expect(progressFill).toHaveClass('rounded-full')
  })

  test('handles 100% usage correctly', () => {
    const fullActivity: AgentActivity = {
      ...mockActivity,
      usage: {
        ...mockActivity.usage,
        messages: { sent: 200, limit: 200 },
      },
    }

    render(<PinnedMetrics activity={fullActivity} />)

    const progressFill = screen.getByTestId('usage-progress-fill')

    expect(progressFill).toHaveStyle({ width: '100%' })
  })
})
