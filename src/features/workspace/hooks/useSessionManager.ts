import { useState, useCallback, useEffect, useRef } from 'react'
import type { Session, AgentActivity } from '../types'
import type { SessionList, SessionInfo } from '../../../bindings'
import type { ITerminalService } from '../../terminal/services/terminalService'
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
  /**
   * Restart an Exited session in the same cwd. Idempotent on the kill side:
   * any remaining cache entry for `id` is killed (no-op if already gone),
   * then a new PTY is spawned at the cached cwd. The React-state entry is
   * replaced with metadata for the new session — status flips to 'running'
   * and id is the new sessionId returned by spawn.
   *
   * No-op if the id isn't in `sessions`. Surfaces spawn errors via
   * console.warn — a future iteration may surface as a toast.
   */
  restartSession: (id: string) => void
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

/**
 * Manage the session list, restore data, and tab orchestration for the
 * workspace.
 *
 * Round 4, Finding 1 (codex P1): `service` is now REQUIRED. Previously the
 * default `service = createTerminalService()` was evaluated on every render.
 * Under Tauri this happened to work because `createTerminalService` returns
 * a singleton bound to Tauri IPC — every call resolved to the same backend.
 * In the browser/Vite/test workflow, however, `createTerminalService` returns
 * a FRESH `MockTerminalService` per call, so each render gave the hook a
 * different backend than the one each `TerminalPane` resolved separately —
 * the tabs spawned by the manager and the panes that should attach to them
 * lived in disjoint state, so attach/restart/close all silently no-op'd.
 *
 * The single-source-of-truth fix: callers create the service once at the
 * top of the tree (e.g. `WorkspaceView` via `useMemo`) and pass the same
 * instance to both `useSessionManager` and every `TerminalPane`. Removing
 * the default arg makes the wiring impossible to forget.
 */
