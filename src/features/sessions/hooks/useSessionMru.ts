import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '../types'
import { getVisibleSessions } from '../utils/pickNextVisibleSessionId'

export interface UseSessionMruParams {
  sessions: Session[]
  activeSessionId: string | null
}

export interface SessionMru {
  mruSessionIds: readonly string[]
  recordActivationCommitted: (id: string) => void
}

// MRU folds over committed state only; activation reorders arrive via the
// controller's committed notification, never by observing optimistic writes.
export const useSessionMru = ({
  sessions,
  activeSessionId,
}: UseSessionMruParams): SessionMru => {
  const [mruSessionIds, setMruSessionIds] = useState<readonly string[]>([])
  const seededRef = useRef(false)
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  useEffect(() => {
    if (!seededRef.current) {
      if (sessions.length === 0) {
        return
      }
      seededRef.current = true
      const visible = getVisibleSessions(sessions, activeSessionId)

      const rest = visible
        .map((s) => s.id)
        .filter((id) => id !== activeSessionId)
      setMruSessionIds(
        activeSessionId !== null ? [activeSessionId, ...rest] : rest
      )

      return
    }

    setMruSessionIds((prev) => {
      const known = new Set(prev)
      const live = new Set(sessions.map((s) => s.id))
      const kept = prev.filter((id) => live.has(id))
      const appended = sessions.map((s) => s.id).filter((id) => !known.has(id))

      // Keep the previous identity when unchanged to avoid a render loop.
      if (kept.length === prev.length && appended.length === 0) {
        return prev
      }

      return [...kept, ...appended]
    })
  }, [sessions, activeSessionId])

  const recordActivationCommitted = useCallback((id: string): void => {
    if (!sessionsRef.current.some((s) => s.id === id)) {
      return
    }

    setMruSessionIds((prev) => [id, ...prev.filter((other) => other !== id)])
  }, [])

  return { mruSessionIds, recordActivationCommitted }
}
