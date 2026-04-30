import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BudgetMetrics, formatCost, formatApiTime } from './BudgetMetrics'
import type { CostState, RateLimitsState } from '../types'

const makeCost = (overrides: Partial<CostState> = {}): CostState => ({
  totalCostUsd: 0.42,
  totalDurationMs: 5000,
  totalApiDurationMs: 2300,
  totalLinesAdded: 10,
  totalLinesRemoved: 3,
  ...overrides,
})

const makeRateLimits = (
  overrides: Partial<RateLimitsState> = {}
): RateLimitsState => ({
  fiveHour: { usedPercentage: 35, resetsAt: Date.now() + 3600000 },
  ...overrides,
})

describe('formatCost', () => {
  test('formats 0.42 as "$0.42"', () => {
    expect(formatCost(0.42)).toBe('$0.42')
  })

  test('formats 0 as "$0.00"', () => {
    expect(formatCost(0)).toBe('$0.00')
  })

  test('formats 1.5 as "$1.50"', () => {
    expect(formatCost(1.5)).toBe('$1.50')
  })
})

describe('formatApiTime', () => {
  test('formats 2300ms as "2.3s"', () => {
    expect(formatApiTime(2300)).toBe('2.3s')
  })

  test('formats 0ms as "0.0s"', () => {
    expect(formatApiTime(0)).toBe('0.0s')
  })
})

describe('BudgetMetrics', () => {
  test('renders subscriber variant when rateLimits provided', () => {
    render(
      <BudgetMetrics
        cost={makeCost()}
        rateLimits={makeRateLimits()}
        totalInputTokens={1500}
        totalOutputTokens={500}
      />
    )

    expect(screen.getByText('5h Limit')).toBeInTheDocument()
    expect(screen.getByText('35%')).toBeInTheDocument()
    expect(screen.getByText('API Time')).toBeInTheDocument()
    expect(screen.getByText('Tokens')).toBeInTheDocument()
  })

  test('renders 7d limit bar when sevenDay exists', () => {
    render(
      <BudgetMetrics
        cost={makeCost()}
        rateLimits={makeRateLimits({
          sevenDay: { usedPercentage: 12, resetsAt: Date.now() + 86400000 },
        })}
        totalInputTokens={0}
        totalOutputTokens={0}
      />
    )

    expect(screen.getByText('7d Limit')).toBeInTheDocument()
    expect(screen.getByText('12%')).toBeInTheDocument()
  })

  test('renders API key variant when only cost provided', () => {
    render(
      <BudgetMetrics
        cost={makeCost({ totalCostUsd: 0.42, totalApiDurationMs: 2300 })}
        rateLimits={null}
        totalInputTokens={94720}
        totalOutputTokens={1500}
      />
    )

    expect(screen.getByText('Cost')).toBeInTheDocument()
    expect(screen.getByText('$0.42')).toBeInTheDocument()
    expect(screen.getByText('API Time')).toBeInTheDocument()
    expect(screen.getByText('2.3s')).toBeInTheDocument()
    expect(screen.getByText('Tokens In')).toBeInTheDocument()
    expect(screen.getByText('94.7k')).toBeInTheDocument()
    expect(screen.getByText('Tokens Out')).toBeInTheDocument()
    expect(screen.getByText('1.5k')).toBeInTheDocument()
  })

  test('renders fallback when neither cost nor rateLimits provided', () => {
    render(
      <BudgetMetrics
        cost={null}
        rateLimits={null}
        totalInputTokens={0}
        totalOutputTokens={0}
      />
    )

    expect(screen.getByText('Tokens In')).toBeInTheDocument()
    expect(screen.getByText('Tokens Out')).toBeInTheDocument()
    expect(screen.getAllByText('0')).toHaveLength(2)
  })
})
