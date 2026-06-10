import { afterEach, describe, expect, test } from 'vitest'
import {
  readCacheHistory,
  writeCacheHistory,
  deleteCacheHistory,
} from './cacheHistoryStore'

afterEach(() => localStorage.clear())

describe('cacheHistoryStore', () => {
  test('round-trips a history array', () => {
    writeCacheHistory('pty-1', [42, 51, 49])
    expect(readCacheHistory('pty-1')).toEqual([42, 51, 49])
  })

  test('returns [] when nothing is stored', () => {
    expect(readCacheHistory('missing')).toEqual([])
  })

  test('returns [] for malformed json', () => {
    localStorage.setItem('vimeflow:agent:cacheHistory:x', '{nope')
    expect(readCacheHistory('x')).toEqual([])
  })

  test('rejects arrays with out-of-range or non-integer entries', () => {
    localStorage.setItem('vimeflow:agent:cacheHistory:y', '[1, 200, 3]')
    expect(readCacheHistory('y')).toEqual([])
    localStorage.setItem('vimeflow:agent:cacheHistory:z', '[1, 2.5, 3]')
    expect(readCacheHistory('z')).toEqual([])
  })

  test('caps the read result to the most recent CACHE_HISTORY_LIMIT', () => {
    const big = Array.from({ length: 50 }, (_, i) => i % 100)
    writeCacheHistory('pty-big', big)
    expect(readCacheHistory('pty-big')).toHaveLength(40)
  })

  test('delete removes the key', () => {
    writeCacheHistory('pty-2', [1, 2])
    deleteCacheHistory('pty-2')
    expect(readCacheHistory('pty-2')).toEqual([])
  })
})
