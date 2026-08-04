import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { PtyProgress } from '../types'
import { usePtyProgress } from './usePtyProgress'

class ProgressSource {
  readonly values = new Map<string, PtyProgress>()
  readonly callbacks = new Set<
    (sessionId: string, progress: PtyProgress | undefined) => void
  >()
  readonly pending: (() => void)[] = []
  unsubscribeCount = 0

  getProgress(sessionId: string): PtyProgress | undefined {
    return this.values.get(sessionId)
  }

  onProgress(
    callback: (sessionId: string, progress: PtyProgress | undefined) => void
  ): Promise<() => void> {
    this.callbacks.add(callback)

    return new Promise((resolve) => {
      this.pending.push(() => {
        resolve(() => {
          this.unsubscribeCount += 1
          this.callbacks.delete(callback)
        })
      })
    })
  }

  resolveNext(): void {
    this.pending.shift()?.()
  }

  publish(sessionId: string, progress: PtyProgress | undefined): void {
    if (progress) {
      this.values.set(sessionId, progress)
    } else {
      this.values.delete(sessionId)
    }
    this.callbacks.forEach((callback) => callback(sessionId, progress))
  }
}

describe('usePtyProgress', () => {
  test('seeds an already stored value on first render', () => {
    const source = new ProgressSource()
    source.values.set('pty-a', { state: 'normal', value: 42 })

    const { result } = renderHook(() => usePtyProgress(source, 'pty-a'))

    expect(result.current).toEqual({ state: 'normal', value: 42 })
  })

  test('stays unsubscribed while disabled', () => {
    const source = new ProgressSource()
    source.values.set('pty-a', { state: 'normal', value: 42 })

    const { result } = renderHook(() => usePtyProgress(source, 'pty-a', false))

    expect(result.current).toBeUndefined()
    expect(source.pending).toHaveLength(0)

    act(() => source.publish('pty-a', { state: 'normal', value: 80 }))

    expect(result.current).toBeUndefined()
  })

  test('re-reads state after asynchronous subscription setup', async () => {
    const source = new ProgressSource()
    const { result } = renderHook(() => usePtyProgress(source, 'pty-a'))

    source.values.set('pty-a', { state: 'normal', value: 80 })
    await act(async () => {
      source.resolveNext()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(result.current).toEqual({ state: 'normal', value: 80 })
    })
  })

  test('ignores another PTY events', () => {
    const source = new ProgressSource()
    const { result } = renderHook(() => usePtyProgress(source, 'pty-a'))

    act(() => source.publish('pty-b', { state: 'error', value: 85 }))

    expect(result.current).toBeUndefined()
  })

  test('re-seeds and unsubscribes when ptyId changes', async () => {
    const source = new ProgressSource()
    source.values.set('pty-a', { state: 'normal', value: 20 })
    source.values.set('pty-b', { state: 'paused', value: 70 })

    const { result, rerender } = renderHook(
      ({ ptyId }) => usePtyProgress(source, ptyId),
      { initialProps: { ptyId: 'pty-a' } }
    )
    await act(async () => {
      source.resolveNext()
      await Promise.resolve()
    })

    rerender({ ptyId: 'pty-b' })

    await waitFor(() => {
      expect(result.current).toEqual({ state: 'paused', value: 70 })
    })
    expect(source.unsubscribeCount).toBe(1)
  })

  test('unsubscribes when setup resolves after unmount', async () => {
    const source = new ProgressSource()
    const { unmount } = renderHook(() => usePtyProgress(source, 'pty-a'))

    unmount()
    await act(async () => {
      source.resolveNext()
      await Promise.resolve()
    })

    expect(source.unsubscribeCount).toBe(1)
  })
})
