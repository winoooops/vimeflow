import { useState, useCallback, useEffect, useRef } from 'react'
import type { Session, AgentActivity } from '../types'
import type { SessionList, SessionInfo } from '../../../bindings'
import {
  createTerminalService,
  type ITerminalService,
} from '../../terminal/services/terminalService'
import { registerPtySession } from '../../terminal/ptySessionMap'

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

function tabName(cwd: string, index: number): string {
  if (cwd === '~') {
    return `session ${index + 1}`
  }
  const parts = cwd.split('/').filter(Boolean)

  return parts[parts.length - 1] || `session ${index + 1}`
}

function sessionFromInfo(info: SessionInfo, index: number): Session {
  return {
    id: info.id,
    projectId: 'proj-1',
    name: tabName(info.cwd, index),
    status: info.status.kind === 'Alive' ? 'running' : 'completed',
    workingDirectory: info.cwd,
    agentType: 'claude-code',
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    activity: { ...emptyActivity },
  }
}

export interface RestoreData {
  sessionId: string
  cwd: string
  pid: number
  replayData: string
  replayEndOffset: number
  bufferedEvents: { data: string; offsetStart: number }[]
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
  /** restoreData per session id, populated during mount-time restore */
  restoreData: Map<string, RestoreData>
  /** True until the initial restore IPC + drain completes */
  loading: boolean
}

export const useSessionManager = (
  service: ITerminalService = createTerminalService()
): SessionManager => {
  const [sessions, setSessions] = useState<Session[]>([])

  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    null
  )
  const [restoreData] = useState(new Map<string, RestoreData>())
  const [loading, setLoading] = useState(true)

  const ranRestoreRef = useRef(false)

  // Mount-time restore orchestration: listen first, then list_sessions, then drain.
  useEffect(() => {
    if (ranRestoreRef.current) {
      return
    }
    ranRestoreRef.current = true

    let cancelled = false
    const buffered = new Map<string, { data: string; offsetStart: number }[]>()

    // 1. Register global buffering listener BEFORE list_sessions
    const stopBuffering = service.onData((sessionId, data, offsetStart) => {
      let q = buffered.get(sessionId)
      if (!q) {
        q = []
        buffered.set(sessionId, q)
      }
      q.push({ data, offsetStart })
    })

    void (async (): Promise<void> => {
      try {
        // 2. Snapshot sessions
        const list: SessionList = await service.listSessions()
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled) {
          return
        }

        // 3. For each Alive session, prepare restoreData
        const newSessions: Session[] = list.sessions.map((info, idx) =>
          sessionFromInfo(info, idx)
        )
        for (const info of list.sessions) {
          if (info.status.kind === 'Alive') {
            const status = info.status
            restoreData.set(info.id, {
              sessionId: info.id,
              cwd: info.cwd,
              pid: status.pid,
              replayData: status.replay_data,
              replayEndOffset: Number(status.replay_end_offset),
              bufferedEvents: buffered.get(info.id) ?? [],
            })
            // Repopulate ptySessionMap so agent detection works after reload
            registerPtySession(info.id, info.id, info.cwd)
          }
        }

        setSessions(newSessions)
        setActiveSessionIdState(list.activeSessionId)
        setLoading(false)

        // 4. Listener swap happens implicitly: future onData subscribers
        //    in TerminalPane will receive new events. The buffering listener
        //    is removed here.
        stopBuffering()
      } catch (err) {
        // Cache load error or IPC failure — start fresh
        // Surfaced as toast in a future iteration; for now log.
        // eslint-disable-next-line no-console
        console.warn('listSessions failed; starting empty', err)
        setSessions([])
        setActiveSessionIdState(null)
        setLoading(false)
        stopBuffering()
      }
    })()

    return (): void => {
      cancelled = true
      stopBuffering()
    }
  }, [service, restoreData])

  // Active session — optimistic update + IPC
  const setActiveSessionId = useCallback(
    (id: string): void => {
      const prev = activeSessionId
      setActiveSessionIdState(id)
      // eslint-disable-next-line promise/prefer-await-to-then
      service.setActiveSession(id).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('setActiveSession IPC failed; reverting', err)
        setActiveSessionIdState(prev)
      })
    },
    [activeSessionId, service]
  )

  // Create session — spawn + prepend
  const createSession = useCallback((): void => {
    void (async (): Promise<void> => {
      try {
        const result = await service.spawn({
          cwd: '~',
          env: {},
        })

        const now = new Date().toISOString()

        const newSession: Session = {
          id: result.sessionId,
          projectId: 'proj-1',
          name: `session ${sessions.length + 1}`,
          status: 'running',
          workingDirectory: '~',
          agentType: 'claude-code',
          createdAt: now,
          lastActivityAt: now,
          activity: { ...emptyActivity },
        }
        setSessions((prev) => [newSession, ...prev])
        setActiveSessionIdState(result.sessionId)
        registerPtySession(result.sessionId, result.sessionId, '~')
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('spawn failed', err)
      }
    })()
  }, [service, sessions.length])

  // Remove session — kill + filter + advance active
  const removeSession = useCallback(
    (id: string): void => {
      void (async (): Promise<void> => {
        try {
          await service.kill({ sessionId: id })

          setSessions((prev) => {
            const next = prev.filter((s) => s.id !== id)

            // If we removed the active session, pick a neighbor
            if (activeSessionId === id) {
              const removedIndex = prev.findIndex((s) => s.id === id)

              const fallback =
                next[Math.min(removedIndex, next.length - 1)]?.id ?? null
              setActiveSessionIdState(fallback)
            }

            return next
          })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('kill failed', err)
        }
      })()
    },
    [activeSessionId, service]
  )

  // Rename session — in-memory only (no IPC)
  const renameSession = useCallback((id: string, name: string): void => {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      return
    }

    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: trimmed } : s))
    )
  }, [])

  // Reorder sessions — optimistic update + IPC
  const reorderSessions = useCallback(
    (reordered: Session[]): void => {
      const prev = sessions
      setSessions(reordered)
      const ids = reordered.map((s) => s.id)
      // eslint-disable-next-line promise/prefer-await-to-then
      service.reorderSessions(ids).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('reorderSessions IPC failed; reverting', err)
        setSessions(prev)
      })
    },
    [service, sessions]
  )

  // Update session cwd — optimistic update + IPC
  const updateSessionCwd = useCallback(
    (id: string, cwd: string): void => {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, workingDirectory: cwd } : s))
      )

      // eslint-disable-next-line promise/prefer-await-to-then
      service.updateSessionCwd(id, cwd).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('updateSessionCwd IPC failed', err)
      })
    },
    [service]
  )

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createSession,
    removeSession,
    renameSession,
    reorderSessions,
    updateSessionCwd,
    restoreData,
    loading,
  }
}
