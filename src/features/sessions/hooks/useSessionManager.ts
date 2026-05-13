import { useState, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import type { LayoutId, Pane, Session } from '../types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import { LAYOUTS } from '../../terminal/components/SplitView/layouts'
import type {
  RestoreData,
  PaneEventHandler,
  NotifyPaneReadyResult,
} from '../../terminal/types'
import {
  registerPtySession,
  unregisterPtySession,
} from '../../terminal/ptySessionMap'
import { usePtyBufferDrain } from '../../terminal/orchestration/usePtyBufferDrain'
import { emptyActivity } from '../constants'
import {
  applyActivePane,
  findActivePane,
  getActivePane,
} from '../utils/activeSessionPane'
import {
  applyAddPane,
  applyRemovePane,
  nextFreePaneId,
} from '../utils/paneLifecycle'
import { deriveSessionStatus } from '../utils/sessionStatus'
import { usePtyExitListener } from '../../terminal/hooks/usePtyExitListener'
import { useAutoCreateOnEmpty } from './useAutoCreateOnEmpty'
import { useActiveSessionController } from './useActiveSessionController'
import { useSessionRestore } from './useSessionRestore'

export type { RestoreData, PaneEventHandler, NotifyPaneReadyResult }

export interface SessionManager {
  sessions: Session[]
  activeSessionId: string | null
  setActiveSessionId: (id: string) => void
  createSession: () => void
  removeSession: (id: string) => void
  setSessionLayout: (sessionId: string, layoutId: LayoutId) => void
  setSessionActivePane: (sessionId: string, paneId: string) => void
  addPane: (sessionId: string) => void
  removePane: (sessionId: string, paneId: string) => void
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
  updatePaneCwd: (sessionId: string, paneId: string, cwd: string) => void
  updatePaneAgentType: (
    sessionId: string,
    paneId: string,
    agentType: Session['agentType']
  ) => void
  /** Compatibility wrapper until workspace consumers migrate to pane ids. */
  updateSessionCwd: (id: string, cwd: string) => void
  /** Compatibility wrapper until workspace consumers migrate to pane ids. */
  updateSessionAgentType: (id: string, agentType: Session['agentType']) => void
  /** restoreData per session id, populated during mount-time restore. */
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
    ptyId: string,
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
/**
 * Optional per-instance overrides for the session manager.
 *
 * `autoCreateOnEmpty` controls whether `useSessionManager` fires
 * `createSession()` once if the initial restore resolves with zero sessions
 * (clean first launch with no cached tabs). Default `true` — the user
 * always sees at least one TerminalPane on launch instead of an empty
 * "click + to create" prompt. Tests that want to assert empty-state
 * behavior pass `false` to suppress the auto-create.
 */
export interface UseSessionManagerOptions {
  autoCreateOnEmpty?: boolean
}

export const useSessionManager = (
  service: ITerminalService,
  options: UseSessionManagerOptions = {}
): SessionManager => {
  const { autoCreateOnEmpty = true } = options

  const [sessions, setSessions] = useState<Session[]>([])
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const {
    activeSessionId,
    setActiveSessionId,
    setActiveSessionIdRaw,
    activeSessionIdRef,
  } = useActiveSessionController({ service, sessionsRef })
  // Round 12, Finding 2 (claude MEDIUM): restoreData is a mutable
  // side-channel, NOT React state. The previous `useState(new Map())`
  // was misleading — Map mutations via .set/.delete don't notify React,
  // and the UI only "saw" changes because every call site happened to
  // pair its mutation with a setSessions call. Future call sites might
  // forget the pairing. Promoting to useRef makes the design intent
  // explicit: restoreData is read by consumers (TerminalZone) but
  // changes are coordinated by the sessions array, never by Map identity.
  const restoreDataRef = useRef(new Map<string, RestoreData>())

  const buffer = usePtyBufferDrain()
  const { notifyPaneReady, registerPending, dropAllForPty } = buffer

  const { loading } = useSessionRestore({
    service,
    buffer,
    onRestore: (restored): void => {
      for (const session of restored) {
        for (const pane of session.panes) {
          if (pane.restoreData) {
            restoreDataRef.current.set(pane.ptyId, pane.restoreData)
          }
        }
      }

      flushSync(() => {
        setSessions((prev) => {
          const inMemoryPtyIds = new Set(
            prev.flatMap((session) => session.panes.map((pane) => pane.ptyId))
          )

          const restoredOnly = restored.filter(
            (session) =>
              !session.panes.some((pane) => inMemoryPtyIds.has(pane.ptyId))
          )

          return [...prev, ...restoredOnly]
        })
      })
    },
    onActiveResolved: (id): void => {
      if (activeSessionIdRef.current === null) {
        setActiveSessionIdRaw(id)
      }
    },
    onActiveFallback: (id): void => {
      if (activeSessionIdRef.current === null) {
        setActiveSessionId(id)
      }
    },
  })

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
  // just refreshes its exit-relative timestamp. Unsubscribes on unmount via
  // the returned cleanup.
  const onPtyExitRef = useRef<(ptyId: string) => void>(() => undefined)
  onPtyExitRef.current = (ptyId: string): void => {
    const exitedAt = new Date().toISOString()

    setSessions((prev) =>
      prev.map((s) => {
        const idx = s.panes.findIndex((p) => p.ptyId === ptyId)
        if (idx === -1) {
          return s
        }

        const newPanes = s.panes.map((p, paneIdx) =>
          paneIdx === idx
            ? {
                ...p,
                status: 'completed' as const,
                agentType: 'generic' as const,
              }
            : p
        )
        const activePane = newPanes.find((p) => p.active)

        return {
          ...s,
          status: deriveSessionStatus(newPanes),
          agentType: activePane?.agentType ?? s.agentType,
          panes: newPanes,
          lastActivityAt: exitedAt,
        }
      })
    )
  }

  usePtyExitListener({
    service,
    onExit: (ptyId) => onPtyExitRef.current(ptyId),
  })

  // Create session — spawn + prepend, then mark the pane as 'attach'.
  //
  // The PTY is created up-front in this hook (so we get the canonical id and
  // pid for state). We then populate restoreData with empty replay/buffered
  // slots and register the new pty as pending so TerminalPane renders in
  // 'attach' mode. Without this the pane would mount with no restoredFrom and
  // TerminalZone's mode-decision rules would route it to the legacy 'spawn'
  // fallback — which calls service.spawn() a SECOND time and creates a hidden
  // duplicate PTY (Codex P1 finding).
  //
  // Pending-buffer inclusion: pty-data events emitted between
  // service.spawn() resolving and useTerminal subscribing land in the
  // orchestrator's permanent buffering listener (kept alive for the hook's
  // lifetime by F1-round-2) and get drained when the new pane reports ready.
  // Without the permanent listener, fresh tabs created after restore would
  // come up blank until the shell produced more output — early prompts,
  // OSC sequences, and any startup banner would be silently lost.
  // Round 10 (codex P2): track in-flight `service.spawn()` requests so the
  // auto-create-on-empty effect can defer when a manual createSession is
  // already racing. Without this guard, a user clicking `+` during the
  // restore window (loading=true, no live sessions yet) could end up with
  // TWO tabs from a single click: their manual one, plus an auto-created
  // one that fired between when loading flipped to false and when the
  // manual spawn resolved into `sessions`.
  //
  // Round 12, Finding 1 (claude HIGH): this is REACT STATE, not a ref. The
  // round-10 implementation used a ref, but the auto-create effect is gated
  // on hasLiveSession changing. When a manual spawn FAILS, hasLiveSession
  // stays false (no session was added) — and decrementing a ref doesn't
  // schedule a re-render, so the effect never re-fires and the user is
  // stuck with an empty tab strip. Promoting to state makes the decrement
  // schedule a render, the effect's deps include `pendingSpawns`, and the
  // post-failure tick observes `pendingSpawns === 0 && !hasLiveSession`
  // and fires the auto-create that the round-10 comment promised.
  const [pendingSpawns, setPendingSpawns] = useState(0)
  const pendingPaneOps = useRef<Set<string>>(new Set())

  const createSession = useCallback((): void => {
    setPendingSpawns((c) => c + 1)
    void (async (): Promise<void> => {
      try {
        const result = await service.spawn({
          cwd: '~',
          env: {},
          enableAgentBridge: true,
        })

        const now = new Date().toISOString()
        const newSessionId = crypto.randomUUID()

        const restoreData: RestoreData = {
          sessionId: result.sessionId,
          cwd: result.cwd,
          pid: result.pid,
          replayData: '',
          replayEndOffset: 0,
          bufferedEvents: [],
        }

        // F4 (codex MEDIUM follow-up): the public `restoreData` Map is now
        // a zombie — `pane.restoreData` is the live source. We keep only
        // the React-Session.id key; the previous ptyId-keyed entry was
        // never consumed after `usePtyBufferDrain.notifyPaneReady` started
        // using `isStillTracked` instead of `restoreDataRef.has()`. Full
        // removal of the Map deferred to a follow-up so existing tests
        // keep their public-API contract.
        restoreDataRef.current.set(newSessionId, restoreData)
        registerPending(result.sessionId)

        let computedNewOrder = null as string[] | null
        flushSync(() => {
          setSessions((prev) => {
            const newSession: Session = {
              id: newSessionId,
              projectId: 'proj-1',
              name: `session ${prev.length + 1}`,
              status: 'running',
              workingDirectory: result.cwd,
              agentType: 'generic',
              layout: 'single',
              panes: [
                {
                  id: 'p0',
                  ptyId: result.sessionId,
                  cwd: result.cwd,
                  agentType: 'generic',
                  status: 'running',
                  active: true,
                  pid: result.pid,
                  restoreData,
                },
              ],
              createdAt: now,
              lastActivityAt: now,
              activity: { ...emptyActivity },
            }

            const next = [newSession, ...prev]
            // F13 (claude MEDIUM): do NOT call the throwing getActivePane
            // inside the setSessions updater — a transient invariant
            // violation (5b multi-pane edits) would abort the React state
            // commit and orphan the freshly-spawned Rust PTY. Compute the
            // reorder payload AFTER flushSync returns using findActivePane.

            return next
          })
        })

        // F13: derive the reorder payload OUTSIDE the updater using the
        // non-throwing findActivePane. sessionsRef.current was updated by
        // the flushSync above. If any session lacks an active pane (5b
        // bug), skip the IPC — React state stays, Rust order will catch
        // up on the next reorder.
        const orderIds = sessionsRef.current
          .map((s) => findActivePane(s)?.ptyId)
          .filter((ptyId): ptyId is string => ptyId !== undefined)
        if (orderIds.length === sessionsRef.current.length) {
          computedNewOrder = orderIds
        }

        if (computedNewOrder !== null) {
          // eslint-disable-next-line promise/prefer-await-to-then
          service.reorderSessions(computedNewOrder).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('createSession: reorderSessions failed', err)
          })
        }

        setActiveSessionId(newSessionId)
        registerPtySession(result.sessionId, result.sessionId, result.cwd)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('spawn failed', err)
      } finally {
        setPendingSpawns((c) => c - 1)
      }
    })()
  }, [registerPending, service, setActiveSessionId])

  // Auto-create one default tab on clean launch.
  //
  // Before the orchestrator rewrite, useSessionManager initialized state
  // with a hard-coded `defaultSession`, so the workspace always rendered
  // a TerminalPane on first paint. The rewrite starts with `sessions: []`
  // and only fills from `list_sessions` — combined with the graceful-exit
  // cache wipe (commit 463290e), this means a clean launch (cache empty,
  // no restored sessions) leaves the workspace blank with a "click + to
  // create a new terminal" prompt. Forcing the user to create the first
  // tab manually on every launch is annoying, AND it broke the E2E suite
  // which assumed a TerminalPane mounts automatically.
  //
  // This effect runs ONCE after the initial restore completes (loading
  // transitions from true to false). If the merged session list contains
  // no LIVE session at that point, we fire createSession() to seed a
  // default tab. The ref-guard prevents this from re-firing — if the
  // user later closes all tabs, we DO NOT auto-create another (closing
  // all tabs is intentional; re-creating one would be confusing).
  //
  // "No live session" — not just "empty list" — covers the post-crash
  // path: if the previous app was killed (SIGKILL, OOM, wdio session
  // teardown without graceful exit), `list_sessions` lazy-reconciles
  // every cached "alive" entry to Exited. The user (or E2E suite) lands
  // in a workspace full of "Restart" tabs and zero live PTYs, defeating
  // the round-7 auto-create that was supposed to guarantee a usable
  // terminal on first paint. Treat that case the same as empty cache
  // and seed a fresh tab; the Exited tabs remain available for the user
  // to Restart in their original cwd if they want to.
  const hasLiveSession = sessions.some((s) => s.status === 'running')
  useAutoCreateOnEmpty({
    enabled: autoCreateOnEmpty,
    loading,
    hasLiveSession,
    pendingSpawns,
    createSession,
  })

  // Remove session — kill + filter + advance active
  const removeSession = useCallback(
    (id: string): void => {
      void (async (): Promise<void> => {
        const target = sessionsRef.current.find((s) => s.id === id)
        if (!target) {
          // eslint-disable-next-line no-console
          console.warn(`removeSession: no session with id ${id}`)

          return
        }

        // Snapshot the ptyIds at the time the kill IPC fires. Used both
        // for the kill loop and the (separate) post-await diff against
        // any new ptyIds the session has acquired during the await
        // window (concurrent restartSession would rotate pane.ptyId).
        const snapshotPtyIds = target.panes.map((pane) => pane.ptyId)

        const results = await Promise.allSettled(
          snapshotPtyIds.map((ptyId) => service.kill({ sessionId: ptyId }))
        )

        const rejected = results.filter(
          (result) => result.status === 'rejected'
        )
        if (rejected.length > 0) {
          for (const result of rejected) {
            // eslint-disable-next-line no-console
            console.warn('removeSession: kill failed for a pane', result.reason)
          }

          // F2 (codex MEDIUM follow-up — step 5b): this all-or-nothing bail
          // is intentional for 5a, where each session owns exactly one pane.
          // When 5b sessions can retain surviving panes after one PTY-kill
          // fails, this should clean up the fulfilled kills (remove dead
          // panes from React state + drop their bookkeeping) before
          // returning, so the user sees the survivors and can retry the
          // failed kill on its own pane.
          return
        }

        // P1 (codex connector) race fix: re-read the session AFTER the
        // kill await. A concurrent restartSession may have rotated some
        // pane.ptyIds during the await window — the snapshot we just
        // killed is stale. Any ptyId present in the current session but
        // absent from the snapshot is an orphaned PTY we MUST kill too,
        // otherwise removing the React session leaves a live PTY in
        // Rust with no tab to control it.
        const currentTarget = sessionsRef.current.find((s) => s.id === id)

        const currentPtyIds = currentTarget
          ? currentTarget.panes.map((pane) => pane.ptyId)
          : []

        const newPtyIds = currentPtyIds.filter(
          (ptyId) => !snapshotPtyIds.includes(ptyId)
        )
        if (newPtyIds.length > 0) {
          const orphanResults = await Promise.allSettled(
            newPtyIds.map((ptyId) => service.kill({ sessionId: ptyId }))
          )

          const orphanRejected = orphanResults.filter(
            (result) => result.status === 'rejected'
          )
          if (orphanRejected.length > 0) {
            for (const result of orphanRejected) {
              // eslint-disable-next-line no-console
              console.warn(
                'removeSession: kill of post-await orphan PTY failed',
                result.reason
              )
            }

            // Same bail policy as above — refuse to drop the React
            // session if any PTY remains unkilled.
            return
          }
        }

        // Drop bookkeeping for ALL ptys we killed (snapshot + post-await
        // orphans).
        const allKilledPtyIds = [...snapshotPtyIds, ...newPtyIds]
        for (const ptyId of allKilledPtyIds) {
          dropAllForPty(ptyId)
          restoreDataRef.current.delete(ptyId)
          unregisterPtySession(ptyId)
        }
        restoreDataRef.current.delete(target.id)

        const currentActiveId = activeSessionIdRef.current
        let computedFallback = null as string | null
        let shouldUpdateActive = false as boolean
        flushSync(() => {
          setSessions((prev) => {
            const next = prev.filter((s) => s.id !== id)
            if (currentActiveId === id) {
              const removedIndex = prev.findIndex((s) => s.id === id)
              shouldUpdateActive = true
              computedFallback =
                next.length === 0
                  ? null
                  : next[Math.min(removedIndex, next.length - 1)].id
            }

            return next
          })
        })

        if (!shouldUpdateActive) {
          return
        }

        if (computedFallback !== null) {
          setActiveSessionId(computedFallback)
        } else {
          setActiveSessionIdRaw(null)
        }
      })()
    },
    [
      activeSessionIdRef,
      dropAllForPty,
      service,
      setActiveSessionId,
      setActiveSessionIdRaw,
    ]
  )

  const setSessionLayout = useCallback(
    (sessionId: string, layoutId: LayoutId): void => {
      // Warn outside `setSessions` so StrictMode's double-invocation
      // of the state updater doesn't fire the log twice. The lookup
      // reads `sessionsRef.current` for the check; the actual mutation
      // (when present) still uses the updater's `prev` for correctness.
      const session = sessionsRef.current.find((s) => s.id === sessionId)
      if (!session) {
        // eslint-disable-next-line no-console
        console.warn(`setSessionLayout: no session ${sessionId}`)

        return
      }
      if (session.layout === layoutId) {
        return
      }
      setSessions((prev) => {
        const sessionIndex = prev.findIndex((s) => s.id === sessionId)
        if (sessionIndex === -1 || prev[sessionIndex].layout === layoutId) {
          return prev
        }

        return [
          ...prev.slice(0, sessionIndex),
          { ...prev[sessionIndex], layout: layoutId },
          ...prev.slice(sessionIndex + 1),
        ]
      })
    },
    []
  )

  const setSessionActivePane = useCallback(
    (sessionId: string, paneId: string): void => {
      // Warn outside `setSessions` for StrictMode parity (same reason
      // as setSessionLayout). `applyActivePane` is a pure helper —
      // it no-ops on missing ids (returns the same reference); the warns live here
      // so they fire exactly once per operator action.
      const session = sessionsRef.current.find((s) => s.id === sessionId)
      if (!session) {
        // eslint-disable-next-line no-console
        console.warn(`setSessionActivePane: no session ${sessionId}`)

        return
      }
      const target = session.panes.find((p) => p.id === paneId)
      if (!target) {
        // eslint-disable-next-line no-console
        console.warn(
          `setSessionActivePane: no pane ${paneId} in session ${sessionId}`
        )

        return
      }
      // Already-active short-circuit (mirrors setSessionLayout's same-
      // layout guard). applyActivePane returns the same reference in
      // this case and React bails on the re-render, so the visible
      // outcome is unchanged — but we avoid enqueuing a state update
      // that the reducer would just no-op. Same defensive shape on
      // both mutations keeps future callers from accidentally
      // diverging.
      if (target.active) {
        return
      }
      setSessions((prev) => applyActivePane(prev, sessionId, paneId))

      if (sessionId === activeSessionIdRef.current) {
        // eslint-disable-next-line promise/prefer-await-to-then
        service.setActiveSession(target.ptyId).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('setSessionActivePane: setActiveSession failed', err)
        })
      }
    },
    [activeSessionIdRef, service]
  )

  const addPane = useCallback(
    (sessionId: string): void => {
      if (pendingPaneOps.current.has(sessionId)) {
        // eslint-disable-next-line no-console
        console.warn(
          `addPane: another pane op in flight for ${sessionId}; ignoring`
        )

        return
      }

      const session = sessionsRef.current.find((s) => s.id === sessionId)
      if (!session) {
        // eslint-disable-next-line no-console
        console.warn(`addPane: no session ${sessionId}`)

        return
      }

      const activePane = findActivePane(session)
      if (!activePane) {
        // eslint-disable-next-line no-console
        console.warn(`addPane: session ${sessionId} has no active pane`)

        return
      }

      if (session.panes.length >= LAYOUTS[session.layout].capacity) {
        // eslint-disable-next-line no-console
        console.warn(
          `addPane: session ${sessionId} is at capacity for layout ${session.layout}`
        )

        return
      }

      pendingPaneOps.current.add(sessionId)
      setPendingSpawns((count) => count + 1)

      void (async (): Promise<void> => {
        try {
          const result = await service.spawn({
            cwd: activePane.cwd,
            env: {},
            enableAgentBridge: true,
          })

          const fresh = sessionsRef.current.find((s) => s.id === sessionId)
          if (!fresh) {
            try {
              await service.kill({ sessionId: result.sessionId })
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('addPane: failed to kill orphan PTY', err)
            }
            dropAllForPty(result.sessionId)

            return
          }

          const restoreData: RestoreData = {
            sessionId: result.sessionId,
            cwd: result.cwd,
            pid: result.pid,
            replayData: '',
            replayEndOffset: 0,
            bufferedEvents: [],
          }

          const newPane: Pane = {
            id: nextFreePaneId(fresh.panes),
            ptyId: result.sessionId,
            cwd: result.cwd,
            agentType: 'generic',
            status: 'running',
            active: true,
            pid: result.pid,
            restoreData,
          }

          registerPending(result.sessionId)

          let appended = false as boolean
          flushSync(() => {
            setSessions((prev) => {
              const target = prev.find((s) => s.id === sessionId)
              const capacity = target ? LAYOUTS[target.layout].capacity : 0
              const update = applyAddPane(prev, sessionId, newPane, capacity)
              appended = update.appended

              return update.sessions
            })
          })

          if (!appended) {
            dropAllForPty(result.sessionId)
            try {
              await service.kill({ sessionId: result.sessionId })
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('addPane: failed to kill reducer-rejected PTY', err)
            }
            // eslint-disable-next-line no-console
            console.warn(
              `addPane: reducer rejected commit for ${sessionId}; orphan killed`
            )

            return
          }

          if (sessionId === activeSessionIdRef.current) {
            // eslint-disable-next-line promise/prefer-await-to-then
            service.setActiveSession(result.sessionId).catch((err) => {
              // eslint-disable-next-line no-console
              console.warn('addPane: setActiveSession failed', err)
            })
          }

          registerPtySession(result.sessionId, result.sessionId, result.cwd)
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('addPane: spawn failed', err)
        } finally {
          setPendingSpawns((count) => count - 1)
          pendingPaneOps.current.delete(sessionId)
        }
      })()
    },
    [activeSessionIdRef, dropAllForPty, registerPending, service]
  )

  const removePane = useCallback(
    (sessionId: string, paneId: string): void => {
      if (pendingPaneOps.current.has(sessionId)) {
        // eslint-disable-next-line no-console
        console.warn(
          `removePane: another pane op in flight for ${sessionId}; ignoring`
        )

        return
      }

      const session = sessionsRef.current.find((s) => s.id === sessionId)
      if (!session) {
        // eslint-disable-next-line no-console
        console.warn(`removePane: no session ${sessionId}`)

        return
      }

      const target = session.panes.find((pane) => pane.id === paneId)
      if (!target) {
        // eslint-disable-next-line no-console
        console.warn(`removePane: no pane ${paneId} in session ${sessionId}`)

        return
      }

      if (session.panes.length === 1) {
        // eslint-disable-next-line no-console
        console.warn(
          `removePane: refusing to remove the last pane in ${sessionId}; use removeSession instead`
        )

        return
      }

      pendingPaneOps.current.add(sessionId)

      void (async (): Promise<void> => {
        try {
          try {
            await service.kill({ sessionId: target.ptyId })
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('removePane: kill failed; pane preserved', err)

            return
          }

          dropAllForPty(target.ptyId)
          restoreDataRef.current.delete(target.ptyId)
          unregisterPtySession(target.ptyId)

          let newActivePtyId: string | undefined
          flushSync(() => {
            setSessions((prev) => {
              const fresh = prev.find((s) => s.id === sessionId)

              const update = applyRemovePane(
                prev,
                sessionId,
                paneId,
                fresh?.layout ?? session.layout
              )
              newActivePtyId = update.newActivePtyId

              return update.sessions
            })
          })

          if (
            newActivePtyId !== undefined &&
            sessionId === activeSessionIdRef.current
          ) {
            // eslint-disable-next-line promise/prefer-await-to-then
            service.setActiveSession(newActivePtyId).catch((err) => {
              // eslint-disable-next-line no-console
              console.warn('removePane: setActiveSession failed', err)
            })
          }
        } finally {
          pendingPaneOps.current.delete(sessionId)
        }
      })()
    },
    [activeSessionIdRef, dropAllForPty, service]
  )

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
    (sessionId: string): void => {
      void (async (): Promise<void> => {
        const oldSession = sessionsRef.current.find((s) => s.id === sessionId)
        if (!oldSession) {
          // eslint-disable-next-line no-console
          console.warn(`restartSession: no session with id ${sessionId}`)

          return
        }

        const oldPane = getActivePane(oldSession)
        const cachedCwd = oldPane.cwd

        let result: { sessionId: string; pid: number; cwd: string }
        try {
          result = await service.spawn({
            cwd: cachedCwd,
            env: {},
            enableAgentBridge: true,
          })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            'restartSession: spawn failed; old session preserved',
            err
          )

          return
        }

        try {
          await service.kill({ sessionId: oldPane.ptyId })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            'restartSession: kill of old ptyId failed; killing new orphan',
            err
          )
          // eslint-disable-next-line promise/prefer-await-to-then,@typescript-eslint/no-empty-function
          service.kill({ sessionId: result.sessionId }).catch((): void => {})

          return
        }

        dropAllForPty(oldPane.ptyId)
        restoreDataRef.current.delete(oldPane.ptyId)
        restoreDataRef.current.delete(oldSession.id)
        unregisterPtySession(oldPane.ptyId)

        const restoreData: RestoreData = {
          sessionId: result.sessionId,
          cwd: result.cwd,
          pid: result.pid,
          replayData: '',
          replayEndOffset: 0,
          bufferedEvents: [],
        }

        // F4 (codex MEDIUM follow-up): single React-Session.id key only.
        // restartSession preserves session.id; the ptyId-keyed entry was
        // unused by drain logic (see comment in createSession).
        restoreDataRef.current.set(oldSession.id, restoreData)
        registerPending(result.sessionId)
        registerPtySession(result.sessionId, result.sessionId, result.cwd)

        let computedNewOrder = null as string[] | null
        let orphanedSessionId = null as string | null
        flushSync(() => {
          setSessions((prev) => {
            const idx = prev.findIndex((s) => s.id === sessionId)
            if (idx === -1) {
              orphanedSessionId = result.sessionId

              return prev
            }

            const next = [...prev]
            const current = prev[idx]

            const replacementPane: Pane = {
              ...oldPane,
              ptyId: result.sessionId,
              cwd: result.cwd,
              status: 'running',
              agentType: 'generic',
              pid: result.pid,
              restoreData,
            }

            next[idx] = {
              ...current,
              status: 'running',
              workingDirectory: result.cwd,
              agentType: 'generic',
              panes: current.panes.map((pane) =>
                pane.id === oldPane.id ? replacementPane : pane
              ),
              lastActivityAt: new Date().toISOString(),
            }

            // F13: defer the throw-prone getActivePane(s).ptyId map to
            // OUTSIDE the updater (see createSession for the rationale).

            return next
          })
        })

        // F13: compute ids OUTSIDE the updater with findActivePane. If any
        // session lacks an active pane (5b transient state), skip the IPC
        // — Rust order will catch up on the next successful reorder.
        const orderIdsAfter = sessionsRef.current
          .map((s) => findActivePane(s)?.ptyId)
          .filter((ptyId): ptyId is string => ptyId !== undefined)
        if (orderIdsAfter.length === sessionsRef.current.length) {
          computedNewOrder = orderIdsAfter
        }

        if (orphanedSessionId !== null) {
          // eslint-disable-next-line promise/prefer-await-to-then,@typescript-eslint/no-empty-function
          service.kill({ sessionId: orphanedSessionId }).catch((): void => {})
          restoreDataRef.current.delete(orphanedSessionId)
          restoreDataRef.current.delete(oldSession.id)
          dropAllForPty(orphanedSessionId)
          unregisterPtySession(orphanedSessionId)
        }
        if (computedNewOrder !== null) {
          // eslint-disable-next-line promise/prefer-await-to-then
          service.reorderSessions(computedNewOrder).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('restartSession: reorderSessions failed', err)
          })
        }

        if (activeSessionIdRef.current === sessionId) {
          setActiveSessionId(sessionId)
        }
      })()
    },
    [
      activeSessionIdRef,
      dropAllForPty,
      registerPending,
      service,
      setActiveSessionId,
    ]
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
  //
  // Round 9, Finding 5 (codex P2 / claude LOW): no rollback on IPC failure.
  // The previous code captured `prev = sessions` at call time and called
  // `setSessions(prev)` from the catch handler — a render-time snapshot
  // that overwrote any concurrent createSession / removeSession updates
  // that committed during the IPC roundtrip. Rust's reorder_sessions
  // already validates the input is a permutation of the current set, so
  // a rejected call leaves the cache untouched. Without rolling back the
  // UI here, the in-memory order may briefly diverge from the cache;
  // the next reload merges via list_sessions and reconciles. The cost is
  // tiny (a refresh window where the tab strip shows the user's intent
  // even though the cache holds the prior order) and the win is large
  // (no clobbering of unrelated concurrent state).
  const reorderSessions = useCallback(
    (reordered: Session[]): void => {
      // F14 (claude MEDIUM): compute the Rust IPC payload BEFORE
      // committing React state. Previously: setSessions fired, then
      // getActivePane(s).ptyId mapped — a throw would leave React
      // showing the new order while Rust kept the old, diverging
      // permanently until the next reload. Now: derive ids first via
      // findActivePane (non-throwing); if any session is missing an
      // active pane (5b transient state), bail BEFORE setSessions so
      // React and Rust stay aligned.
      const ids = reordered
        .map((s) => findActivePane(s)?.ptyId)
        .filter((ptyId): ptyId is string => ptyId !== undefined)
      if (ids.length !== reordered.length) {
        // eslint-disable-next-line no-console
        console.warn(
          'reorderSessions: skipping — at least one session has no active pane'
        )

        return
      }
      setSessions(reordered)
      // eslint-disable-next-line promise/prefer-await-to-then
      service.reorderSessions(ids).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(
          'reorderSessions IPC failed; cache untouched, UI may diverge until next reload',
          err
        )
        // No rollback: setSessions(prev) with a render-time snapshot
        // would discard concurrent create/remove updates that commit
        // during the IPC roundtrip. The Rust side rejected the write so
        // the cache retains the prior order; on next reload the merge
        // logic in the orchestrator reconciles in-memory React state
        // with the cached order.
      })
    },
    [service]
  )

  const updatePaneCwd = useCallback(
    (sessionId: string, paneId: string, cwd: string): void => {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== sessionId) {
            return session
          }

          const panes = session.panes.map((pane) =>
            pane.id === paneId ? { ...pane, cwd } : pane
          )
          const activePane = panes.find((pane) => pane.active)

          return {
            ...session,
            panes,
            workingDirectory: activePane?.cwd ?? session.workingDirectory,
          }
        })
      )

      const target = sessionsRef.current.find((s) => s.id === sessionId)
      const targetPane = target?.panes.find((pane) => pane.id === paneId)
      if (!targetPane) {
        return
      }

      // eslint-disable-next-line promise/prefer-await-to-then
      service.updateSessionCwd(targetPane.ptyId, cwd).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('updatePaneCwd IPC failed', err)
      })
    },
    [service]
  )

  const updatePaneAgentType = useCallback(
    (
      sessionId: string,
      paneId: string,
      agentType: Session['agentType']
    ): void => {
      setSessions((prev) => {
        const target = prev.find((session) => session.id === sessionId)
        const current = target?.panes.find((pane) => pane.id === paneId)
        if (!target || !current || current.agentType === agentType) {
          return prev
        }

        return prev.map((session) => {
          if (session.id !== sessionId) {
            return session
          }

          const panes = session.panes.map((pane) =>
            pane.id === paneId ? { ...pane, agentType } : pane
          )
          const activePane = panes.find((pane) => pane.active)

          return {
            ...session,
            panes,
            agentType: activePane?.agentType ?? session.agentType,
          }
        })
      })
    },
    []
  )

  const updateSessionCwd = useCallback(
    (id: string, cwd: string): void => {
      const target = sessionsRef.current.find((s) => s.id === id)
      if (!target) {
        return
      }

      updatePaneCwd(id, getActivePane(target).id, cwd)
    },
    [updatePaneCwd]
  )

  const updateSessionAgentType = useCallback(
    (id: string, agentType: Session['agentType']): void => {
      const target = sessionsRef.current.find((s) => s.id === id)
      if (!target) {
        return
      }

      updatePaneAgentType(id, getActivePane(target).id, agentType)
    },
    [updatePaneAgentType]
  )

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createSession,
    removeSession,
    setSessionLayout,
    setSessionActivePane,
    addPane,
    removePane,
    restartSession,
    renameSession,
    reorderSessions,
    updatePaneCwd,
    updatePaneAgentType,
    updateSessionCwd,
    updateSessionAgentType,
    // Round 12 F2: expose the ref-backed Map. Identity is stable across
    // renders; consumers that previously relied on Map identity changing
    // were reading stale state — every mutation in this hook is paired
    // with a setSessions call, so the consuming render is triggered by
    // the sessions array, not by the Map.
    restoreData: restoreDataRef.current,
    loading,
    notifyPaneReady,
  }
}
