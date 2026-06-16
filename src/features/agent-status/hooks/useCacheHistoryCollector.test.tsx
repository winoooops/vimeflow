import { describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCacheHistoryCollector } from './useCacheHistoryCollector'
import type { CurrentUsageState } from '../types'

const usage = (c: number, w: number, f: number): CurrentUsageState => ({
  inputTokens: f,
  outputTokens: 0,
  cacheCreationInputTokens: w,
  cacheReadInputTokens: c,
})

describe('useCacheHistoryCollector', () => {
  test('emits a reading on a changed percentage, ignores an unchanged one', () => {
    const onReading = vi.fn()

    const props = {
      ptyId: 'p',
      runId: 'run-1',
      sessionId: 's',
      paneId: 'p0',
      usage: usage(7500, 1800, 700),
      onReading,
      onReset: vi.fn(),
    }

    const { rerender } = renderHook((p) => useCacheHistoryCollector(p), {
      initialProps: props,
    })
    expect(onReading).toHaveBeenCalledWith('s', 'p0', 75)
    rerender({ ...props })
    expect(onReading).toHaveBeenCalledTimes(1)
  })

  test('does not emit when percentage is null', () => {
    const onReading = vi.fn()
    renderHook(() =>
      useCacheHistoryCollector({
        ptyId: 'p',
        runId: 'run-1',
        sessionId: 's',
        paneId: 'p0',
        usage: null,
        onReading,
        onReset: vi.fn(),
      })
    )
    expect(onReading).not.toHaveBeenCalled()
  })

  test('re-emits after ptyId changes (agent restart)', () => {
    const onReading = vi.fn()

    const base = {
      runId: 'run-1',
      sessionId: 's',
      paneId: 'p0',
      usage: usage(7500, 1800, 700),
      onReading,
      onReset: vi.fn(),
    }

    const { rerender } = renderHook((p) => useCacheHistoryCollector(p), {
      initialProps: { ...base, ptyId: 'p' },
    })
    rerender({ ...base, ptyId: 'q' })
    expect(onReading).toHaveBeenCalledTimes(2)
  })

  test('resets without appending a stale duplicate when runId changes on the same ptyId', () => {
    const onReading = vi.fn()
    const onReset = vi.fn()

    const base = {
      ptyId: 'p',
      sessionId: 's',
      paneId: 'p0',
      usage: usage(7500, 1800, 700),
      onReading,
      onReset,
    }

    const { rerender } = renderHook((p) => useCacheHistoryCollector(p), {
      initialProps: { ...base, runId: 'run-1' },
    })

    rerender({ ...base, runId: 'run-2' })

    expect(onReset).toHaveBeenCalledWith('s', 'p0')
    expect(onReading).toHaveBeenCalledTimes(1)

    rerender({
      ...base,
      runId: 'run-2',
      usage: usage(4000, 1000, 5000),
    })

    expect(onReading).toHaveBeenCalledTimes(2)
    expect(onReading).toHaveBeenLastCalledWith('s', 'p0', 40)
  })
})
