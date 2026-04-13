import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityFooter, formatDuration } from './ActivityFooter'

describe('formatDuration', () => {
  test('formats 0 as "0m"', () => {
    expect(formatDuration(0)).toBe('0m')
  })

  test('formats minutes only', () => {
    expect(formatDuration(300_000)).toBe('5m')
  })

  test('formats hours and minutes', () => {
    expect(formatDuration(9_900_000)).toBe('2h 45m')
  })

  test('pads minutes with leading zero', () => {
    expect(formatDuration(3_660_000)).toBe('1h 01m')
  })

  test('formats 165 minutes correctly', () => {
    expect(formatDuration(165 * 60_000)).toBe('2h 45m')
  })
})

describe('ActivityFooter', () => {
  test('renders formatted duration', () => {
    render(
      <ActivityFooter
        totalDurationMs={9_900_000}
        turnCount={12}
        linesAdded={1500}
        linesRemoved={300}
      />
    )

    expect(screen.getByText('2h 45m')).toBeInTheDocument()
  })

  test('renders turn count', () => {
    render(
      <ActivityFooter
        totalDurationMs={0}
        turnCount={12}
        linesAdded={0}
        linesRemoved={0}
      />
    )

    expect(screen.getByText('12 turns')).toBeInTheDocument()
  })

  test('renders formatted line counts with commas', () => {
    render(
      <ActivityFooter
        totalDurationMs={0}
        turnCount={0}
        linesAdded={1500}
        linesRemoved={300}
      />
    )

    expect(screen.getByText('+1,500 / -300')).toBeInTheDocument()
  })
})
