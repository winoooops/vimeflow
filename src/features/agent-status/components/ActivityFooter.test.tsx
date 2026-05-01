import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ActivityFooter, formatDuration } from './ActivityFooter'

describe('ActivityFooter', () => {
  test('renders duration and line totals', () => {
    render(
      <ActivityFooter
        totalDurationMs={90_000}
        linesAdded={42}
        linesRemoved={9}
      />
    )

    expect(screen.getByText('1m')).toBeInTheDocument()
    expect(screen.getByText('+42 / -9')).toBeInTheDocument()
  })

  test('does not render a turns cell', () => {
    render(
      <ActivityFooter totalDurationMs={0} linesAdded={0} linesRemoved={0} />
    )

    expect(screen.queryByText(/turns?/i)).not.toBeInTheDocument()
  })

  test('localizes large line counts', () => {
    render(
      <ActivityFooter
        totalDurationMs={0}
        linesAdded={12_345}
        linesRemoved={6_789}
      />
    )

    expect(screen.getByText('+12,345 / -6,789')).toBeInTheDocument()
  })
})

describe('formatDuration', () => {
  test('renders minutes only when under one hour', () => {
    expect(formatDuration(45_000)).toBe('0m')
    expect(formatDuration(90_000)).toBe('1m')
  })

  test('renders hours and zero-padded minutes when over one hour', () => {
    expect(formatDuration(3_900_000)).toBe('1h 05m')
  })
})
