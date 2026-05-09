import { useState, useCallback, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import type { Session, AgentActivity } from '../types'
import type { SessionList, SessionInfo } from '../../../bindings'
import type { ITerminalService } from '../../terminal/services/terminalService'
import {
  registerPtySession,
  unregisterPtySession,
} from '../../terminal/ptySessionMap'

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
    agentType: 'generic',
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
  bufferedEvents: { data: string; offsetStart: number; byteLen: number }[]
}

/**
 * Handler that receives a buffered PTY event during pane drain.
 * Same signature as the live `pty-data` callback, so callers can reuse
 * a single function (with cursor dedupe) for both buffered drain and
 * live events. `byteLen` is the producer's raw byte count for the chunk —
 * the cursor MUST advance by this value (not by `data.length`) to avoid
 * lossy-UTF-8 drift away from the producer's offset stream.
 */
export type PaneEventHandler = (
  data: string,
  offsetStart: number,
  byteLen: number
) => void

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
  updateSessionAgentType: (id: string, agentType: Session['agentType']) => void
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

  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    null
  )
  // Round 12, Finding 2 (claude MEDIUM): restoreData is a mutable
  // side-channel, NOT React state. The previous `useState(new Map())`
  // was misleading — Map mutations via .set/.delete don't notify React,
  // and the UI only "saw" changes because every call site happened to
  // pair its mutation with a setSessions call. Future call sites might
  // forget the pairing. Promoting to useRef makes the design intent
  // explicit: restoreData is read by consumers (TerminalZone) but
  // changes are coordinated by the sessions array, never by Map identity.
  const restoreDataRef = useRef(new Map<string, RestoreData>())
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
    Map<string, { data: string; offsetStart: number; byteLen: number }[]>
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
          (sessionId, data, offsetStart, byteLen) => {
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
            q.push({ data, offsetStart, byteLen })
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
            restoreDataRef.current.set(info.id, {
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
        // Round 13, Codex P2: do NOT tear down the global buffering
        // listener here. createSession() still relies on it to buffer
        // pty-data between spawn() and the pane's live subscription.
        // The listener tears down on hook unmount (cleanup below).
      }
    })()

    return (): void => {
      cancelled = true
      stopBufferingRef.current?.()
      stopBufferingRef.current = null
    }
  }, [service])

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
  useEffect(() => {
    const unsubscribeExit = service.onExit((sessionId) => {
      const exitedAt = new Date().toISOString()

      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, status: 'completed', lastActivityAt: exitedAt }
            : s
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
          handler(e.data, e.offsetStart, e.byteLen)
        }
        bufferedRef.current.delete(sessionId)
      }

      // Round 7, Finding 2 (claude MEDIUM): the cleanup callback returned
      // by notifyPaneReady fires when the pane unmounts (StrictMode dev
      // double-mount, error-boundary reset, route change, …). Previously
      // this was a no-op, so:
      //
      //   1. pane unmounts → cleanup (no-op) — sessionId stays in
      //      readyPanesRef
      //   2. pty-data events for sessionId arrive → global listener sees
      //      readyPanesRef.has(sessionId) and DROPS them (the `return`
      //      branch in the buffering callback)
      //   3. pane remounts → calls notifyPaneReady → tries to drain
      //      bufferedRef → events from step 2 are NOT in the buffer
      //      because step 2 dropped them. Silent output loss.
      //
      // Re-arm the per-session state on cleanup: remove from ready, add
      // back to pending, ensure an empty buffer exists. The next
      // pty-data event lands in the buffer, the next notifyPaneReady
      // call drains it cleanly.
      //
      // Round 8, Finding 2 (claude MEDIUM): only re-arm when the session is
      // still alive in the manager's view. `removeSession` synchronously
      // deletes `sessionId` from `pendingPanesRef`, `readyPanesRef`,
      // `bufferedRef`, AND `restoreData` BEFORE setSessions() schedules the
      // re-render that unmounts the pane. By the time this cleanup runs the
      // Map no longer contains the entry — treating that as a teardown signal
      // means we DON'T re-add the session to pending/buffer state. Without
      // this guard, any pty-data event racing the async kill_pty would land
      // in the per-session buffer with no consumer, accumulating per removed
      // session for the lifetime of the hook.
      //
      // The remount path (StrictMode, error-boundary reset, route change)
      // continues to work because those code paths leave restoreData intact —
      // only an explicit removeSession deletes it.
      return (): void => {
        if (!restoreDataRef.current.has(sessionId)) {
          // removeSession already cleared this session — treat unmount as
          // permanent teardown and skip the re-arm.
          return
        }
        readyPanesRef.current.delete(sessionId)
        pendingPanesRef.current.add(sessionId)
        if (!bufferedRef.current.has(sessionId)) {
          bufferedRef.current.set(sessionId, [])
        }
      }
    },
    []
  )

  // Mirror the latest active session id into a ref so async callbacks can
  // read the freshest value AFTER an await rather than the stale closure
  // capture from the call site.
  //
  // Round 9, Findings 2 + 3 (codex P2): `removeSession` and `restartSession`
  // both branch on `activeSessionId === id` BEFORE an `await service.kill(...)`
  // / `await service.spawn(...)`. If the user switches tabs while the IPC is
  // in flight, the closure-captured id no longer reflects the user's choice;
  // promoting (or rotating away from) the stale id then clobbers the newer
  // selection. Reading `activeSessionIdRef.current` post-await uses the latest
  // committed selection — including any tab switch that landed during the
  // roundtrip.
  const activeSessionIdRef = useRef(activeSessionId)
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  // Round 9, Finding 4 (codex P2): out-of-order setActiveSession IPC failures
  // can revert the active id to a stale value. Tag every call with a
  // monotonically increasing request id and only honor the rollback when
  // our request is still the latest. If a NEWER request has been issued in
  // the meantime, the newer request now "owns" the active selection;
  // reverting to the value WE captured at our call site would clobber the
  // user's latest pick.
  //
  // Concrete scenario the previous code mis-handled:
  //   1. Active = 'a'
  //   2. User clicks 'b' → req=1 fires, optimistic active = 'b'
  //   3. User clicks 'c' before req=1 settles → req=2 fires,
  //      optimistic active = 'c'
  //   4. req=1 rejects (e.g. transient cache write failure or 'b' was
  //      killed) → revert to 'a'   ❌ clobbers user's 'c' pick
  //   5. req=2 resolves successfully → cache active = 'c', UI active = 'a'
  //
  // After the fix, step 4 sees `myReq=1 !== activeRequestIdRef.current=2`
  // and skips the rollback. `c` stays the user's selection.
  const activeRequestIdRef = useRef(0)

  // Active session — optimistic update + IPC
  const setActiveSessionId = useCallback(
    (id: string): void => {
      const myReq = ++activeRequestIdRef.current
      // Capture the value BEFORE we change it so a rollback restores
      // exactly what was on screen, not a stale activeSessionId from a
      // previous render cycle.
      const prev = activeSessionIdRef.current
      setActiveSessionIdState(id)
      // eslint-disable-next-line promise/prefer-await-to-then
      service.setActiveSession(id).catch((err) => {
        if (myReq === activeRequestIdRef.current) {
          // We're still the latest — safe to revert.
          // eslint-disable-next-line no-console
          console.warn('setActiveSession IPC failed; reverting', err)
          setActiveSessionIdState(prev)
        } else {
          // A newer request superseded us; let it own the active id. Reverting
          // here would clobber the user's actual newest selection.
          // eslint-disable-next-line no-console
          console.warn(
            'setActiveSession IPC failed but newer request superseded; not reverting',
            err
          )
        }
      })
    },
    [service]
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

  const createSession = useCallback((): void => {
    setPendingSpawns((c) => c + 1)
    void (async (): Promise<void> => {
      try {
        // Round 8, Finding 3 (claude MEDIUM): explicitly opt in to the
        // agent bridge. The workspace UI is the canonical entry point for
        // user-driven tab creation, and the Claude Code transcript watcher
        // (agent statusline) is the product. Other (test, ad-hoc) callers
        // get the default `false` so they don't litter arbitrary cwds with
        // `.vimeflow/sessions/<uuid>/` directories.
        const result = await service.spawn({
          cwd: '~',
          env: {},
          enableAgentBridge: true,
        })

        const now = new Date().toISOString()

        // Populate restoreData with empty replay so TerminalPane attaches
        // instead of spawning a duplicate PTY.
        // Use the resolved absolute cwd from spawn (e.g. /home/will), not
        // the literal '~' we passed in — many shells don't emit OSC 7 on
        // first prompt, so without this, useGitStatus and the agent-status
        // panel sit idle until the user manually `cd`s.
        restoreDataRef.current.set(result.sessionId, {
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
        // Round 9, Finding 6 (claude MEDIUM): React requires functional
        // updaters to be PURE — no side effects. The previous code fired
        // `service.setActiveSession` and `service.reorderSessions` from
        // INSIDE the setSessions updater, which StrictMode invokes twice
        // (and concurrent React features may re-invoke unpredictably).
        // Each extra invocation re-fired both IPCs.
        //
        // The fix captures the derived value (`computedNewOrder`) inside
        // the updater — the closure still sees the latest `prev` so the
        // race-safety from F3-round-2 is preserved — and fires the IPCs
        // in the OUTER scope after `setSessions` returns. The captured
        // value is a plain string array that survives StrictMode double
        // invoke (each invoke writes the same array; the last write wins).
        // Use flushSync to make the setSessions updater run synchronously,
        // so we can capture the derived `computedNewOrder` and fire IPCs
        // in the OUTER scope after the updater returns. Without flushSync,
        // React 18's automatic batching defers the updater to the next
        // render — `computedNewOrder` would still be null when we read it.
        //
        // The `as string[] | null` widens TypeScript's narrowed `null`
        // literal — TS doesn't follow the closure assignment inside the
        // updater callback by default.
        let computedNewOrder = null as string[] | null
        flushSync(() => {
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
              agentType: 'generic',
              createdAt: now,
              lastActivityAt: now,
              activity: { ...emptyActivity },
            }

            const next = [newSession, ...prev]
            // Capture only — do NOT fire IPC inside the updater.
            computedNewOrder = next.map((s) => s.id)

            return next
          })
        })

        // IPCs fire OUTSIDE the updater. Captured `computedNewOrder` is
        // derived from the latest `prev` (race-safety from F3-round-2 is
        // preserved). reorderSessions persists the prepend.
        if (computedNewOrder !== null) {
          // eslint-disable-next-line promise/prefer-await-to-then
          service.reorderSessions(computedNewOrder).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn(
              'createSession: reorderSessions IPC failed (cache order will lag)',
              err
            )
          })
        }

        // Round 12, Finding 5 (codex P2): route the active-session write
        // through `setActiveSessionId` (the canonical path) so it shares
        // the round-9 F4 monotonic-request guard. The previous code did
        // `setActiveSessionIdState(...) + service.setActiveSession(...).catch(...)`
        // — which bypassed the guard entirely. If the user switched tabs
        // while createSession's IPC was in flight, a late completion
        // could persist a stale active id to the Rust cache. Using the
        // canonical setter consolidates the request-token logic and
        // makes the optimistic-update / rollback semantics consistent
        // across all active-session writes.
        setActiveSessionId(result.sessionId)
        // Round 10 (claude LOW): use the resolved absolute cwd from spawn,
        // not the literal '~'. Agent detection and useGitStatus read this
        // map immediately on mount; '~' would leave both subsystems idle
        // until the shell emits OSC 7 (most shells don't on first prompt).
        registerPtySession(result.sessionId, result.sessionId, result.cwd)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('spawn failed', err)
      } finally {
        setPendingSpawns((c) => c - 1)
      }
    })()
  }, [service, setActiveSessionId])

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
  const didInitialAutoCreateRef = useRef(false)
  const hasLiveSession = sessions.some((s) => s.status === 'running')
  useEffect(() => {
    if (!autoCreateOnEmpty || loading || didInitialAutoCreateRef.current) {
      return
    }
    // Round 10 (codex P2): if a manual createSession is already in flight
    // (e.g. user clicked `+` during the restore window), DEFER auto-create.
    // Round 12 F1: `pendingSpawns` is now state (not a ref) so its decrement
    // re-fires this effect even when `hasLiveSession` doesn't flip — i.e.
    // when the manual spawn FAILED. The post-failure tick observes
    // `pendingSpawns === 0 && !hasLiveSession` and reaches the auto-create
    // path below, restoring the "always have a tab" invariant.
    //
    // Note: don't set `didInitialAutoCreateRef = true` in this early-return
    // branch — we want a future re-fire (when the manual spawn resolves
    // and changes pendingSpawns) to be able to auto-create if the manual
    // attempt failed.
    if (pendingSpawns > 0) {
      return
    }
    didInitialAutoCreateRef.current = true
    if (!hasLiveSession) {
      createSession()
    }
  }, [autoCreateOnEmpty, loading, hasLiveSession, pendingSpawns, createSession])

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
          restoreDataRef.current.delete(id)
          // Round 14, Claude MEDIUM: also drop the module-level ptySessionMap
          // entry. Without this, getAllPtySessionIds() (used by the E2E bridge)
          // returns dead ids after every removeSession, and per-spec session-
          // count assertions break as the map accumulates across specs.
          unregisterPtySession(id)

          // F4 (round 2): when the user closes the ACTIVE tab and the hook
          // promotes a neighbor, the cache must learn about it too. Rust
          // clears active_session_id when the active tab is killed, while
          // React state moves to the index-aligned neighbor (Math.min(
          // removedIndex, next.length - 1)). Persisting the same choice keeps
          // reload state aligned with where the UI moved.
          //
          // Derive the fallback inside the setSessions updater so the
          // computation matches the React-state branch and races with
          // concurrent createSession/removeSession calls are resolved
          // against the latest state.
          //
          // Round 9, Finding 2 (codex P2): read the LATEST active id from
          // `activeSessionIdRef.current`, not the closure-captured
          // `activeSessionId`. The closure was bound when removeSession was
          // called; if the user switched tabs during the in-flight
          // `service.kill` await, the closure value is stale and "removing
          // the active tab" branch would fire even though a different tab
          // is now active — clobbering the newer selection.
          //
          // Round 10 (claude MEDIUM): hoist setActiveSessionIdState + IPC
          // OUT of the setSessions updater. React requires updaters to be
          // pure; createSession/restartSession adopted this pattern in
          // round 9 F6 but removeSession was missed. flushSync forces the
          // updater to run synchronously so the captured `computedFallback`
          // and `shouldUpdateActive` are populated by the time the outer
          // scope reads them.
          const currentActiveId = activeSessionIdRef.current
          // Widen via `as` so TS doesn't narrow to the literal types `null`
          // and `false` — flushSync's callback-mutation of these locals
          // isn't visible to control-flow analysis, so the outer `if`
          // checks would be flagged as always-falsy without the widening.
          // Same idiom used by createSession/restartSession in round 9.
          let computedFallback = null as string | null
          let shouldUpdateActive = false as boolean
          flushSync(() => {
            setSessions((prev) => {
              const next = prev.filter((s) => s.id !== id)
              if (currentActiveId === id) {
                const removedIndex = prev.findIndex((s) => s.id === id)
                shouldUpdateActive = true
                // next.length is 0 when the LAST tab was just removed; that's
                // the only case fallback is null. Rust's kill_pty already
                // cleared cache.active_session_id for an active kill, so we
                // don't fire a setActiveSession IPC for null.
                computedFallback =
                  next.length === 0
                    ? null
                    : next[Math.min(removedIndex, next.length - 1)].id
              }

              return next
            })
          })

          if (shouldUpdateActive) {
            if (computedFallback !== null) {
              // Round 13, Codex P2: route through the guarded helper so a
              // stale fallback IPC can't overwrite a newer user selection
              // that fires while this kill is in flight.
              setActiveSessionId(computedFallback)
            } else {
              // Last tab removed — Rust's kill_pty already cleared
              // cache.active_session_id, no IPC needed. Round 14, Codex P2:
              // bump activeRequestIdRef to supersede any in-flight tab-pick
              // request whose .catch rollback would otherwise restore the
              // just-deleted prev id (UI ↔ sessions divergence).
              activeRequestIdRef.current += 1
              setActiveSessionIdState(null)
            }
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('kill failed', err)
        }
      })()
    },
    [service, setActiveSessionId]
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
        // Note: `cwd` is required (matches the IPC contract — Rust always
        // returns a canonical absolute path from spawn, even on symlinked
        // project directories). Tightening from `cwd?: string` keeps the
        // type aligned with `createSession`'s spawn-result and lets the
        // PTY register at the canonical path the agent detector observes
        // (Cycle-5 F-c5-3 fix — symlinked cwd case).
        let result: { sessionId: string; pid: number; cwd: string }
        try {
          // Round 8, Finding 3 (claude MEDIUM): restart preserves the
          // user's tab semantics, so re-enable the agent bridge for parity
          // with createSession. See createSession for full rationale.
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

        // 2. Now that the new PTY exists, retire the old. kill_pty is
        // idempotent in Rust for the "already gone" case (a typed
        // KillError::NotPresent collapses to Ok), so this only rejects
        // when the actual SIGKILL or cache mutation fails.
        //
        // Round 13, Codex P2: if kill rejects, Rust cache still holds
        // BOTH ids in session_order. The later `reorderSessions(new_only)`
        // call would fail the permutation check and the cache would
        // diverge from the UI; on reload the old tab would resurrect.
        // Abort the restart instead — kill the new orphan to undo the
        // spawn, leave React state untouched (old id keeps its prior
        // status). The user can click Restart again. No bookkeeping
        // for `result.sessionId` has been seeded yet at this point
        // (it happens below), so nothing to tear down besides the PTY.
        try {
          await service.kill({ sessionId: id })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            'restartSession: kill of old id failed; aborting and killing new orphan',
            err
          )
          // eslint-disable-next-line promise/prefer-await-to-then,@typescript-eslint/no-empty-function
          service.kill({ sessionId: result.sessionId }).catch((): void => {})

          return
        }

        readyPanesRef.current.delete(id)
        pendingPanesRef.current.delete(id)
        bufferedRef.current.delete(id)
        restoreDataRef.current.delete(id)
        // Round 14, Claude MEDIUM: drop the retired id from the module-level
        // ptySessionMap symmetrically with registerPtySession(result.sessionId)
        // below. The new id replaces the old in the workspace, but without
        // unregisterPtySession the old entry leaks forever and the E2E bridge
        // sees dead ids.
        unregisterPtySession(id)

        // 3. Seed restoreData so TerminalPane mounts in 'attach' mode
        // instead of falling through to the legacy spawn path (which would
        // create a hidden duplicate PTY — the F3 / round-1 bug).
        //
        // Use `result.cwd` (canonical path from Rust) — NOT `cachedCwd`
        // which is the OLD session's workingDirectory, possibly a
        // symlink. The agent detector observes the canonical path
        // returned from spawn, so registering at the symlink diverges
        // from what the detector sees → silent missed agent-type
        // detection after restart on monorepo-style symlinked project
        // dirs. createSession uses result.cwd for the same reason
        // (Cycle-5 F-c5-3 fix).
        restoreDataRef.current.set(result.sessionId, {
          sessionId: result.sessionId,
          cwd: result.cwd,
          pid: result.pid,
          replayData: '',
          replayEndOffset: 0,
          bufferedEvents: [],
        })
        pendingPanesRef.current.add(result.sessionId)
        registerPtySession(result.sessionId, result.sessionId, result.cwd)

        // Round 9, Finding 3 (codex P2): read the LATEST active id post-await,
        // not the closure-captured `activeSessionId` from when restartSession
        // was first called. The user may have switched tabs during the spawn
        // / kill roundtrip; promoting the restarted tab on top of the newer
        // pick would clobber the user's selection. Capturing post-await
        // ensures any tab switch that landed in the meantime wins.
        const wasActive = activeSessionIdRef.current === id

        // Verify the session still exists in React state (latest committed
        // snapshot via sessionsRef) before deciding to promote the new id.
        // sessionsRef is updated synchronously during render — it reflects
        // the latest committed state at the time of this read, not a
        // closure-captured value. If the session was removed during the
        // spawn/kill roundtrip, the swap below will be a no-op and we
        // MUST NOT setActiveSessionIdState to an id that won't appear in
        // `sessions`.
        const oldIdStillExists = sessionsRef.current.some((s) => s.id === id)

        // 4. Replace the old session entry with new metadata. Inside the
        // setSessions updater so it races correctly against any concurrent
        // create/remove operations. Preserve the in-memory position by
        // mapping over `prev` rather than filter+push.
        //
        // Round 3, Finding 2 (codex P1): the new tab order MUST be persisted
        // via reorderSessions IPC. Without it, kill_pty in Rust REMOVES the
        // old id from cache.session_order and spawn_pty APPENDS the
        // replacement id at the end, so a restarted middle tab would render
        // as `[A, fresh, C]` in the live UI but persist as
        // `[A, C, fresh]` in cache.session_order. After a reload the
        // restored order would diverge from the live UI.
        //
        // Round 9, Finding 6 (claude MEDIUM): React requires functional
        // updaters to be PURE. The previous code fired
        // `service.reorderSessions` and `service.kill` (orphan path) from
        // INSIDE the updater — StrictMode invokes updaters twice, and
        // concurrent React features may re-invoke unpredictably. Each
        // extra invocation re-fired the IPCs.
        //
        // Fix: capture the derived values inside the updater (`computedNewOrder`
        // for the persisted order, `orphanedSessionId` for the orphan-kill
        // case), and fire the IPCs in the OUTER scope after `setSessions`
        // returns. The captures still derive from the latest `prev`, so the
        // race-safety pattern is preserved.
        //
        // `flushSync` forces the updater to run synchronously so the captures
        // are populated before we read them; without it React 18's automatic
        // batching defers the updater to the next render and the captures
        // remain null when we check.
        //
        // The `as ... | null` widens TypeScript's narrowed `null` literal —
        // TS doesn't follow the closure assignment inside the updater
        // callback by default.
        let computedNewOrder = null as string[] | null
        let orphanedSessionId = null as string | null
        flushSync(() => {
          setSessions((prev) => {
            const idx = prev.findIndex((s) => s.id === id)
            if (idx === -1) {
              // The session was removed between the spawn() and now. Mark
              // the new PTY for orphan-kill in the outer scope; React state
              // stays as-is.
              orphanedSessionId = result.sessionId

              return prev
            }

            const next = [...prev]
            next[idx] = {
              ...prev[idx],
              id: result.sessionId,
              status: 'running',
              // workingDirectory unchanged — restart preserves cwd by spec
              lastActivityAt: new Date().toISOString(),
              // Reset agentType to 'generic' on restart so the new session
              // starts from a known baseline. Without this, a stale agent
              // from before the exit can leak into the new session: the
              // detector returns None for shell-only PTYs, the bridge
              // ignores isActive=false, and Session.agentType would stay
              // whatever was last detected. Fresh-spawn parity: the new
              // tab is yellow until detection picks up the actual agent
              // (~tens to hundreds of ms after subscription attaches).
              agentType: 'generic',
            }

            // Capture the post-restart order for outer-scope IPC fire.
            computedNewOrder = next.map((s) => s.id)

            return next
          })
        })

        // IPCs fire OUTSIDE the updater (Round 9 F6 — preserve updater
        // purity for StrictMode + concurrent React). Captured values
        // derived from latest `prev`, so race-safety preserved.
        if (orphanedSessionId !== null) {
          // eslint-disable-next-line promise/prefer-await-to-then,@typescript-eslint/no-empty-function
          service.kill({ sessionId: orphanedSessionId }).catch((): void => {})
          // Round 12, Finding 4 (codex P2): tear down the bookkeeping we
          // seeded BEFORE the setSessions updater discovered the session
          // had been removed. Without this, repeated restart-vs-close
          // races leak per-session entries in restoreData / pendingPanes /
          // readyPanes / bufferedRef / ptySessionMap. The orphan PTY
          // itself is killed above; this just removes the dangling
          // metadata so the next reload reconciles cleanly.
          restoreDataRef.current.delete(orphanedSessionId)
          pendingPanesRef.current.delete(orphanedSessionId)
          readyPanesRef.current.delete(orphanedSessionId)
          bufferedRef.current.delete(orphanedSessionId)
          unregisterPtySession(orphanedSessionId)
        }
        if (computedNewOrder !== null) {
          // eslint-disable-next-line promise/prefer-await-to-then
          service.reorderSessions(computedNewOrder).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn(
              'restartSession: reorderSessions IPC failed (cache order will lag)',
              err
            )
          })
        }

        // 5. If the restarted tab was active AND the old id still exists in
        // the latest committed state (so the swap above produced a NEW id
        // that will be in `sessions`), the React-state id moved. Update
        // active to the new id and tell Rust about it. Skipping the
        // promotion when `oldIdStillExists` is false prevents setting an
        // active id that won't appear in `sessions` — Rust would reject
        // `setActiveSession` for an unknown id, and the stale selection
        // would leak until the next user action.
        if (wasActive && oldIdStillExists) {
          // Round 13, Codex P2: route through the guarded helper so a
          // stale active write from this restart cannot persist over a
          // newer user tab-pick fired before this IPC settles.
          setActiveSessionId(result.sessionId)
        }
      })()
    },
    [service, setActiveSessionId]
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
      setSessions(reordered)
      const ids = reordered.map((s) => s.id)
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

  const updateSessionAgentType = useCallback(
    (id: string, agentType: Session['agentType']): void => {
      setSessions((prev) => {
        const current = prev.find((s) => s.id === id)
        if (!current || current.agentType === agentType) {
          return prev
        }

        return prev.map((s) => (s.id === id ? { ...s, agentType } : s))
      })
    },
    []
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
