import { useCallback, useRef } from 'react'
import type { NotifyPaneReadyResult, PaneEventHandler } from '../types'

interface BufferedEvent {
  data: string
  offsetStart: number
  byteLen: number
}

export interface PtyBufferDrain {
  bufferEvent: (
    ptyId: string,
    data: string,
    offsetStart: number,
    byteLen: number
  ) => void
  notifyPaneReady: (
    ptyId: string,
    handler: PaneEventHandler
  ) => NotifyPaneReadyResult
  registerPending: (ptyId: string) => void
  getBufferedSnapshot: (ptyId: string) => BufferedEvent[]
  dropAllForPty: (ptyId: string) => void
}

export const usePtyBufferDrain = (): PtyBufferDrain => {
  const bufferedRef = useRef(new Map<string, BufferedEvent[]>())
  const pendingPanesRef = useRef(new Set<string>())
  const readyPanesRef = useRef(new Set<string>())
  // F6 (claude MEDIUM): tombstones for ptyIds whose session has been
  // removed via dropAllForPty. PTY-exit / pty-data events can race the
  // kill IPC and arrive AFTER cleanup; without tombstones they would
  // re-populate bufferedRef, then the notifyPaneReady release would see
  // `isStillTracked === true` and re-arm the dead pane, leaking
  // bookkeeping forever. The tombstone set bounds itself by the number
  // of sessions removed during the app lifetime (typically O(tens)).
  // PTY ids are not reused — Rust generates fresh UUIDs per spawn — so
  // permanent tombstoning is safe.
  const tombstonedPanesRef = useRef(new Set<string>())

  const bufferEvent = useCallback<PtyBufferDrain['bufferEvent']>(
    (ptyId, data, offsetStart, byteLen) => {
      if (
        tombstonedPanesRef.current.has(ptyId) ||
        readyPanesRef.current.has(ptyId)
      ) {
        return
      }

      let queue = bufferedRef.current.get(ptyId)
      if (!queue) {
        queue = []
        bufferedRef.current.set(ptyId, queue)
      }
      queue.push({ data, offsetStart, byteLen })
    },
    []
  )

  const notifyPaneReady = useCallback<PtyBufferDrain['notifyPaneReady']>(
    (ptyId, handler) => {
      // F6: dead pane already tombstoned — caller's xterm subscription is
      // a no-op for this id, drain nothing, return a no-op release so
      // the pane unmount cleanup doesn't re-arm pending state.
      if (tombstonedPanesRef.current.has(ptyId)) {
        return (): void => undefined
      }

      readyPanesRef.current.add(ptyId)
      pendingPanesRef.current.delete(ptyId)

      const events = bufferedRef.current.get(ptyId)
      if (events && events.length > 0) {
        for (const event of events) {
          handler(event.data, event.offsetStart, event.byteLen)
        }
        bufferedRef.current.delete(ptyId)
      }

      return (): void => {
        const isStillTracked =
          !tombstonedPanesRef.current.has(ptyId) &&
          (readyPanesRef.current.has(ptyId) ||
            pendingPanesRef.current.has(ptyId) ||
            bufferedRef.current.has(ptyId))
        if (!isStillTracked) {
          return
        }

        readyPanesRef.current.delete(ptyId)
        pendingPanesRef.current.add(ptyId)
        if (!bufferedRef.current.has(ptyId)) {
          bufferedRef.current.set(ptyId, [])
        }
      }
    },
    []
  )

  const registerPending = useCallback<PtyBufferDrain['registerPending']>(
    (ptyId) => {
      // F6: refuse to track a tombstoned id (e.g. a kill-then-respawn
      // race where Rust DID reuse an id — guard for it anyway).
      if (tombstonedPanesRef.current.has(ptyId)) {
        return
      }
      pendingPanesRef.current.add(ptyId)
    },
    []
  )

  const getBufferedSnapshot = useCallback<
    PtyBufferDrain['getBufferedSnapshot']
  >((ptyId) => [...(bufferedRef.current.get(ptyId) ?? [])], [])

  const dropAllForPty = useCallback<PtyBufferDrain['dropAllForPty']>(
    (ptyId) => {
      // F6: tombstone FIRST so any racing pty-data event arriving between
      // here and Rust's actual kill is dropped on the floor instead of
      // re-populating bufferedRef.
      tombstonedPanesRef.current.add(ptyId)
      readyPanesRef.current.delete(ptyId)
      pendingPanesRef.current.delete(ptyId)
      bufferedRef.current.delete(ptyId)
    },
    []
  )

  return {
    bufferEvent,
    notifyPaneReady,
    registerPending,
    getBufferedSnapshot,
    dropAllForPty,
  }
}
