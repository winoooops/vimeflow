import { useEffect, useRef } from 'react'
import type { CurrentUsageState } from '../types'
import { cacheHitPercentage } from '../utils/cacheRate'

export interface UseCacheHistoryCollectorArgs {
  ptyId: string | null
  runId: string | null
  sessionId: string | null
  paneId: string | null
  usage: CurrentUsageState | null
  onReading: (sessionId: string, paneId: string, percentage: number) => void
  onReset: (sessionId: string, paneId: string) => void
}

// Emits one reading per changed percentage; clears history when the agent run
// changes on the same PTY.
export const useCacheHistoryCollector = ({
  ptyId,
  runId,
  sessionId,
  paneId,
  usage,
  onReading,
  onReset,
}: UseCacheHistoryCollectorArgs): void => {
  const lastRef = useRef<{ ptyId: string | null; pct: number | null }>({
    ptyId: null,
    pct: null,
  })

  const lastRunRef = useRef<{ ptyId: string | null; runId: string | null }>({
    ptyId: null,
    runId: null,
  })
  const onReadingRef = useRef(onReading)
  const onResetRef = useRef(onReset)
  onReadingRef.current = onReading
  onResetRef.current = onReset

  useEffect(() => {
    if (
      ptyId === null ||
      runId === null ||
      sessionId === null ||
      paneId === null
    ) {
      return
    }

    const lastRun = lastRunRef.current
    if (
      lastRun.ptyId === ptyId &&
      lastRun.runId !== null &&
      lastRun.runId !== runId
    ) {
      lastRef.current = { ptyId, pct: cacheHitPercentage(usage) }
      onResetRef.current(sessionId, paneId)
    }

    lastRunRef.current = { ptyId, runId }
  }, [ptyId, runId, sessionId, paneId, usage])

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
