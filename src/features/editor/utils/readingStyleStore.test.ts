import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  getReadingStyleId,
  setReadingStyleId,
  subscribeReadingStyle,
} from './readingStyleStore'

const KEY = 'vimeflow:editor:readingStyle'

describe('readingStyleStore', () => {
  beforeEach(() => {
    localStorage.clear()
    // Reset the module singleton to the default between tests.
    setReadingStyleId('comfortable')
  })

  test('setReadingStyleId updates the value and persists it', () => {
    setReadingStyleId('compact')

    expect(getReadingStyleId()).toBe('compact')
    expect(localStorage.getItem(KEY)).toBe('compact')
  })

  test('notifies subscribers on change, skips no-ops, and unsubscribes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeReadingStyle(listener)

    setReadingStyleId('spacious')
    expect(listener).toHaveBeenCalledTimes(1)

    setReadingStyleId('spacious') // same value → no notification
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    setReadingStyleId('compact')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('reads a persisted value on module load', async () => {
    localStorage.setItem(KEY, 'spacious')
    vi.resetModules()

    const fresh = await import('./readingStyleStore')
    expect(fresh.getReadingStyleId()).toBe('spacious')
  })

  test('falls back to the default for an unknown persisted value', async () => {
    localStorage.setItem(KEY, 'bogus')
    vi.resetModules()

    const fresh = await import('./readingStyleStore')
    expect(fresh.getReadingStyleId()).toBe('comfortable')
  })
})
