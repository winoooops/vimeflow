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

  // F6 (claude MEDIUM) regression: a late pty-data event arriving AFTER
  // dropAllForPty must not re-populate bufferedRef and must not let the
  // pane-unmount cleanup re-arm pending state (the prior implementation
  // leaked one entry per removed session).
  test('tombstones a dropped ptyId so late events + cleanup do not re-arm', () => {
    const { result } = renderHook(() => usePtyBufferDrain())
    const handler = vi.fn()
    const lateHandler = vi.fn()

    result.current.registerPending('pty-1')
    const release = result.current.notifyPaneReady('pty-1', handler)

    // Session removed.
    result.current.dropAllForPty('pty-1')

    // Late pty-data event from Rust — must be dropped, not buffered.
    result.current.bufferEvent('pty-1', 'late', 0, 4)
    expect(result.current.getBufferedSnapshot('pty-1')).toEqual([])

    // Pane unmount cleanup fires. Tombstone makes isStillTracked false,
    // no re-arm — pendingPanesRef stays empty for the dead pty.
    release()
    expect(result.current.getBufferedSnapshot('pty-1')).toEqual([])

    // A subsequent (incorrect) notifyPaneReady on the tombstoned id is
    // a no-op: the handler is never invoked, and the returned release
    // is a no-op too.
    const release2 = result.current.notifyPaneReady('pty-1', lateHandler)
    expect(lateHandler).not.toHaveBeenCalled()
    release2()
    expect(result.current.getBufferedSnapshot('pty-1')).toEqual([])
  })
})
