import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useAutoCreateOnEmpty } from './useAutoCreateOnEmpty'

describe('useAutoCreateOnEmpty', () => {
  test('fires createSession once after restore completes with no live session', () => {
    const createSession = vi.fn()

    const { rerender } = renderHook(
      ({ loading, hasLive }) =>
        useAutoCreateOnEmpty({
          enabled: true,
          loading,
          hasLiveSession: hasLive,
          pendingSpawns: 0,
          createSession,
        }),
      { initialProps: { loading: true, hasLive: false } }
    )

    expect(createSession).not.toHaveBeenCalled()

    rerender({ loading: false, hasLive: false })
    expect(createSession).toHaveBeenCalledTimes(1)

    rerender({ loading: false, hasLive: false })
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  test('does not fire when a live session exists post-restore', () => {
    const createSession = vi.fn()
    renderHook(() =>
      useAutoCreateOnEmpty({
        enabled: true,
        loading: false,
        hasLiveSession: true,
        pendingSpawns: 0,
        createSession,
      })
    )
    expect(createSession).not.toHaveBeenCalled()
  })

  test('defers when pendingSpawns > 0 and re-fires on post-failure tick', () => {
    const createSession = vi.fn()

    const { rerender } = renderHook(
      ({ pending, hasLive }) =>
        useAutoCreateOnEmpty({
          enabled: true,
          loading: false,
          hasLiveSession: hasLive,
          pendingSpawns: pending,
          createSession,
        }),
      { initialProps: { pending: 1, hasLive: false } }
    )

    expect(createSession).not.toHaveBeenCalled()

    rerender({ pending: 0, hasLive: false })
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  test('does nothing when enabled is false', () => {
    const createSession = vi.fn()
    renderHook(() =>
      useAutoCreateOnEmpty({
        enabled: false,
        loading: false,
        hasLiveSession: false,
        pendingSpawns: 0,
        createSession,
      })
    )
    expect(createSession).not.toHaveBeenCalled()
  })

  // F10 (claude MEDIUM) regression: a failed initial auto-create spawn
  // must not permanently disable retry. The guard latches only on
  // observed hasLiveSession === true, not on attempt count.
  test('retries on initial spawn failure; latches on first observed live session', () => {
    const createSession = vi.fn()

    const { rerender } = renderHook(
      ({ pending, hasLive }) =>
        useAutoCreateOnEmpty({
          enabled: true,
          loading: false,
          hasLiveSession: hasLive,
          pendingSpawns: pending,
          createSession,
        }),
      { initialProps: { pending: 0, hasLive: false } }
    )

    // Initial: no live session, no spawn in flight → fire.
    expect(createSession).toHaveBeenCalledTimes(1)

    // Spawn in flight.
    rerender({ pending: 1, hasLive: false })
    expect(createSession).toHaveBeenCalledTimes(1)

    // Spawn FAILED — pendingSpawns drops to 0, hasLive still false.
    // Per F10: must retry.
    rerender({ pending: 0, hasLive: false })
    expect(createSession).toHaveBeenCalledTimes(2)

    // Spawn in flight again.
    rerender({ pending: 1, hasLive: false })
    expect(createSession).toHaveBeenCalledTimes(2)

    // Spawn succeeds — hasLive flips true. Ref latches.
    rerender({ pending: 0, hasLive: true })
    expect(createSession).toHaveBeenCalledTimes(2)

    // User later closes all tabs — hasLive returns to false. MUST NOT
    // auto-create again (ref is latched). The user's tab-close is
    // intentional, not a state to recover from.
    rerender({ pending: 0, hasLive: false })
    expect(createSession).toHaveBeenCalledTimes(2)
  })
})
