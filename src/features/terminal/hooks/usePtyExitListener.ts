import { useEffect, useRef } from 'react'
import type { ITerminalService } from '../services/terminalService'

export interface UsePtyExitListenerOptions {
  service: ITerminalService
  onExit: (ptyId: string) => void
}

/** Subscribe to PTY-exit events for the lifetime of the consumer.
 *
 *  Note on `onExitRef` update: body-assignment (NOT useEffect-based)
 *  mirrors the pattern used by `useSessionRestore` and matches the
 *  pre-paint timing — a useEffect-deferred update would leave a stale
 *  handler reachable for ~16ms after a render that changed `onExit`,
 *  during which a PTY exit event would fire the previous callback. */
export const usePtyExitListener = ({
  service,
  onExit,
}: UsePtyExitListenerOptions): void => {
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  useEffect(() => {
    let subscriptionCancelled = false
    let unsubscribeExit: (() => void) | undefined

    void (async (): Promise<void> => {
      const unsubscribe = await service.onExit((sessionId) => {
        onExitRef.current(sessionId)
      })

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (subscriptionCancelled) {
        unsubscribe()

        return
      }

      unsubscribeExit = unsubscribe
    })()

    return (): void => {
      subscriptionCancelled = true
      unsubscribeExit?.()
    }
  }, [service])
}
