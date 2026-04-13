import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusCard } from './StatusCard'
import type { StatusCardProps } from './StatusCard'

const defaultProps: StatusCardProps = {
  agentType: 'claude-code',
  modelId: 'opus-4-6',
  modelDisplayName: null,
  status: 'running',
  cost: null,
  rateLimits: null,
  totalInputTokens: 0,
  totalOutputTokens: 0,
}

describe('StatusCard', () => {
  test('renders agent name for claude-code', () => {
    render(<StatusCard {...defaultProps} />)

    expect(screen.getByText('Claude Code')).toBeInTheDocument()
  })

  test('renders agent name for codex', () => {
    render(<StatusCard {...defaultProps} agentType="codex" />)

    expect(screen.getByText('Codex')).toBeInTheDocument()
  })

  test('renders agent name for aider', () => {
    render(<StatusCard {...defaultProps} agentType="aider" />)

    expect(screen.getByText('Aider')).toBeInTheDocument()
  })

  test('renders agent name for generic', () => {
    render(<StatusCard {...defaultProps} agentType="generic" />)

    expect(screen.getByText('Agent')).toBeInTheDocument()
  })

  test('renders running status with label', () => {
    render(<StatusCard {...defaultProps} status="running" />)

    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  test('renders errored status with label', () => {
    render(<StatusCard {...defaultProps} status="errored" />)

    expect(screen.getByText('Errored')).toBeInTheDocument()
  })

  test('renders status dot with success color when running', () => {
    render(<StatusCard {...defaultProps} status="running" />)

    const dot = screen.getByTestId('status-dot')
    expect(dot).toHaveClass('bg-success')
  })

  test('renders status dot with error color when errored', () => {
    render(<StatusCard {...defaultProps} status="errored" />)

    const dot = screen.getByTestId('status-dot')
    expect(dot).toHaveClass('bg-error')
  })

  test('renders status dot with glow when running', () => {
    render(<StatusCard {...defaultProps} status="running" />)

    const dot = screen.getByTestId('status-dot')
    expect(dot.className).toContain('shadow-')
  })

  test('renders modelId when modelDisplayName is null', () => {
    render(
      <StatusCard
        {...defaultProps}
        modelId="opus-4-6"
        modelDisplayName={null}
      />
    )

    expect(screen.getByText('opus-4-6')).toBeInTheDocument()
  })

  test('renders modelDisplayName when provided', () => {
    render(
      <StatusCard
        {...defaultProps}
        modelId="opus-4-6"
        modelDisplayName="Opus 4.6"
      />
    )

    expect(screen.getByText('Opus 4.6')).toBeInTheDocument()
  })

  test('does not render model badge when both are null', () => {
    render(
      <StatusCard {...defaultProps} modelId={null} modelDisplayName={null} />
    )

    expect(screen.getByText('Claude Code')).toBeInTheDocument()
    expect(screen.queryByText('opus-4-6')).not.toBeInTheDocument()
  })

  test('renders the status card container', () => {
    render(<StatusCard {...defaultProps} />)

    expect(screen.getByTestId('agent-status-card')).toBeInTheDocument()
  })

  test('renders BudgetMetrics section', () => {
    render(
      <StatusCard
        {...defaultProps}
        cost={null}
        rateLimits={null}
        totalInputTokens={0}
        totalOutputTokens={0}
      />
    )

    // Fallback variant renders token labels
    expect(screen.getByText('Tokens In')).toBeInTheDocument()
    expect(screen.getByText('Tokens Out')).toBeInTheDocument()
  })
})
