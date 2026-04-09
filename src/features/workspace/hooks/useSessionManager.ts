import { useState, useCallback } from 'react'
import type { Session, AgentActivity } from '../types'
import { disposeTerminalSession } from '../../terminal/components/TerminalPane'

const emptyActivity: AgentActivity = {
  fileChanges: [],
  toolCalls: [],
  testResults: [],
  contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
  usage: {
    sessionDuration: 0,
    turnCount: 0,
    messages: { sent: 0, limit: 200 },
    tokens: { input: 0, output: 0, total: 0 },
  },
}

const defaultSession: Session = {
  id: 'sess-1',
  projectId: 'proj-1',
  name: 'session 1',
  status: 'running',
  workingDirectory: '~',
  agentType: 'claude-code',
  createdAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  activity: { ...emptyActivity },
}

export interface SessionManager {
  sessions: Session[]
  activeSessionId: string | null
  setActiveSessionId: (id: string) => void
  createSession: () => void
  removeSession: (id: string) => void
  renameSession: (id: string, name: string) => void
  reorderSessions: (reordered: Session[]) => void
  updateSessionCwd: (id: string, cwd: string) => void
}

export const useSessionManager = (): SessionManager => {
  const [sessions, setSessions] = useState<Session[]>([defaultSession])

  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    defaultSession.id
  )

  const createSession = useCallback((): void => {
    const id = crypto.randomUUID()

    setSessions((prev) => {
      const now = new Date().toISOString()

      const newSession: Session = {
        id,
        projectId: 'proj-1',
        name: `session ${prev.length + 1}`,
        status: 'running',
        workingDirectory: '~',
        agentType: 'claude-code',
        createdAt: now,
        lastActivityAt: now,
        activity: { ...emptyActivity },
      }

      return [newSession, ...prev]
    })
    setActiveSessionId(id)
  }, [])

  const removeSession = useCallback(
    (id: string): void => {
      disposeTerminalSession(id)

      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id)

        // If we removed the active session, pick a neighbor
        if (activeSessionId === id) {
          const removedIndex = prev.findIndex((s) => s.id === id)

          const fallback =
            next[Math.min(removedIndex, next.length - 1)]?.id ?? null
          // Use setTimeout to avoid state update during render
          setTimeout(() => setActiveSessionId(fallback), 0)
        }

        return next
      })
    },
    [activeSessionId]
  )

  const renameSession = useCallback((id: string, name: string): void => {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      return
    }

    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: trimmed } : s))
    )
  }, [])

  const reorderSessions = useCallback((reordered: Session[]): void => {
    setSessions(reordered)
  }, [])

  const updateSessionCwd = useCallback((id: string, cwd: string): void => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, workingDirectory: cwd } : s))
    )
  }, [])

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createSession,
    removeSession,
    renameSession,
    reorderSessions,
    updateSessionCwd,
  }
}
