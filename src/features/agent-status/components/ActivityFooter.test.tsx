import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ActivityFooter, formatDuration } from './ActivityFooter'

describe('ActivityFooter', () => {
  test('renders duration and line totals', () => {
    render(
      <ActivityFooter
        totalDurationMs={90_000}
        numTurns={3}
        linesAdded={42}
        linesRemoved={9}
      />
    )

    expect(screen.getByText('1m')).toBeInTheDocument()
    expect(screen.getByText('3 turns')).toBeInTheDocument()
    expect(screen.getByText('+42 / -9')).toBeInTheDocument()
  })

  test('renders singular turn label', () => {
    render(
      <ActivityFooter
        totalDurationMs={0}
        numTurns={1}
        linesAdded={0}
        linesRemoved={0}
      />
    )

    expect(screen.getByText('1 turn')).toBeInTheDocument()
  })

  test('renders 0 turns during the pre-activity window before the first agent-turn event', () => {
    // Locks the contract that the cell stays visible when numTurns=0
    // (the initial value of `status.numTurns` in `createDefaultStatus`).
    // If we ever decide to hide the cell pre-activity, update this test
    // and guard the span in ActivityFooter.tsx — the change must be
    // explicit, not silent.
    render(
      <ActivityFooter
        totalDurationMs={0}
        numTurns={0}
        linesAdded={0}
        linesRemoved={0}
      />
    )

    expect(screen.getByText('0 turns')).toBeInTheDocument()
  })

  test('localizes large line counts', () => {
    render(
      <ActivityFooter
        totalDurationMs={0}
        numTurns={1_234}
        linesAdded={12_345}
        linesRemoved={6_789}
      />
    )

    expect(screen.getByText('1,234 turns')).toBeInTheDocument()
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
