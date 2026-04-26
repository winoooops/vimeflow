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

/**
 * Handler that receives a buffered PTY event during pane drain.
 * Same signature as the live `pty-data` callback, so callers can reuse
 * a single function (with cursor dedupe) for both buffered drain and
 * live events.
 */
export type PaneEventHandler = (data: string, offsetStart: number) => void

/**
 * Function returned by `notifyPaneReady` — call it on pane unmount or when
 * the subscription is no longer needed. Currently a no-op for the buffer
 * drain side, but reserved for future per-pane teardown.
 */
export type NotifyPaneReadyResult = () => void

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
  /**
   * Called by each TerminalPane (`useTerminal`) once its live `pty-data`
   * subscription is attached. The orchestrator immediately drains any
   * pty-data events buffered for `sessionId` to `handler`, then removes the
   * pane from the pending set; once every pane has reported ready, the
   * mount-time global buffering listener is detached.
   *
   * Without this protocol, the orchestrator would stop buffering as soon as
   * the React state updates (which only schedules a render); events emitted
   * between that point and `useTerminal`'s actual subscription would land in
   * NEITHER the buffer NOR the live stream — silent output loss on busy reloads.
   *
   * The handler is the same function the pane uses for live events, so the
   * cursor dedupe in `useTerminal` skips events whose offsets predate the
   * pane's cursor (avoids doubled writes if a live event arrives between
   * subscription and the drain).
   */
  notifyPaneReady: (
    sessionId: string,
    handler: PaneEventHandler
  ) => NotifyPaneReadyResult
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

  // Refs that bridge the mount-time restore effect (which builds the buffer
  // and the buffering listener) and the notifyPaneReady callback (which
  // panes invoke from their useTerminal effect, possibly several React
  // ticks later). Held outside the effect's closure so notifyPaneReady can
  // see them across renders.
  //
  // F1 (round 2): the buffering listener lives for the ENTIRE lifetime of
  // useSessionManager — no longer torn down once restored panes report ready.
  // Without that, sessions created via createSession after restore had no
  // safety net for the pty-data window between spawn() and useTerminal
  // subscribing — events were silently lost on every fresh tab. Per-session
  // gating now decides whether to buffer:
  //
  //   - sessionId in pendingPanesRef → buffer (pane hasn't attached yet)
  //   - sessionId in readyPanesRef   → drop (per-pane listener handles it)
  //   - neither (unknown session)    → buffer optimistically; the pane will
  //                                    drain on notifyPaneReady. Covers the
  //                                    race where pty-data for a new session
  //                                    arrives before createSession adds it
  //                                    to pendingPanesRef.
  const bufferedRef = useRef<
    Map<string, { data: string; offsetStart: number }[]>
  >(new Map())
  const stopBufferingRef = useRef<(() => void) | null>(null)
  const pendingPanesRef = useRef<Set<string>>(new Set())
  // Sessions whose panes have already attached their per-pane live listener.
  // Events for these sessions are dropped by the global buffering callback
  // — the per-pane onData subscription delivers them directly to xterm.
  const readyPanesRef = useRef<Set<string>>(new Set())

  // Mount-time restore orchestration: listen first, then list_sessions,
  // then KEEP buffering alive until every restored pane reports ready.
  useEffect(() => {
    if (ranRestoreRef.current) {
      return
    }
    ranRestoreRef.current = true

    let cancelled = false

    void (async (): Promise<void> => {
      try {
        // 1. Register global buffering listener and AWAIT its attachment
        //    BEFORE calling list_sessions. The await is critical: TauriTerminalService.onData
        //    only resolves after the underlying tauri.listen('pty-data', ...) is wired up.
        //    Without awaiting, PTY events emitted during the listen()-attach window are
        //    lost from both replay_data AND bufferedEvents (irrecoverable).
        //
        //    F1 (round 2): this listener now stays attached for the lifetime of
        //    useSessionManager so sessions created AFTER restore (createSession)
        //    also benefit from the buffer→drain protocol. Per-session gating
        //    inside the callback (see readyPanesRef) ensures we don't double-
        //    deliver to panes that have already attached their own listener.
        stopBufferingRef.current = await service.onData(
          (sessionId, data, offsetStart) => {
            // Drop events for sessions whose pane has already attached its
            // own per-pane onData subscription — that subscription writes
            // directly to xterm. Buffering would risk re-delivery and
            // unbounded memory growth.
            if (readyPanesRef.current.has(sessionId)) {
              return
            }

            let q = bufferedRef.current.get(sessionId)
            if (!q) {
              q = []
              bufferedRef.current.set(sessionId, q)
            }
            q.push({ data, offsetStart })
          }
        )
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled) {
          stopBufferingRef.current()
          stopBufferingRef.current = null

          return
        }

        // 2. Snapshot sessions
        const list: SessionList = await service.listSessions()
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled) {
          return
        }

        // 3. For each Alive session, prepare restoreData and add to the
        //    pending-pane set. The buffering listener stays attached until
        //    every pane reports ready (see notifyPaneReady below) — without
        //    this, events emitted between setSessions() (which only
        //    *schedules* a render) and useTerminal's subscription land in
        //    neither the buffer nor the live stream.
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
              // Snapshot of buffered events known at restore-time (pre-render).
              // Additional events arriving before the pane subscribes are
              // captured by the buffering listener and drained by notifyPaneReady.
              bufferedEvents: [...(bufferedRef.current.get(info.id) ?? [])],
            })
            pendingPanesRef.current.add(info.id)
            // Repopulate ptySessionMap so agent detection works after reload
            registerPtySession(info.id, info.id, info.cwd)
          }
        }

        // F2 (round 2): MERGE the restore snapshot with any sessions the
        // user added via createSession while loading was still true. The
        // previous wholesale `setSessions(newSessions)` blew away those
        // optimistically-created tabs — the live PTY/cache entry survived
        // in Rust, but the frontend lost track of it until the next reload.
        //
        // Merge order: existing in-memory sessions (added during the load
        // window) come FIRST so they appear at the start of the tab strip,
        // matching the [newSession, ...prev] prepend convention used by
        // createSession. Restored sessions follow in their cached order.
        // This also matches the cache invariant — createSession persists
        // the prepended order via reorderSessions, so the merged in-memory
        // arrangement here matches what the next reload will see.
        setSessions((prev) => {
          const restoredIds = new Set(newSessions.map((s) => s.id))
          const addedDuringLoad = prev.filter((s) => !restoredIds.has(s.id))

          return [...addedDuringLoad, ...newSessions]
        })

        // Active id: prefer an in-memory session created during load (the
        // user's most recent intent) over the cached active id. Falls back
        // to the cached value when no in-flight tabs exist, preserving
        // behavior for the common clean-startup path.
        setActiveSessionIdState(
          (prevActive) => prevActive ?? list.activeSessionId
        )

        setLoading(false)
        // F1 (round 2): no stop-buffering call here. The global listener
        // stays attached for the hook's lifetime so any session created via
        // createSession also benefits from buffer→drain. The listener tears
        // down only on hook unmount (see effect cleanup below).
      } catch (err) {
        // Cache load error or IPC failure — start fresh, but PRESERVE any
        // sessions the user added via createSession during the load window
        // (F2 round-2 alignment). Their PTY/cache entry exists in Rust and
        // wiping them out would orphan the live tab strip until reload.
        // eslint-disable-next-line no-console
        console.warn('listSessions failed; starting empty', err)
        // Leave sessions / activeSessionId untouched — createSession may
        // have already populated them. If nothing was created, they remain
        // at their initial empty values.
        setLoading(false)
        stopBufferingRef.current?.()
        stopBufferingRef.current = null
      }
    })()

    return (): void => {
      cancelled = true
      stopBufferingRef.current?.()
      stopBufferingRef.current = null
    }
  }, [service, restoreData])

  // Drain buffer + remove from pending set when a pane subscribes.
  // Stable ref-only identity so passing this through props doesn't churn deps.
  //
  // F1 (round 2): the global buffering listener now lives for the hook's
  // lifetime, so this function no longer tears it down. Instead, marking
  // a session as `ready` flips the buffer callback's per-session gate so
  // future events are dropped (the per-pane onData subscription handles them).
  const notifyPaneReady = useCallback(
    (sessionId: string, handler: PaneEventHandler): NotifyPaneReadyResult => {
      // Mark the pane ready FIRST so any pty-data event that lands while
      // we're draining lands directly via the per-pane listener (which is
      // already attached by the time notifyPaneReady fires) and bypasses
      // the buffer. Without flipping the gate before the drain, an event
      // arriving mid-loop would be appended to bufferedRef AFTER we already
      // copied it locally — leaking memory across the lifetime of the hook.
      readyPanesRef.current.add(sessionId)
      pendingPanesRef.current.delete(sessionId)

      // Drain any events the buffering listener captured for this session
      // before the pane attached its live listener. The handler is the same
      // function the pane uses for live events (with cursor dedupe), so any
      // event that also arrived live between subscribe and this drain gets
      // filtered by the cursor — no duplicates.
      const events = bufferedRef.current.get(sessionId)
      if (events && events.length > 0) {
        for (const e of events) {
          handler(e.data, e.offsetStart)
        }
        bufferedRef.current.delete(sessionId)
      }

      // Return value is reserved for future per-pane teardown (e.g. unsubscribing
      // a per-pane orchestrator route). Currently a no-op.
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return (): void => {}
    },
    []
  )

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

  // Create session — spawn + prepend, then mark the pane as 'attach'.
  //
  // The PTY is created up-front in this hook (so we get the canonical id and
  // pid for state). We then populate restoreData with empty replay/buffered
  // slots and add the new session to pendingPanesRef so TerminalPane renders
  // in 'attach' mode. Without this the pane would mount with no restoredFrom
  // and TerminalZone's mode-decision rules would route it to the legacy
  // 'spawn' fallback — which calls service.spawn() a SECOND time and
  // creates a hidden duplicate PTY (Codex P1 finding).
  //
  // pendingPanesRef inclusion: pty-data events emitted between
  // service.spawn() resolving and useTerminal subscribing land in the
  // orchestrator's permanent buffering listener (kept alive for the hook's
  // lifetime by F1-round-2) and get drained when the new pane reports ready.
  // Without the permanent listener, fresh tabs created after restore would
  // come up blank until the shell produced more output — early prompts,
  // OSC sequences, and any startup banner would be silently lost.
  const createSession = useCallback((): void => {
    void (async (): Promise<void> => {
      try {
        const result = await service.spawn({
          cwd: '~',
          env: {},
        })

        const now = new Date().toISOString()

        // Populate restoreData with empty replay so TerminalPane attaches
        // instead of spawning a duplicate PTY.
        restoreData.set(result.sessionId, {
          sessionId: result.sessionId,
          cwd: '~',
          pid: result.pid,
          replayData: '',
          replayEndOffset: 0,
          bufferedEvents: [],
        })
        pendingPanesRef.current.add(result.sessionId)

        // F3 (round 2) — derive the persisted order from the latest state,
        // not the closure-captured `sessions`. With the previous code, two
        // rapid createSession() calls before either spawn() resolved would
        // both close over the original (empty) `sessions` array; the second
        // closure's `[result.sessionId, ...sessions.map(...)]` therefore
        // omitted the FIRST new tab, and reorderSessions persisted an order
        // that didn't match the live tab strip. After reload the order was
        // wrong (or `reorder_sessions` rejected the call as a non-permutation,
        // depending on Rust-side validation).
        //
        // Fix: build the new order INSIDE the setSessions functional updater
        // and fire reorderSessions / setActiveSession from the same callback.
        // Both IPCs are idempotent — replaying the same payload is safe under
        // React 18 StrictMode's double-invoke. The same name-from-length
        // calculation also moves inside the updater so two rapid calls produce
        // distinct names ("session 2", "session 3", not "session 2", "session 2").
        setSessions((prev) => {
          const newSession: Session = {
            id: result.sessionId,
            projectId: 'proj-1',
            name: `session ${prev.length + 1}`,
            status: 'running',
            workingDirectory: '~',
            agentType: 'claude-code',
            createdAt: now,
            lastActivityAt: now,
            activity: { ...emptyActivity },
          }

          const next = [newSession, ...prev]
          const newOrder = next.map((s) => s.id)

          // Fire IPC inside the updater so we always see the latest state.
          // setActiveSession persists the new tab as cache.active_session_id;
          // reorderSessions persists the prepend. Both are independent — wrap
          // each in its own catch so a partial failure (e.g. permission denied
          // on the cache file) is logged but the in-memory mirror still wins.
          // eslint-disable-next-line promise/prefer-await-to-then
          service.setActiveSession(result.sessionId).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn(
              'createSession: setActiveSession IPC failed (cache active id will lag)',
              err
            )
          })

          // eslint-disable-next-line promise/prefer-await-to-then
          service.reorderSessions(newOrder).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn(
              'createSession: reorderSessions IPC failed (cache order will lag)',
              err
            )
          })

          return next
        })

        setActiveSessionIdState(result.sessionId)
        registerPtySession(result.sessionId, result.sessionId, '~')
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('spawn failed', err)
      }
    })()
  }, [restoreData, service])

  // Remove session — kill + filter + advance active
  const removeSession = useCallback(
    (id: string): void => {
      void (async (): Promise<void> => {
        try {
          await service.kill({ sessionId: id })

          // F1 (round 2) cleanup: drop the session from the buffering bookkeeping
          // so the global listener doesn't accumulate per-session state for
          // destroyed tabs.
          readyPanesRef.current.delete(id)
          pendingPanesRef.current.delete(id)
          bufferedRef.current.delete(id)
          restoreData.delete(id)

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
    [activeSessionId, service, restoreData]
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
    notifyPaneReady,
  }
}
