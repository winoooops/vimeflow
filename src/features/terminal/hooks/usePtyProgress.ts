import { useEffect, useState } from 'react'
import type { ITerminalService } from '../services/terminalService'
import type { PtyProgress } from '../types'

type ProgressSource = Pick<ITerminalService, 'getProgress' | 'onProgress'>

export const usePtyProgress = (
  service: ProgressSource,
  ptyId: string
): PtyProgress | undefined => {
  const [progress, setProgress] = useState<PtyProgress | undefined>(() =>
    service.getProgress(ptyId)
  )

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    setProgress(service.getProgress(ptyId))

    void (async (): Promise<void> => {
      try {
        const stop = await service.onProgress((sessionId, nextProgress) => {
          if (!cancelled && sessionId === ptyId) {
            setProgress(nextProgress)
          }
        })

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- cleanup can run while the awaited subscription attaches
        if (cancelled) {
          stop()

          return
        }

        unsubscribe = stop
        setProgress(service.getProgress(ptyId))
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- cleanup can run while the awaited subscription rejects
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.warn('usePtyProgress: failed to subscribe', error)
        }
      }
    })()

    return (): void => {
      cancelled = true
      unsubscribe?.()
    }
  }, [ptyId, service])

  return progress
}
