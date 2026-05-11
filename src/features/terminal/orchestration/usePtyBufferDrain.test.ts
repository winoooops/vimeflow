import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { usePtyBufferDrain } from './usePtyBufferDrain'

describe('usePtyBufferDrain', () => {
  test('bufferEvent collects events for pending sessions', () => {
    const { result } = renderHook(() => usePtyBufferDrain())

    result.current.registerPending('pty-1')
    result.current.bufferEvent('pty-1', 'hello', 0, 5)
    result.current.bufferEvent('pty-1', 'world', 5, 5)

    expect(result.current.getBufferedSnapshot('pty-1')).toEqual([
      { data: 'hello', offsetStart: 0, byteLen: 5 },
      { data: 'world', offsetStart: 5, byteLen: 5 },
    ])
  })

  test('bufferEvent drops events for ready sessions', () => {
    const { result } = renderHook(() => usePtyBufferDrain())
    const handler = vi.fn()

    result.current.registerPending('pty-1')
    result.current.notifyPaneReady('pty-1', handler)
    result.current.bufferEvent('pty-1', 'after-ready', 0, 11)

    expect(result.current.getBufferedSnapshot('pty-1')).toEqual([])
  })

  test('notifyPaneReady drains buffered events to handler', () => {
    const { result } = renderHook(() => usePtyBufferDrain())
    const handler = vi.fn()

    result.current.registerPending('pty-1')
    result.current.bufferEvent('pty-1', 'first', 0, 5)
    result.current.bufferEvent('pty-1', 'second', 5, 6)

    result.current.notifyPaneReady('pty-1', handler)

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenNthCalledWith(1, 'first', 0, 5)
    expect(handler).toHaveBeenNthCalledWith(2, 'second', 5, 6)
  })

  test('notifyPaneReady cleanup re-arms pending state on remount', () => {
    const { result } = renderHook(() => usePtyBufferDrain())
    const handler = vi.fn()

    result.current.registerPending('pty-1')
    const release = result.current.notifyPaneReady('pty-1', handler)

    release()
    result.current.bufferEvent('pty-1', 'post-cleanup', 0, 12)

    expect(result.current.getBufferedSnapshot('pty-1')).toEqual([
      { data: 'post-cleanup', offsetStart: 0, byteLen: 12 },
    ])
  })

  test('dropAllForPty clears bookkeeping for one pty', () => {
    const { result } = renderHook(() => usePtyBufferDrain())

    result.current.registerPending('pty-1')
    result.current.bufferEvent('pty-1', 'leak', 0, 4)
    result.current.dropAllForPty('pty-1')

    expect(result.current.getBufferedSnapshot('pty-1')).toEqual([])
  })
})
