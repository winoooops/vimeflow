import { describe, test, expect } from 'vitest'
import { cacheBuckets, cacheHitRate, cacheTone } from './cacheRate'
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

describe('cacheBuckets', () => {
  test('returns all zeros for null input', () => {
    expect(cacheBuckets(null)).toEqual({
      cached: 0,
      wrote: 0,
      fresh: 0,
      total: 0,
    })
  })

  test('returns all zeros for undefined input', () => {
    expect(cacheBuckets(undefined)).toEqual({
      cached: 0,
      wrote: 0,
      fresh: 0,
      total: 0,
    })
  })

  test('returns all zeros for fully zero usage', () => {
    expect(cacheBuckets(makeUsage(0, 0, 0))).toEqual({
      cached: 0,
      wrote: 0,
      fresh: 0,
      total: 0,
    })
  })

  test('sums populated buckets', () => {
    expect(cacheBuckets(makeUsage(7500, 1800, 700))).toEqual({
      cached: 7500,
      wrote: 1800,
      fresh: 700,
      total: 10000,
    })
  })
})

describe('cacheHitRate', () => {
  test('returns null for null input', () => {
    expect(cacheHitRate(null)).toBeNull()
  })

  test('returns null for undefined input', () => {
    expect(cacheHitRate(undefined)).toBeNull()
  })

  test('returns null when total is zero', () => {
    expect(cacheHitRate(makeUsage(0, 0, 0))).toBeNull()
  })

  test('returns 0 when only fresh tokens', () => {
    expect(cacheHitRate(makeUsage(0, 0, 1000))).toBe(0)
  })

  test('returns 1 when only cached tokens', () => {
    expect(cacheHitRate(makeUsage(1000, 0, 0))).toBe(1)
  })

  test('returns 0.5 for evenly split cached + fresh', () => {
    expect(cacheHitRate(makeUsage(500, 0, 500))).toBe(0.5)
  })

  test('uses canonical formula: cached / (cached + wrote + fresh)', () => {
    // 7500 / (7500 + 1800 + 700) === 0.75
    expect(cacheHitRate(makeUsage(7500, 1800, 700))).toBe(0.75)
  })
})

describe('cacheTone', () => {
  test('returns null for null rate', () => {
    expect(cacheTone(null)).toBeNull()
  })

  test('returns "cold" below 0.4', () => {
    expect(cacheTone(0)).toBe('cold')
    expect(cacheTone(0.39)).toBe('cold')
    expect(cacheTone(0.399999)).toBe('cold')
  })

  test('returns "warming" at and above 0.4, below 0.7', () => {
    expect(cacheTone(0.4)).toBe('warming')
    expect(cacheTone(0.5)).toBe('warming')
    expect(cacheTone(0.69)).toBe('warming')
    expect(cacheTone(0.699999)).toBe('warming')
  })

  test('returns "healthy" at and above 0.7', () => {
    expect(cacheTone(0.7)).toBe('healthy')
    expect(cacheTone(0.85)).toBe('healthy')
    expect(cacheTone(1.0)).toBe('healthy')
  })
})
