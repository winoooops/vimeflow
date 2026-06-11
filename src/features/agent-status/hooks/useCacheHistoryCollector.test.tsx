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
      sessionId: 's',
      paneId: 'p0',
      usage: usage(7500, 1800, 700),
      onReading,
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
        sessionId: 's',
        paneId: 'p0',
        usage: null,
        onReading,
      })
    )
    expect(onReading).not.toHaveBeenCalled()
  })

  test('re-emits after ptyId changes (agent restart)', () => {
    const onReading = vi.fn()

    const base = {
      sessionId: 's',
      paneId: 'p0',
      usage: usage(7500, 1800, 700),
      onReading,
    }

    const { rerender } = renderHook((p) => useCacheHistoryCollector(p), {
      initialProps: { ...base, ptyId: 'p' },
    })
    rerender({ ...base, ptyId: 'q' })
    expect(onReading).toHaveBeenCalledTimes(2)
  })
})
