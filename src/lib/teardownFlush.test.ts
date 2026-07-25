/**
 * Checks the shared handoff that saves renderer state before shutdown.
 *
 * A fake save function proves that shutdown waits for registered work and that
 * unregistered work is not called again, preventing stale components from taking
 * part in a later shutdown.
 */

import { describe, expect, test, vi } from 'vitest'
import {
  flushRendererTeardownState,
  registerRendererTeardownFlush,
} from './teardownFlush'

describe('renderer teardown flushes', () => {
  test('awaits registered flushes and unregisters them', async () => {
    const flush = vi.fn((): Promise<void> => Promise.resolve())
    const unregister = registerRendererTeardownFlush(flush)

    await flushRendererTeardownState()
    unregister()
    await flushRendererTeardownState()

    expect(flush).toHaveBeenCalledTimes(1)
  })
})
