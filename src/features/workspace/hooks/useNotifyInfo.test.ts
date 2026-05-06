import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNotifyInfo } from './useNotifyInfo'

describe('useNotifyInfo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  test('null message initially', () => {
    const { result } = renderHook(() => useNotifyInfo())
    expect(result.current.message).toBeNull()
  })

  test('basic notify sets message', () => {
    const { result } = renderHook(() => useNotifyInfo())

    act(() => {
      result.current.notifyInfo('Test message')
    })

    expect(result.current.message).toBe('Test message')
  })

  test('auto-dismiss after 5s', () => {
    const { result } = renderHook(() => useNotifyInfo())

    act(() => {
      result.current.notifyInfo('Test message')
    })

    expect(result.current.message).toBe('Test message')

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.message).toBeNull()
  })

  test('manual dismiss clears message immediately', () => {
    const { result } = renderHook(() => useNotifyInfo())

    act(() => {
      result.current.notifyInfo('Test message')
    })

    expect(result.current.message).toBe('Test message')

    act(() => {
      result.current.dismiss()
    })

    expect(result.current.message).toBeNull()
  })

  test('successive calls collapse and reset timer', () => {
    const { result } = renderHook(() => useNotifyInfo())

    act(() => {
      result.current.notifyInfo('First message')
    })

    expect(result.current.message).toBe('First message')

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    act(() => {
      result.current.notifyInfo('Second message')
    })

    expect(result.current.message).toBe('Second message')

    // Timer should be reset, so after 4s (total 7s from start) message still visible
    act(() => {
      vi.advanceTimersByTime(4000)
    })

    expect(result.current.message).toBe('Second message')

    // After another 1s (total 5s from second message), it should dismiss
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.message).toBeNull()
  })

  test('unmount cancels timer', () => {
    const { result, unmount } = renderHook(() => useNotifyInfo())

    act(() => {
      result.current.notifyInfo('Test message')
    })

    expect(result.current.message).toBe('Test message')

    unmount()

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    // Should not throw or cause issues
  })

  test('dismiss when no message is no-op', () => {
    const { result } = renderHook(() => useNotifyInfo())

    expect(result.current.message).toBeNull()

    act(() => {
      result.current.dismiss()
    })

    expect(result.current.message).toBeNull()
  })
})
