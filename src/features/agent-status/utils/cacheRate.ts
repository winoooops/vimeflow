import type { CurrentUsageState } from '../types'

export type CacheTone = 'healthy' | 'warming' | 'cold'

export interface CacheBuckets {
  cached: number
  wrote: number
  fresh: number
  total: number
}

export const cacheBuckets = (
  usage: CurrentUsageState | null | undefined
): CacheBuckets => {
  if (!usage) {
    return { cached: 0, wrote: 0, fresh: 0, total: 0 }
  }

  const cached = usage.cacheReadInputTokens
  const wrote = usage.cacheCreationInputTokens
  const fresh = usage.inputTokens

  return {
    cached,
    wrote,
    fresh,
    total: cached + wrote + fresh,
  }
}

export const cacheHitRate = (
  usage: CurrentUsageState | null | undefined
): number | null => {
  const { cached, total } = cacheBuckets(usage)

  if (total === 0) {
    return null
  }

  return cached / total
}

export const cacheTone = (rate: number | null): CacheTone | null => {
  if (rate === null) {
    return null
  }

  if (rate >= 0.7) {
    return 'healthy'
  }

  if (rate >= 0.4) {
    return 'warming'
  }

  return 'cold'
}

export const CACHE_HISTORY_LIMIT = 40

export const cacheHitPercentage = (
  usage: CurrentUsageState | null | undefined
): number | null => {
  const rate = cacheHitRate(usage)

  return rate === null ? null : Math.round(rate * 100)
}

// Tone from the rounded percent so the digit and the tint never disagree.
export const cacheToneFromPercent = (pct: number): CacheTone =>
  pct >= 70 ? 'healthy' : pct >= 40 ? 'warming' : 'cold'

// Skips a consecutive-equal reading (returns the same ref); caps to last N.
export const pushCacheReading = (
  history: number[],
  reading: number,
  cap = CACHE_HISTORY_LIMIT
): number[] => {
  if (history.length > 0 && history[history.length - 1] === reading) {
    return history
  }

  return [...history, reading].slice(-cap)
}
