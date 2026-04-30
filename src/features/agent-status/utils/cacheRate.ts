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
