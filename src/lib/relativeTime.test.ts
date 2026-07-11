import { describe, expect, test } from 'vitest'
import { formatDuration, formatRelativeTime } from './relativeTime'

describe('formatRelativeTime', () => {
  test('formats recent and older timestamps', () => {
    const now = new Date('2026-07-10T12:00:00Z')

    expect(formatRelativeTime('2026-07-10T11:59:30Z', now)).toBe('now')
    expect(formatRelativeTime('2026-07-10T11:15:00Z', now)).toBe('45m ago')
    expect(formatRelativeTime('2026-07-10T09:00:00Z', now)).toBe('3h ago')
  })

  test('guards malformed and future timestamps', () => {
    const now = new Date('2026-07-10T12:00:00Z')

    expect(formatRelativeTime('not-an-iso-string', now)).toBe('?')
    expect(formatRelativeTime('2026-07-10T12:00:01Z', now)).toBe('now')
  })
})

describe('formatDuration', () => {
  test('formats positive durations and rejects invalid input', () => {
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(90_000)).toBe('1m 30s')
    expect(formatDuration(Number.NaN)).toBe('?')
    expect(formatDuration(-1)).toBe('?')
  })
})
