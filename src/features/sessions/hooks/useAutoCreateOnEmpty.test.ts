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
})
