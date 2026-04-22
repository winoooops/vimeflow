import { describe, test, expect } from 'vitest'
import { formatRelativeTime, formatDuration } from './relativeTime'

describe('formatRelativeTime', () => {
  const now = new Date('2026-04-22T12:00:00Z')

  const iso = (deltaSec: number): string =>
    new Date(now.getTime() - deltaSec * 1000).toISOString()

  test.each([
    // Sub-minute always reads as "now" — we never display seconds.
    [0, 'now'],
    [4, 'now'],
    [5, 'now'],
    [35, 'now'],
    [59, 'now'],
    [60, '1m ago'],
    [61, '1m ago'],
    [119, '1m ago'],
    [120, '2m ago'],
    [59 * 60, '59m ago'],
    [60 * 60, '1h ago'],
    [23 * 60 * 60, '23h ago'],
    [24 * 60 * 60, '1d ago'],
    [48 * 60 * 60, '2d ago'],
  ])('%is ago → %s', (deltaSec, expected) => {
    expect(formatRelativeTime(iso(deltaSec), now)).toBe(expected)
  })
})

describe('formatDuration', () => {
  test.each([
    [0, '0s'],
    [999, '0s'],
    [1000, '1s'],
    [59_000, '59s'],
    [60_000, '1m 0s'],
    [61_000, '1m 1s'],
    [3_599_000, '59m 59s'],
    [3_600_000, '1h 0m'],
    [3_660_000, '1h 1m'],
  ])('%i ms → %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })

  test('NaN input renders as "?"', () => {
    expect(formatDuration(NaN)).toBe('?')
  })

  test('negative input renders as "?" (mirrors formatRelativeTime)', () => {
    expect(formatDuration(-1)).toBe('?')
    expect(formatDuration(-1500)).toBe('?')
  })
})

describe('formatRelativeTime — invalid input', () => {
  // An unparseable ISO string makes new Date().getTime() return NaN;
  // without a guard the function would render 'NaN d ago' in the feed.
  test('returns "?" for a malformed ISO string', () => {
    expect(formatRelativeTime('not-an-iso-string')).toBe('?')
  })

  test('returns "?" when the reference Date is Invalid Date', () => {
    expect(
      formatRelativeTime('2026-04-22T12:00:00Z', new Date('garbage'))
    ).toBe('?')
  })

  test('future timestamps (negative delta from clock skew) read as "now"', () => {
    // `now` 500ms before the event timestamp — simulates Rust event stamp
    // landing a sub-second ahead of the JS clock.
    const now = new Date('2026-04-22T12:00:00Z')
    const futureIso = '2026-04-22T12:00:00.500Z'

    expect(formatRelativeTime(futureIso, now)).toBe('now')
  })
})
