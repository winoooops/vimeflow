import { afterEach, describe, expect, test, vi } from 'vitest'
import { ProgressTracker } from './progressTracker'

describe('ProgressTracker', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('broadcasts expiry only when it removes current progress', () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    const tracker = new ProgressTracker([callback])

    tracker.set('pty-1', { state: 'normal', value: 10 })
    tracker.clear('pty-1')
    vi.advanceTimersByTime(15_000)

    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenNthCalledWith(1, 'pty-1', {
      state: 'normal',
      value: 10,
    })
    expect(callback).toHaveBeenNthCalledWith(2, 'pty-1', undefined)
  })
})
