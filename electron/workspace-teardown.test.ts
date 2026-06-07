import { describe, expect, test, vi } from 'vitest'
import { WorkspaceTeardown } from './workspace-teardown'

describe('WorkspaceTeardown', () => {
  test('flushOnce drains the final shape then saves, in order', async () => {
    const order: string[] = []

    const teardown = new WorkspaceTeardown({
      drainFinalShape: vi.fn((): Promise<void> => {
        order.push('drain')

        return Promise.resolve()
      }),
      flush: vi.fn((): Promise<void> => {
        order.push('flush')

        return Promise.resolve()
      }),
    })

    await teardown.flushOnce()

    expect(order).toEqual(['drain', 'flush'])
    expect(teardown.hasFlushed).toBe(true)
  })

  test('a second flushOnce is a no-op within one teardown transaction', async () => {
    const drainFinalShape = vi.fn().mockResolvedValue(undefined)
    const flush = vi.fn().mockResolvedValue(undefined)
    const teardown = new WorkspaceTeardown({ drainFinalShape, flush })

    await teardown.flushOnce()
    await teardown.flushOnce()

    expect(drainFinalShape).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  test('reset re-arms the guard so a later teardown flushes again', async () => {
    const flush = vi.fn().mockResolvedValue(undefined)

    const teardown = new WorkspaceTeardown({
      drainFinalShape: vi.fn().mockResolvedValue(undefined),
      flush,
    })

    await teardown.flushOnce()
    teardown.reset()
    expect(teardown.hasFlushed).toBe(false)
    await teardown.flushOnce()

    expect(flush).toHaveBeenCalledTimes(2)
  })

  test('a failed final-shape drain still proceeds to the save', async () => {
    const flush = vi.fn().mockResolvedValue(undefined)

    const teardown = new WorkspaceTeardown({
      drainFinalShape: vi.fn().mockRejectedValue(new Error('renderer gone')),
      flush,
    })

    await teardown.flushOnce()

    expect(flush).toHaveBeenCalledTimes(1)
    expect(teardown.hasFlushed).toBe(true)
  })
})
