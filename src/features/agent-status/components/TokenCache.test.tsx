import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('TokenCache — zero/empty state (kit-faithful)', () => {
  test('shows 0% (not an em dash) when usage is null', () => {
    render(<TokenCache usage={null} history={[]} />)
    expect(screen.getByTestId('token-cache-percent')).toHaveTextContent('0')
  })

  test('always shows the "cached this turn" caption', () => {
    render(<TokenCache usage={null} history={[]} />)
    expect(screen.getByText(/cached this turn/i)).toBeInTheDocument()
  })

  test('zero tokens tone is cold', () => {
    render(<TokenCache usage={makeUsage(0, 0, 0)} history={[]} />)
    expect(screen.getByTestId('token-cache-percent')).toHaveAttribute(
      'data-tone',
      'cold'
    )
  })

  test('renders the flat empty stack band when all buckets are zero', () => {
    render(<TokenCache usage={makeUsage(0, 0, 0)} history={[]} />)
    expect(screen.getByTestId('token-cache-stack-empty')).toBeInTheDocument()
  })

  test('"no data yet" comes only from the empty sparkline', () => {
    render(<TokenCache usage={null} history={[]} />)
    expect(
      screen.getByTestId('token-cache-sparkline-empty')
    ).toBeInTheDocument()
  })
})

describe('TokenCache — no pulse dot (kit forbids it)', () => {
  test('never renders a pulse dot', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} history={[42, 75]} />)
    expect(screen.queryByTestId('token-cache-pulse')).toBeNull()
  })
})

describe('TokenCache — populated', () => {
  test('renders the headline percentage with tabular-nums', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} history={[75]} />)
    const readout = screen.getByTestId('token-cache-percent')
    expect(readout).toHaveTextContent('75')
    expect(readout.className).toMatch(/tabular-nums/)
  })

  test('renders the sparkline when history is present', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} history={[42, 75]} />)
    expect(screen.getByTestId('token-cache-sparkline')).toBeInTheDocument()
  })

  test('uses the kit formatter (1.0k, not 1k) for round thousands', () => {
    render(<TokenCache usage={makeUsage(2000, 1000, 700)} history={[75]} />)
    expect(screen.getByTestId('token-cache-stat-cached')).toHaveTextContent(
      '2.0k'
    )

    expect(screen.getByTestId('token-cache-stat-wrote')).toHaveTextContent(
      '1.0k'
    )

    expect(screen.getByTestId('token-cache-stat-fresh')).toHaveTextContent(
      '700'
    )
  })

  test('reveals a metric explanation on hover, hidden by default', async () => {
    const user = userEvent.setup()
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} history={[75]} />)

    expect(screen.queryByText(/reused from the prompt cache/i)).toBeNull()

    await user.hover(screen.getByTestId('token-cache-stat-cached'))

    expect(
      await screen.findByText(/reused from the prompt cache/i)
    ).toBeInTheDocument()
  })
})

describe('TokenCache — tone from rounded percent', () => {
  test('69.5% rounds to 70 and is healthy, not warming', () => {
    render(<TokenCache usage={makeUsage(139, 61, 0)} history={[]} />)
    const readout = screen.getByTestId('token-cache-percent')
    expect(readout).toHaveTextContent('70')
    expect(readout).toHaveAttribute('data-tone', 'healthy')
  })

  test('cold below 40', () => {
    render(<TokenCache usage={makeUsage(350, 350, 300)} history={[]} />)
    expect(screen.getByTestId('token-cache-percent')).toHaveAttribute(
      'data-tone',
      'cold'
    )
  })

  test('warming at exactly 40', () => {
    render(<TokenCache usage={makeUsage(400, 300, 300)} history={[]} />)
    expect(screen.getByTestId('token-cache-percent')).toHaveAttribute(
      'data-tone',
      'warming'
    )
  })
})

describe('TokenCache — stack bar', () => {
  test('three segments sum to ~100% when populated', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} history={[75]} />)

    const widths = [
      parseFloat(screen.getByTestId('token-cache-stack-cached').style.width),
      parseFloat(screen.getByTestId('token-cache-stack-wrote').style.width),
      parseFloat(screen.getByTestId('token-cache-stack-fresh').style.width),
    ]
    const sum = widths.reduce((a, b) => a + b, 0)
    expect(sum).toBeGreaterThan(99.9)
    expect(sum).toBeLessThan(100.1)
  })

  test('uses distinct bucket colors for wrote and fresh segments', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} history={[75]} />)

    expect(
      screen.getByTestId('token-cache-stack-wrote').getAttribute('style')
    ).toContain('linear-gradient(90deg, #a8c8ff, #8aa9d8)')

    expect(
      screen.getByTestId('token-cache-stack-fresh').getAttribute('style')
    ).toContain('linear-gradient(90deg, #fab387, #f9a87b)')
  })

  test('cached and fresh styles differ in cold-cache state', () => {
    render(<TokenCache usage={makeUsage(300, 200, 500)} history={[75]} />)

    const freshStyle = screen
      .getByTestId('token-cache-stack-fresh')
      .getAttribute('style')

    expect(freshStyle).not.toContain('#ff94a5')
  })
})
