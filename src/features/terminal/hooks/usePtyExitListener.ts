import { useEffect, useRef } from 'react'
import type { ITerminalService } from '../services/terminalService'

export interface UsePtyExitListenerOptions {
  service: ITerminalService
  onExit: (ptyId: string) => void
}

/** Subscribe to PTY-exit events for the lifetime of the consumer. */
export const usePtyExitListener = ({
  service,
  onExit,
}: UsePtyExitListenerOptions): void => {
  const onExitRef = useRef(onExit)

  useEffect(() => {
    onExitRef.current = onExit
  }, [onExit])

  useEffect(() => {
    const unsubscribe = service.onExit((sessionId) => {
      onExitRef.current(sessionId)
    })

    return (): void => {
      unsubscribe()
    }
  }, [service])
}
