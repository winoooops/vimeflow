import { useEffect, useRef } from 'react'

export interface UseAutoCreateOnEmptyOptions {
  enabled: boolean
  loading: boolean
  hasLiveSession: boolean
  pendingSpawns: number
  createSession: () => void
}

/** Seed exactly one session on clean launch after restore completes. */
export const useAutoCreateOnEmpty = ({
  enabled,
  loading,
  hasLiveSession,
  pendingSpawns,
  createSession,
}: UseAutoCreateOnEmptyOptions): void => {
  const didInitialAutoCreateRef = useRef(false)

  useEffect(() => {
    if (!enabled || loading || didInitialAutoCreateRef.current) {
      return
    }
    if (pendingSpawns > 0) {
      return
    }
    didInitialAutoCreateRef.current = true
    if (!hasLiveSession) {
      createSession()
    }
  }, [enabled, loading, hasLiveSession, pendingSpawns, createSession])
}
