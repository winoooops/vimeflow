import { useEffect, useRef } from 'react'
import type { CurrentUsageState } from '../types'
import { cacheHitPercentage } from '../utils/cacheRate'

export interface UseCacheHistoryCollectorArgs {
  ptyId: string | null
  sessionId: string | null
  paneId: string | null
  usage: CurrentUsageState | null
  onReading: (sessionId: string, paneId: string, percentage: number) => void
}

// Emits one reading per changed percentage; resets when the ptyId changes.
export const useCacheHistoryCollector = ({
  ptyId,
  sessionId,
  paneId,
  usage,
  onReading,
}: UseCacheHistoryCollectorArgs): void => {
  const lastRef = useRef<{ ptyId: string | null; pct: number | null }>({
    ptyId: null,
    pct: null,
  })
  const onReadingRef = useRef(onReading)
  onReadingRef.current = onReading

  useEffect(() => {
    if (ptyId === null || sessionId === null || paneId === null) {
      return
    }

    const pct = cacheHitPercentage(usage)
    if (pct === null) {
      return
    }

    const last = lastRef.current
    if (last.ptyId === ptyId && last.pct === pct) {
      return
    }

    lastRef.current = { ptyId, pct }
    onReadingRef.current(sessionId, paneId, pct)
  }, [ptyId, sessionId, paneId, usage])
}
