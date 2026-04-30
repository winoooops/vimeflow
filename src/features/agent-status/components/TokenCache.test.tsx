import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TokenCache } from './TokenCache'
import type { CurrentUsageState } from '../types'

const makeUsage = (
  cached: number,
  wrote: number,
  fresh: number
): CurrentUsageState => ({
  inputTokens: fresh,
  outputTokens: 0,
  cacheCreationInputTokens: wrote,
  cacheReadInputTokens: cached,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TokenCache — empty state', () => {
  test('renders "no data yet" caption when usage is null', () => {
    render(<TokenCache usage={null} />)
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  test('renders "no data yet" when all buckets are zero', () => {
    render(<TokenCache usage={makeUsage(0, 0, 0)} />)
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  test('does not render the pulse dot in empty state', () => {
    render(<TokenCache usage={null} />)
    expect(screen.queryByTestId('token-cache-pulse')).toBeNull()
  })

  test('renders zero counts in the stat grid in empty state', () => {
    render(<TokenCache usage={null} />)

    const cached = screen.getByTestId('token-cache-stat-cached')
    const wrote = screen.getByTestId('token-cache-stat-wrote')
    const fresh = screen.getByTestId('token-cache-stat-fresh')

    expect(cached).toHaveTextContent('0')
    expect(wrote).toHaveTextContent('0')
    expect(fresh).toHaveTextContent('0')
  })
})

describe('TokenCache — populated', () => {
  test('renders the headline percentage with tabular-nums', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} />)
    const readout = screen.getByTestId('token-cache-percent')
    expect(readout).toHaveTextContent('75%')
    expect(readout.className).toMatch(/tabular-nums/)
  })

  test('renders "CACHED THIS TURN" caption', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} />)
    expect(screen.getByText(/cached this turn/i)).toBeInTheDocument()
  })

  test('renders the pulse dot when populated', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} />)
    expect(screen.getByTestId('token-cache-pulse')).toBeInTheDocument()
  })

  test('renders raw token counts in the stat grid', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} />)

    expect(screen.getByTestId('token-cache-stat-cached')).toHaveTextContent(
      '7.5k'
    )

    expect(screen.getByTestId('token-cache-stat-wrote')).toHaveTextContent(
      '1.8k'
    )

    expect(screen.getByTestId('token-cache-stat-fresh')).toHaveTextContent(
      '700'
    )
  })

  test('renders three labelled hints', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} />)
    expect(screen.getByText(/free reuse/i)).toBeInTheDocument()
    expect(screen.getByText(/uploaded/i)).toBeInTheDocument()
    expect(screen.getByText(/new tokens/i)).toBeInTheDocument()
  })
})

describe('TokenCache — tone thresholds', () => {
  test('cold tone below 0.4', () => {
    // 350 / (350 + 350 + 300) = 0.35 → cold
    render(<TokenCache usage={makeUsage(350, 350, 300)} />)
    const readout = screen.getByTestId('token-cache-percent')
    expect(readout).toHaveAttribute('data-tone', 'cold')
  })

  test('warming tone at exactly 0.4', () => {
    // 400 / (400 + 300 + 300) = 0.4 → warming
    render(<TokenCache usage={makeUsage(400, 300, 300)} />)
    const readout = screen.getByTestId('token-cache-percent')
    expect(readout).toHaveAttribute('data-tone', 'warming')
  })

  test('warming tone just below 0.7', () => {
    // 690 / (690 + 200 + 110) = 0.69 → warming
    render(<TokenCache usage={makeUsage(690, 200, 110)} />)
    const readout = screen.getByTestId('token-cache-percent')
    expect(readout).toHaveAttribute('data-tone', 'warming')
  })

  test('healthy tone at exactly 0.7', () => {
    // 700 / (700 + 200 + 100) = 0.7 → healthy
    render(<TokenCache usage={makeUsage(700, 200, 100)} />)
    const readout = screen.getByTestId('token-cache-percent')
    expect(readout).toHaveAttribute('data-tone', 'healthy')
  })
})

describe('TokenCache — stack bar', () => {
  test('renders three segments summing to ~100% in populated case', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} />)

    const cached = screen.getByTestId('token-cache-stack-cached')
    const wrote = screen.getByTestId('token-cache-stack-wrote')
    const fresh = screen.getByTestId('token-cache-stack-fresh')

    const widths = [
      parseFloat(cached.style.width),
      parseFloat(wrote.style.width),
      parseFloat(fresh.style.width),
    ]
    const sum = widths.reduce((a, b) => a + b, 0)

    expect(sum).toBeGreaterThan(99.9)
    expect(sum).toBeLessThan(100.1)
  })

  test('renders the tonal empty band in the zero state', () => {
    render(<TokenCache usage={null} />)
    const empty = screen.getByTestId('token-cache-stack-empty')
    expect(empty).toBeInTheDocument()
    // Tonal background, no border (UNIFIED.md §8 + DESIGN.md §23).
    expect(empty.className).toMatch(/bg-surface-container-high/)
    expect(empty.className).not.toMatch(/\bborder\b/)
    expect(screen.queryByTestId('token-cache-stack-cached')).toBeNull()
  })
})

describe('TokenCache — pulse dot uses Tailwind animation', () => {
  test('pulse dot has the animate-pulse class when populated', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} />)
    expect(screen.getByTestId('token-cache-pulse')).toHaveClass('animate-pulse')
  })

  test('does not leak any timers across unmount', () => {
    vi.useFakeTimers()

    const { unmount } = render(
      <TokenCache usage={makeUsage(7500, 1800, 700)} />
    )
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
