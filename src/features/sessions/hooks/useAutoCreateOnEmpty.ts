import { useEffect, useRef } from 'react'

export interface UseAutoCreateOnEmptyOptions {
  enabled: boolean
  loading: boolean
  hasLiveSession: boolean
  pendingSpawns: number
  createSession: () => void
}

/** Seed exactly one session on clean launch after restore completes.
 *
 *  Retries on spawn failure: the auto-create guard is "have we ever seen
 *  a live session" — not "have we ever attempted auto-create" — so a
 *  failed initial spawn re-fires once `pendingSpawns` drops back to 0.
 *  When `hasLiveSession` first becomes true (via successful auto-create,
 *  manual createSession, or restore), the guard latches permanently so
 *  the user closing all tabs later does not trigger another auto-create
 *  (that would be confusing).
 *
 *  F10 (claude MEDIUM) fix: the previous implementation set the guard
 *  BEFORE the createSession call, so a failed initial spawn left the
 *  workspace permanently empty — contradicting the Round-12 F1 retry
 *  promise. */
export const useAutoCreateOnEmpty = ({
  enabled,
  loading,
  hasLiveSession,
  pendingSpawns,
  createSession,
}: UseAutoCreateOnEmptyOptions): void => {
  // Latches `true` the first time we observe hasLiveSession === true.
  // After that, the effect short-circuits regardless of subsequent
  // session closures (intentional: closing every tab is a user-driven
  // action, not a state to recover from).
  const everHadLiveSessionRef = useRef(false)

  useEffect(() => {
    if (hasLiveSession) {
      everHadLiveSessionRef.current = true
    }
    if (
      !enabled ||
      loading ||
      everHadLiveSessionRef.current ||
      pendingSpawns > 0
    ) {
      return
    }
    if (!hasLiveSession) {
      createSession()
    }
  }, [enabled, loading, hasLiveSession, pendingSpawns, createSession])
}