export const useSessionManager = (
  service: ITerminalService
): SessionManager => {
  const [sessions, setSessions] = useState<Session[]>([])

  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    null
  )
  const [restoreData] = useState(new Map<string, RestoreData>())
  const [loading, setLoading] = useState(true)

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
  //
  // Note: under React 18 StrictMode dev, this effect runs twice (mount →
  // cleanup → mount). The previous `ranRestoreRef` short-circuit blocked
  // the second invocation from completing, but the FIRST invocation's
  // cancelled-abort path skipped `setLoading(false)` — so loading was
  // stuck on "Restoring sessions..." forever in dev. Removed the guard;
  // both invocations now run, and the second one reaches setLoading(false)
  // normally. The first invocation's listener gets unsubscribed in its
  // cancelled-abort branch (line below), so the second invocation's
  // listener is the durable one.
  useEffect(() => {
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

  // Round 3 (codex P2 follow-up to Finding 3): mark sessions completed when
  // their PTY exits. The mode-precedence fix in TerminalZone (status-first)
  // depends on `session.status === 'completed'` flipping when the shell
  // terminates after mount — without an onExit listener at the orchestrator
  // level, status stays at 'running' and the Restart UX never appears until
  // a full reload rebuilds state from listSessions().
  //
  // Lifecycle: subscribed for the entire useSessionManager lifetime so
  // sessions created via createSession (post-restore) also flip status on
  // exit. Idempotent — flipping an already-completed session to completed
  // is a no-op. Unsubscribes on unmount via the returned cleanup.
  useEffect(() => {
    const unsubscribeExit = service.onExit((sessionId) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, status: 'completed' } : s
        )
      )
    })

    return (): void => {
      unsubscribeExit()
    }
  }, [service])

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
        // Use the resolved absolute cwd from spawn (e.g. /home/will), not
        // the literal '~' we passed in — many shells don't emit OSC 7 on
        // first prompt, so without this, useGitStatus and the agent-status
        // panel sit idle until the user manually `cd`s.
        restoreData.set(result.sessionId, {
          sessionId: result.sessionId,
          cwd: result.cwd,
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
            // Use spawn's resolved absolute cwd, not '~'. useGitStatus,
            // tab-name derivation, and the diff/agent panes all need an
            // absolute path; relying on OSC 7 to backfill leaves them
            // idle for shells that don't emit it on first prompt.
            name: `session ${prev.length + 1}`,
            status: 'running',
            workingDirectory: result.cwd,
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

          // F4 (round 2): when the user closes the ACTIVE tab and the hook
          // promotes a neighbor, the cache must learn about it too. Without
          // setActiveSession the Rust kill_pty path rotates active to the
          // FIRST remaining tab (cache.session_order[0]) — but the React
          // state moved to the index-aligned neighbor (Math.min(removedIndex,
          // next.length - 1)). After reload the restored selection diverges
          // from where the UI actually moved.
          //
          // Derive the fallback inside the setSessions updater so the
          // computation matches the React-state branch and races with
          // concurrent createSession/removeSession calls are resolved
          // against the latest state.
          setSessions((prev) => {
            const next = prev.filter((s) => s.id !== id)

            // If we removed the active session, pick a neighbor
            if (activeSessionId === id) {
              const removedIndex = prev.findIndex((s) => s.id === id)

              // next.length is 0 when the LAST tab was just removed; that's
              // the only case `fallback` is null. Compute defensively so the
              // empty-tabs path still drains React state to null without
              // firing a setActiveSession IPC (Rust's kill_pty already
              // cleared cache.active_session_id when session_order emptied).
              const fallback: string | null =
                next.length === 0
                  ? null
                  : next[Math.min(removedIndex, next.length - 1)].id

              setActiveSessionIdState(fallback)

              // Fire setActiveSession IPC inside the updater so the cache's
              // active id matches the React-state choice. Idempotent — safe
              // under StrictMode double-invoke.
              if (fallback !== null) {
                // eslint-disable-next-line promise/prefer-await-to-then
                service.setActiveSession(fallback).catch((err) => {
                  // eslint-disable-next-line no-console
                  console.warn(
                    'removeSession: setActiveSession IPC failed (cache active id will lag)',
                    err
                  )
                })
              }
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

  // Use a ref to read the latest sessions inside the async closure without
  // making the callback's identity depend on `sessions` (which would churn
  // every render that tabs change). The `prev` snapshot from setSessions
  // wouldn't help here because the restart ID needs to be looked up before
  // the setState updater runs.
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  // F5 (round 2): restart an Exited session in the same cwd.
  //
  // Round 4, Finding 2 (codex P2): SPAWN-THEN-KILL ordering. The previous
  // kill-then-spawn flow removed the old session from cache.sessions and
  // cache.session_order BEFORE we knew the spawn would succeed. If the
  // user restarted a tab whose cwd no longer existed (rm -rf, branch
  // switch, etc.), spawn returned an error and the React tab stayed
  // visible as `completed`, but the backend had already forgotten it —
  // the next reload silently dropped the tab and any later IPC against
  // the old id rejected as unknown.
  //
  // Spawn-first means: if spawn fails, the OLD session still exists in
  // the cache (still `exited: true`, still restorable later — the user
  // can recover by fixing the cwd and clicking Restart again, or by
  // using a different tab). If spawn succeeds, we then kill the old —
  // safe because the new session is already alive. The only caveat is
  // that during the spawn the cache briefly contains BOTH ids (old as
  // exited, new as alive), which is harmless: list_sessions still
  // returns the right set and the in-memory React state replaces the
  // old entry atomically once spawn resolves.
  //
  // Flow (spawn-then-kill):
  //   1. Look up cached cwd for the exited tab from React state
  //   2. service.spawn({ cwd: cachedCwd }) — gets a fresh sessionId/pid;
  //      bail early if it fails (old session preserved)
  //   3. service.kill(oldId) — only after the new PTY exists; idempotent
  //   4. Replace the old session in React state with the new metadata
  //   5. If the restarted tab was active, refresh activeSessionId + IPC
  //   6. Seed restoreData with empty replay so TerminalPane attaches
  //      instead of triggering the legacy spawn fallback
  //
  // The new session id differs from the old one — Rust's spawn_pty
  // assigns a fresh UUID. Callers (TerminalPane) re-render with the new
  // id and useTerminal mounts a fresh attach lifecycle.
  const restartSession = useCallback(
    (id: string): void => {
      void (async (): Promise<void> => {
        const oldSession = sessionsRef.current.find((s) => s.id === id)
        if (!oldSession) {
          // eslint-disable-next-line no-console
          console.warn(`restartSession: no session with id ${id}`)

          return
        }

        const cachedCwd = oldSession.workingDirectory

        // 1. Spawn fresh PTY at the cached cwd FIRST. If this fails (cwd
        // deleted, permission denied, session cap hit), we bail BEFORE
        // touching any cache state for the old id — the old session
        // stays intact, still restorable on a later attempt. Round 4
        // Finding 2: previously we killed the old id before spawn, so a
        // failed spawn left the React tab visible but the backend cache
        // gone — the tab silently disappeared on the next reload.
        let result: { sessionId: string; pid: number; cwd?: string }
        try {
          result = await service.spawn({ cwd: cachedCwd, env: {} })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            'restartSession: spawn failed; old session preserved',
            err
          )

          return
        }

        // 2. Now that the new PTY exists, retire the old. kill_pty is
        // idempotent in Rust (no error if already gone — common case for
        // an Exited tab whose process is already cleaned up). Failures
        // here are non-fatal: the new session is already alive and the
        // old will get cleaned up on the next reload via lazy
        // reconciliation. Drop frontend bookkeeping for the old id
        // regardless so the buffer doesn't accumulate stale entries.
        try {
          await service.kill({ sessionId: id })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            'restartSession: kill of old id failed (continuing)',
            err
          )
        }

        readyPanesRef.current.delete(id)
        pendingPanesRef.current.delete(id)
        bufferedRef.current.delete(id)
        restoreData.delete(id)

        // 3. Seed restoreData so TerminalPane mounts in 'attach' mode
        // instead of falling through to the legacy spawn path (which would
        // create a hidden duplicate PTY — the F3 / round-1 bug).
        restoreData.set(result.sessionId, {
          sessionId: result.sessionId,
          cwd: cachedCwd,
          pid: result.pid,
          replayData: '',
          replayEndOffset: 0,
          bufferedEvents: [],
        })
        pendingPanesRef.current.add(result.sessionId)
        registerPtySession(result.sessionId, result.sessionId, cachedCwd)

        const wasActive = activeSessionId === id

        // 4. Replace the old session entry with new metadata. Inside the
        // setSessions updater so it races correctly against any concurrent
        // create/remove operations. Preserve the in-memory position by
        // mapping over `prev` rather than filter+push.
        //
        // Round 3, Finding 2 (codex P1): also fire reorderSessions IPC from
        // inside the updater. Without this, kill_pty in Rust REMOVES the
        // old id from cache.session_order and spawn_pty APPENDS the
        // replacement id at the end, so a restarted middle tab would render
        // as `[A, fresh, C]` in the live UI but persist as
        // `[A, C, fresh]` in cache.session_order. After a reload the
        // restored order would diverge from the live UI. Same pattern as
        // round-2 F4's createSession fix: derive the persisted order from
        // `next` (latest state) inside setSessions and fire the IPC there.
        setSessions((prev) => {
          const idx = prev.findIndex((s) => s.id === id)
          if (idx === -1) {
            // The session was removed between the spawn() and now. Discard
            // the orphan PTY by killing it; React state stays as-is.
            // eslint-disable-next-line promise/prefer-await-to-then,@typescript-eslint/no-empty-function
            service.kill({ sessionId: result.sessionId }).catch((): void => {})

            return prev
          }

          const next = [...prev]
          next[idx] = {
            ...prev[idx],
            id: result.sessionId,
            status: 'running',
            // workingDirectory unchanged — restart preserves cwd by spec
            lastActivityAt: new Date().toISOString(),
          }

          // Push the post-restart order back to Rust so cache.session_order
          // reflects the in-memory position (not the kill-removes-then-
          // spawn-appends order Rust would otherwise end up with). Fire
          // inside the updater so the payload always derives from the
          // latest state — same race-safety pattern as createSession (F4).
          const newOrder = next.map((s) => s.id)
          // eslint-disable-next-line promise/prefer-await-to-then
          service.reorderSessions(newOrder).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn(
              'restartSession: reorderSessions IPC failed (cache order will lag)',
              err
            )
          })

          return next
        })

        // 5. If the restarted tab was active, the React-state id moved.
        // Update active to the new id and tell Rust about it.
        if (wasActive) {
          setActiveSessionIdState(result.sessionId)
          try {
            await service.setActiveSession(result.sessionId)
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              'restartSession: setActiveSession IPC failed (cache active id will lag)',
              err
            )
          }
        }
      })()
    },
    [activeSessionId, restoreData, service]
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
    restartSession,
    renameSession,
    reorderSessions,
    updateSessionCwd,
    restoreData,
    loading,
    notifyPaneReady,
  }
}
