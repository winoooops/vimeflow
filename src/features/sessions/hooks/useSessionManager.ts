import { useState, useCallback, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import type { LayoutId, Pane, PaneKind, Session, SessionStatus } from '../types'
import type {
  AgentLifecycleEvent,
  AgentPhase,
  AgentSessionTitleEvent,
} from '../../../bindings'
import { listen, type UnlistenFn } from '../../../lib/backend'
import { isDesktop } from '../../../lib/environment'
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
import {
  deriveShellSessionStatus,
  isLiveStatus,
  isTerminalStatus,
} from '../utils/sessionStatus'
import {
  deleteActivityPanelCollapsed,
  writeActivityPanelCollapsed,
} from '../utils/activityPanelCollapsedStore'
import {
  writeCacheHistory,
  deleteCacheHistory,
} from '../utils/cacheHistoryStore'
import { pushCacheReading } from '../../agent-status/utils/cacheRate'
import { isBrowserPane, isShellPane } from '../utils/paneKind'
import { DEFAULT_BROWSER_URL } from '../../browser/types'
import { usePtyExitListener } from '../../terminal/hooks/usePtyExitListener'
import {
  createBrowserPane,
  destroyBrowserPane,
} from '../../browser/browserBridge'
import { useAutoCreateOnEmpty } from './useAutoCreateOnEmpty'
import { useActiveSessionController } from './useActiveSessionController'
import { usePushWorkspaceGrouping } from './usePushWorkspaceGrouping'
import { useSessionRestore } from './useSessionRestore'
import { createLogger } from '../../../lib/log'

export type { RestoreData, PaneEventHandler, NotifyPaneReadyResult }

export interface SessionManager {
  sessions: Session[]
  activeSessionId: string | null
  setActiveSessionId: (id: string) => void
  createSession: () => void
  createBrowserSession: () => void
  removeSession: (id: string) => void
  setSessionLayout: (sessionId: string, layoutId: LayoutId) => void
  setSessionActivePane: (sessionId: string, paneId: string) => void
  addPane: (sessionId: string, kind?: PaneKind) => void
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
  /**
   * Set a per-pane user label (overrides `pane.agentTitle` and
   * `session.name` in the Header). Always in-memory; no IPC.
   * Pass `undefined` to clear. Trims whitespace; empty post-trim
   * input clears the label. `ifCurrentLabel` makes the update conditional,
   * used by async rollback paths so newer labels survive stale failures.
   */
  setPaneUserLabel: (
    ptyId: string,
    label: string | undefined,
    options?: SetPaneUserLabelOptions
  ) => void
  reorderSessions: (reordered: Session[]) => void
  /** Update a pane's live cwd and the backend PTY cwd cache. */
  updatePaneCwd: (sessionId: string, paneId: string, cwd: string) => void
  updatePaneAgentType: (
    sessionId: string,
    paneId: string,
    agentType: Session['agentType']
  ) => void
  appendPaneCacheReading: (
    sessionId: string,
    paneId: string,
    percentage: number
  ) => void
  updateBrowserPaneUrl?: (
    sessionId: string,
    paneId: string,
    browserUrl: string
  ) => void
  /** Toggle the agent activity panel collapse state for ALL panes in the
   *  session at once. UI-only state — persisted via localStorage so the
   *  preference survives restart without flowing through the agent/PTY
   *  lifecycle. */
  setSessionActivityPanelCollapsed: (
    sessionId: string,
    collapsed: boolean
  ) => void
  /**
   * Update the stable session baseline cwd in React state only.
   *
   * This intentionally does not call `service.updateSessionCwd`; callers that
   * need to sync a live PTY cwd to the backend must use `updatePaneCwd`.
   *
   * @deprecated Use `updatePaneCwd` for live pane cwd changes that must sync to
   * the backend. This wrapper only updates the stable session baseline cwd.
   */
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
  /**
   * Arm the spawn→attach buffer for a freshly-spawned PTY so `pty-data`
   * emitted before the terminal subscribes is held, not dropped. Used by the
   * burner terminal, whose PTY spawns outside the session-restore path.
   */
  registerPending: (ptyId: string) => void
  /**
   * Drop the spawn→attach buffer for a PTY. The burner hook calls this when it
   * reaps a burner shell (host pane / session closed) or re-spawns one that
   * self-exited, so the dead shell's buffered output never reaches a new
   * subscriber.
   */
  dropAllForPty: (ptyId: string) => void
}

export interface SetPaneUserLabelOptions {
  ifCurrentLabel?: string | undefined
}

const normalizePaneUserLabel = (
  label: string | undefined
): string | undefined => {
  const trimmed = label?.trim()

  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

// The browser partition's sessionId segment is the workspace session id,
// decoupled from any shell PTY so browser-only sessions are first-class.
const browserSessionIdForSession = (session: Session): string => session.id

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

// Generated AgentPhase is lower-camel (serde rename_all camelCase).
const phaseToStatus: Record<AgentPhase, SessionStatus> = {
  running: 'running',
  idle: 'idle',
  awaiting: 'awaiting',
}

const log = createLogger('sessions')

export const useSessionManager = (
  service: ITerminalService,
  options: UseSessionManagerOptions = {}
): SessionManager => {
  const { autoCreateOnEmpty = true } = options

  const [sessions, setSessions] = useState<Session[]>([])
  const [restoreSucceeded, setRestoreSucceeded] = useState(false)
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
  // Per-pty agent-session identity: rejects stale lifecycle events from a
  // previous agent run that share the same ptyId but a different agentSessionId
  // (Codex P2 finding on PR #421).
  const agentSessionIdsRef = useRef(new Map<string, string>())

  const buffer = usePtyBufferDrain()
  const { notifyPaneReady, registerPending, dropAllForPty } = buffer

  const { loading } = useSessionRestore({
    service,
    buffer,
    onRestore: (restored): void => {
      setRestoreSucceeded(true)
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

          // Keep restored cache order first; sessions created during the
          // restore window are user-created additions and append after it.
          return [...restoredOnly, ...prev]
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
    // The store's persisted-active session is selected through the
    // browser-capable setActiveSessionId so a browser-only session is
    // selectable on restore (spec §5).
    onActivePersisted: (id): void => {
      if (activeSessionIdRef.current === null) {
        setActiveSessionId(id)
      }
    },
    // Single-project defaults until real multi-project state exists; the load
    // command uses them as repair fallbacks for records missing the fields.
    projectId: 'proj-1',
    workingDirectory: '~',
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
  const onPtyExitRef = useRef<(ptyId: string, code: number | null) => void>(
    () => undefined
  )
  onPtyExitRef.current = (ptyId: string, code: number | null): void => {
    const exitedAt = new Date().toISOString()

    const status: SessionStatus =
      code != null && code !== 0 ? 'errored' : 'completed'

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
                status,
                agentType: 'generic' as const,
              }
            : p
        )
        const activePane = newPanes.find((p) => p.active)

        return {
          ...s,
          status: deriveShellSessionStatus(newPanes),
          agentType: activePane?.agentType ?? s.agentType,
          panes: newPanes,
          lastActivityAt: exitedAt,
        }
      })
    )
  }

  const onPtyErrorRef = useRef<(ptyId: string) => void>(() => undefined)
  onPtyErrorRef.current = (ptyId: string): void => {
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
                status: 'errored' as const,
                agentType: 'generic' as const,
              }
            : p
        )
        const activePane = newPanes.find((p) => p.active)

        return {
          ...s,
          status: deriveShellSessionStatus(newPanes),
          agentType: activePane?.agentType ?? s.agentType,
          panes: newPanes,
          lastActivityAt: exitedAt,
        }
      })
    )
  }

  usePtyExitListener({
    service,
    onExit: (ptyId, code) => onPtyExitRef.current(ptyId, code),
  })

  useEffect(() => {
    let cancelled = false
    let unsubscribeError: (() => void) | undefined

    void (async (): Promise<void> => {
      let fn: () => void
      try {
        fn = await service.onError((sessionId) => {
          onPtyErrorRef.current(sessionId)
        })
      } catch {
        return
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (cancelled) {
        fn()

        return
      }

      unsubscribeError = fn
    })()

    return (): void => {
      cancelled = true
      unsubscribeError?.()
    }
  }, [service])

  useEffect(() => {
    if (!isDesktop()) {
      return
    }

    let cancelled = false
    let unlistenFn: UnlistenFn | undefined

    void (async (): Promise<void> => {
      let fn: UnlistenFn
      try {
        fn = await listen<AgentSessionTitleEvent>(
          'agent-session-title',
          (payload) => {
            // Title events are a reliable run-start signal: a new
            // agentSessionId here means the pane's active agent run has
            // changed, so future lifecycle comparisons must use this id.
            agentSessionIdsRef.current.set(
              payload.sessionId,
              payload.agentSessionId
            )

            const cleared = payload.title.length === 0
            const nextTitle = cleared ? undefined : payload.title
            const nextSource = cleared ? undefined : payload.source

            setSessions((prev) => {
              const matchExists = prev.some((session) =>
                session.panes.some((pane) => pane.ptyId === payload.sessionId)
              )
              if (!matchExists) {
                return prev
              }

              return prev.map((session) => ({
                ...session,
                panes: session.panes.map((pane) => {
                  if (pane.ptyId !== payload.sessionId) {
                    return pane
                  }

                  // Once the pane's title was set by an explicit user
                  // rename (agentTitleSource === 'user-renamed'), the
                  // user's intent is sticky against ai-generated events.
                  // This covers both Claude's later auto-summary (a
                  // non-empty ai-generated title that would otherwise
                  // overwrite agentTitle) and Codex's transient clear (an
                  // empty title from `read_thread_name` returning None
                  // during an atomic rewrite of session_index.jsonl — the
                  // tailer emits it with source ai-generated because the
                  // pending rename claim was already consumed).
                  //
                  // user-renamed events fall through to the existing
                  // logic so the user can rename again, and so an
                  // explicit lifecycle reset (`user-renamed` + empty)
                  // can clear the sticky state via the standard cleared
                  // path below.
                  if (
                    pane.agentTitleSource === 'user-renamed' &&
                    payload.source === 'ai-generated'
                  ) {
                    return pane
                  }

                  // A matching confirmed `/rename` (`user-renamed`) means the
                  // agent transcript has caught up with the temporary local
                  // label, so let `agentTitle` render. Other title updates must
                  // not erase an explicit local pane label unless the agent
                  // watcher is clearing title state for the session lifecycle.
                  const confirmedCurrentUserLabel =
                    payload.source === 'user-renamed' &&
                    pane.userLabel === payload.title

                  const nextUserLabel =
                    cleared || confirmedCurrentUserLabel
                      ? undefined
                      : pane.userLabel

                  return {
                    ...pane,
                    agentTitle: nextTitle,
                    agentTitleSource: nextSource,
                    userLabel: nextUserLabel,
                  }
                }),
              }))
            })
          }
        )
      } catch {
        return
      }

      // cancelled may flip while the listener promise is awaiting.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (cancelled) {
        fn()
      } else {
        unlistenFn = fn
      }
    })()

    return (): void => {
      cancelled = true
      unlistenFn?.()
    }
  }, [])

  // Bridge: write the agent's derived lifecycle phase into pane.status.
  useEffect(() => {
    if (!isDesktop()) {
      return
    }

    let cancelled = false
    let unlistenFn: UnlistenFn | undefined

    void (async (): Promise<void> => {
      let fn: UnlistenFn
      try {
        fn = await listen<AgentLifecycleEvent>('agent-lifecycle', (payload) => {
          setSessions((prev) =>
            prev.map((session) => {
              const idx = session.panes.findIndex(
                (pane) => pane.ptyId === payload.sessionId
              )
              if (idx === -1) {
                return session
              }

              // Sticky terminal: a late/replayed event must not resurrect an
              // exited pane. v1 is last-writer-wins among live phases.
              if (isTerminalStatus(session.panes[idx].status)) {
                return session
              }

              // Reject stale lifecycle events from an old agent run that
              // share the same ptyId but carry a different agentSessionId.
              const currentAgentId = agentSessionIdsRef.current.get(
                payload.sessionId
              )
              if (
                currentAgentId !== undefined &&
                currentAgentId !== payload.agentSessionId
              ) {
                return session
              }
              agentSessionIdsRef.current.set(
                payload.sessionId,
                payload.agentSessionId
              )

              const newPanes = session.panes.map((pane, i) =>
                i === idx
                  ? { ...pane, status: phaseToStatus[payload.phase] }
                  : pane
              )

              return {
                ...session,
                status: deriveShellSessionStatus(newPanes),
                panes: newPanes,
              }
            })
          )
        })
      } catch {
        return
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (cancelled) {
        fn()
      } else {
        unlistenFn = fn
      }
    })()

    return (): void => {
      cancelled = true
      unlistenFn?.()
    }
  }, [])

  // Create session — spawn + append, then mark the pane as 'attach'.
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
              activityPanelCollapsed: false,
              panes: [
                {
                  kind: 'shell',
                  id: 'p0',
                  ptyId: result.sessionId,
                  cwd: result.cwd,
                  shell: result.shell,
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

            return [...prev, newSession]
          })
        })

        // Cache ordering is persisted by `usePushWorkspaceGrouping` on the
        // sessions[] change above — `set_workspace_sessions` now rebuilds
        // `session_order` atomically with the grouping write, so we no
        // longer need (and previously erroneously used) the legacy
        // `reorder_sessions` IPC here. That IPC's permutation check
        // expected ALL PTY ids while this site sent only active-per-
        // workspace ids, which silently rejected as soon as any other
        // workspace had >1 pane — see PR #290 review thread.

        setActiveSessionId(newSessionId)
        registerPtySession(result.sessionId, result.sessionId, result.cwd)
      } catch (err) {
        log.warn('spawn failed', err)
      } finally {
        setPendingSpawns((c) => c - 1)
      }
    })()
  }, [registerPending, service, setActiveSessionId])

  // Create a browser-only session from scratch (spec §6.2): one runtime browser
  // pane, NO PTY spawn. Main creates the WebContents seeded with the default
  // url; the partition derives from the session id. A shell added later via
  // addPane spawns from `workingDirectory`.
  const createBrowserSession = useCallback((): void => {
    const now = new Date().toISOString()
    const newSessionId = crypto.randomUUID()
    const workingDirectory = '~'

    flushSync(() => {
      setSessions((prev) => {
        const newSession: Session = {
          id: newSessionId,
          projectId: 'proj-1',
          name: `browser ${prev.length + 1}`,
          status: 'running',
          workingDirectory,
          agentType: 'generic',
          layout: 'single',
          activityPanelCollapsed: false,
          panes: [
            {
              kind: 'browser',
              id: 'p0',
              ptyId: `browser:${crypto.randomUUID()}`,
              cwd: workingDirectory,
              agentType: 'generic',
              status: 'running',
              active: true,
              browserUrl: DEFAULT_BROWSER_URL,
            },
          ],
          createdAt: now,
          lastActivityAt: now,
          activity: { ...emptyActivity },
        }

        return [...prev, newSession]
      })
    })

    // Fire-and-forget but guarded: a rejection (bridge/main unavailable during
    // startup/shutdown) must not surface as an unhandled rejection. BrowserPane
    // re-issues the create on mount via main's reconnect path.
    void (async (): Promise<void> => {
      try {
        await createBrowserPane({
          sessionId: newSessionId,
          paneId: 'p0',
          workspaceId: 'proj-1',
          initialUrl: DEFAULT_BROWSER_URL,
        })
      } catch (err) {
        log.warn('createBrowserSession: createBrowserPane failed', err)
      }
    })()

    setActiveSessionId(newSessionId)
  }, [setActiveSessionId])

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
  // A live session = a running shell PTY OR a browser pane. A browser-only
  // session restored from the durable store has no shell but is a usable
  // workspace, so it must not trigger the empty-workspace seed.
  const hasLiveSession = sessions.some((s) =>
    s.panes.some(
      (pane) =>
        (isShellPane(pane) && isLiveStatus(pane.status)) ||
        (isBrowserPane(pane) && isLiveStatus(pane.status))
    )
  )
  useAutoCreateOnEmpty({
    enabled: autoCreateOnEmpty,
    loading,
    hasLiveSession,
    pendingSpawns,
    createSession,
  })

  // Push pane grouping (workspace id + layout + pane shape) to the Rust
  // cache whenever the React `sessions[]` structure changes, so a later
  // restore can reconstruct the multi-pane layout instead of fragmenting
  // each PTY into its own single-pane session. Debounced inside the hook.
  usePushWorkspaceGrouping({
    sessions,
    activeSessionId,
    loading,
    canPushEmptyShape: restoreSucceeded,
  })

  // Remove session — kill + filter + advance active
  const removeSession = useCallback(
    (id: string): void => {
      void (async (): Promise<void> => {
        const target = sessionsRef.current.find((s) => s.id === id)
        if (!target) {
          log.warn(`removeSession: no session with id ${id}`)

          return
        }

        // Snapshot the ptyIds at the time the kill IPC fires. Used both
        // for the kill loop and the (separate) post-await diff against
        // any new ptyIds the session has acquired during the await
        // window (concurrent restartSession would rotate pane.ptyId).
        const snapshotPtyIds = target.panes
          .filter(isShellPane)
          .map((pane) => pane.ptyId)

        const results = await Promise.allSettled(
          snapshotPtyIds.map((ptyId) => service.kill({ sessionId: ptyId }))
        )

        const rejected = results.filter(
          (result) => result.status === 'rejected'
        )
        if (rejected.length > 0) {
          for (const result of rejected) {
            log.warn('removeSession: kill failed for a pane', result.reason)
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
          ? currentTarget.panes.filter(isShellPane).map((pane) => pane.ptyId)
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
              log.warn(
                'removeSession: kill of post-await orphan PTY failed',
                result.reason
              )
            }

            // Same bail policy as above — refuse to drop the React
            // session if any PTY remains unkilled.
            return
          }
        }

        const currentBrowserTarget =
          sessionsRef.current.find((s) => s.id === id) ?? target

        const browserPanes = currentBrowserTarget.panes.filter(
          (pane) => !isShellPane(pane)
        )

        const browserResults = await Promise.allSettled(
          browserPanes.map((pane) =>
            destroyBrowserPane({
              sessionId: browserSessionIdForSession(currentBrowserTarget),
              paneId: pane.id,
            })
          )
        )

        const browserRejected = browserResults.filter(
          (result) => result.status === 'rejected'
        )

        if (browserRejected.length > 0) {
          for (const result of browserRejected) {
            log.warn(
              'removeSession: browser pane cleanup failed',
              result.reason
            )
          }
        }

        // Drop bookkeeping for ALL ptys we killed (snapshot + post-await
        // orphans).
        const allKilledPtyIds = [...snapshotPtyIds, ...newPtyIds]
        for (const ptyId of allKilledPtyIds) {
          dropAllForPty(ptyId)
          deleteCacheHistory(ptyId)
          restoreDataRef.current.delete(ptyId)
          unregisterPtySession(ptyId)
        }
        restoreDataRef.current.delete(target.id)

        // Replaces the implicit cleanup the Rust PTY cache used to do on
        // session exit. Without it, every closed session leaves a stale
        // `vimeflow:sessions:activityPanelCollapsed:<id>` key in
        // localStorage forever. Runs only on the happy path (after both
        // kill phases settle) so a partial-kill bail-out doesn't drop
        // the preference for a session the user can still see.
        deleteActivityPanelCollapsed(target.id)

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
        log.warn(`setSessionLayout: no session ${sessionId}`)

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
      //
      // Round 13, Claude MEDIUM: serialize against in-flight addPane /
      // removePane on the same session. Without this guard, a focus
      // rotation can fire `service.setActiveSession(target.ptyId)` while
      // a concurrent removePane has `service.kill(target.ptyId)` in
      // flight — Rust may briefly set the active session to a PTY that
      // is being killed, dropping any keystroke delivered during the
      // ~10–50ms window. removePane's own setActiveSession(newActive)
      // self-corrects the state, but the dropped input is unrecoverable.
      // Treat focus rotation as a no-op while a lifecycle op is pending
      // (the target pane may evaporate anyway when the remove commits).
      // Warn for parity with every other guarded early-return in this
      // function (and in addPane / removePane): otherwise a developer
      // chasing a "⌘1-4 stopped working for 50–300ms" report sees
      // nothing in devtools and can't distinguish the transient
      // suppression from a real bug.
      if (pendingPaneOps.current.has(sessionId)) {
        log.warn(
          `setSessionActivePane: pane op in flight for ${sessionId}; ignoring`
        )

        return
      }
      const session = sessionsRef.current.find((s) => s.id === sessionId)
      if (!session) {
        log.warn(`setSessionActivePane: no session ${sessionId}`)

        return
      }
      const target = session.panes.find((p) => p.id === paneId)
      if (!target) {
        log.warn(
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

      if (sessionId === activeSessionIdRef.current && isShellPane(target)) {
        // eslint-disable-next-line promise/prefer-await-to-then
        service.setActiveSession(target.ptyId).catch((err) => {
          log.warn('setSessionActivePane: setActiveSession failed', err)
        })
      }
    },
    [activeSessionIdRef, service]
  )

  const addPane = useCallback(
    (sessionId: string, kind: PaneKind = 'shell'): void => {
      if (pendingPaneOps.current.has(sessionId)) {
        log.warn(
          `addPane: another pane op in flight for ${sessionId}; ignoring`
        )

        return
      }

      const session = sessionsRef.current.find((s) => s.id === sessionId)
      if (!session) {
        log.warn(`addPane: no session ${sessionId}`)

        return
      }

      const activePane = findActivePane(session)
      if (!activePane) {
        log.warn(`addPane: session ${sessionId} has no active pane`)

        return
      }

      if (session.panes.length >= LAYOUTS[session.layout].capacity) {
        log.warn(
          `addPane: session ${sessionId} is at capacity for layout ${session.layout}`
        )

        return
      }

      if (kind === 'browser') {
        pendingPaneOps.current.add(sessionId)
        try {
          const fresh = sessionsRef.current.find((s) => s.id === sessionId)
          if (!fresh) {
            log.warn(`addPane: no session ${sessionId}`)

            return
          }

          const newPane: Pane = {
            kind: 'browser',
            id: nextFreePaneId(fresh.panes),
            ptyId: `browser:${crypto.randomUUID()}`,
            cwd: fresh.workingDirectory,
            agentType: 'generic',
            status: 'running',
            active: true,
            browserUrl: DEFAULT_BROWSER_URL,
          }

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
            log.warn(`addPane: reducer rejected browser pane ${sessionId}`)
          }
        } finally {
          pendingPaneOps.current.delete(sessionId)
        }

        return
      }

      pendingPaneOps.current.add(sessionId)
      setPendingSpawns((count) => count + 1)

      void (async (): Promise<void> => {
        try {
          // New panes start from the stable session baseline. The active pane
          // cwd is live per-pane state and may point at an agent task path; do
          // not leak that pane-local agent context into fresh shells.
          const spawnCwd = session.workingDirectory

          const result = await service.spawn({
            cwd: spawnCwd,
            env: {},
            enableAgentBridge: true,
          })

          const fresh = sessionsRef.current.find((s) => s.id === sessionId)
          if (!fresh) {
            // F6 tombstone-first (mirrors the `!appended` path and the
            // invariant in usePtyBufferDrain.ts): drop the orphan's
            // pty-data buffer BEFORE awaiting kill, so any pty-data
            // event arriving during the kill round-trip is rejected
            // by the tombstone instead of being buffered for a
            // consumer that will never mount.
            dropAllForPty(result.sessionId)
            try {
              await service.kill({ sessionId: result.sessionId })
            } catch (err) {
              log.warn('addPane: failed to kill orphan PTY', err)
            }

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
            kind: 'shell',
            id: nextFreePaneId(fresh.panes),
            ptyId: result.sessionId,
            cwd: result.cwd,
            shell: result.shell,
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
              log.warn('addPane: failed to kill reducer-rejected PTY', err)
            }
            log.warn(
              `addPane: reducer rejected commit for ${sessionId}; orphan killed`
            )

            return
          }

          if (sessionId === activeSessionIdRef.current) {
            // eslint-disable-next-line promise/prefer-await-to-then
            service.setActiveSession(result.sessionId).catch((err) => {
              log.warn('addPane: setActiveSession failed', err)
            })
          }

          registerPtySession(result.sessionId, result.sessionId, result.cwd)
        } catch (err) {
          log.warn('addPane: spawn failed', err)
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
        log.warn(
          `removePane: another pane op in flight for ${sessionId}; ignoring`
        )

        return
      }

      const session = sessionsRef.current.find((s) => s.id === sessionId)
      if (!session) {
        log.warn(`removePane: no session ${sessionId}`)

        return
      }

      const target = session.panes.find((pane) => pane.id === paneId)
      if (!target) {
        log.warn(`removePane: no pane ${paneId} in session ${sessionId}`)

        return
      }

      if (session.panes.length === 1) {
        log.warn(
          `removePane: refusing to remove the last pane in ${sessionId}; use removeSession instead`
        )

        return
      }

      pendingPaneOps.current.add(sessionId)

      void (async (): Promise<void> => {
        try {
          if (isShellPane(target)) {
            try {
              await service.kill({ sessionId: target.ptyId })
            } catch (err) {
              log.warn('removePane: kill failed; pane preserved', err)

              return
            }

            dropAllForPty(target.ptyId)
            deleteCacheHistory(target.ptyId)
            restoreDataRef.current.delete(target.ptyId)
            unregisterPtySession(target.ptyId)
          } else {
            try {
              await destroyBrowserPane({
                sessionId: browserSessionIdForSession(session),
                paneId,
              })
            } catch (err) {
              log.warn('removePane: browser pane cleanup failed', err)

              return
            }
          }

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

          let backendActivePtyId = newActivePtyId
          if (
            backendActivePtyId === undefined &&
            isShellPane(target) &&
            sessionId === activeSessionIdRef.current
          ) {
            const fresh = sessionsRef.current.find((s) => s.id === sessionId)
            const activePane = fresh ? findActivePane(fresh) : undefined
            if (activePane && !isShellPane(activePane)) {
              backendActivePtyId = fresh?.panes.find(isShellPane)?.ptyId
            }
          }

          if (
            backendActivePtyId !== undefined &&
            sessionId === activeSessionIdRef.current
          ) {
            // eslint-disable-next-line promise/prefer-await-to-then
            service.setActiveSession(backendActivePtyId).catch((err) => {
              log.warn('removePane: setActiveSession failed', err)
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
          log.warn(`restartSession: no session with id ${sessionId}`)

          return
        }

        // Restart the active shell when one is focused; only fall back to
        // another shell when the active pane is a browser (so a browser-active
        // session is still restartable without targeting the wrong PTY).
        const activePane = getActivePane(oldSession)

        const oldPane = isShellPane(activePane)
          ? activePane
          : oldSession.panes.find(isShellPane)
        if (!oldPane || !isShellPane(oldPane)) {
          log.warn('restartSession: no shell pane found')

          return
        }
        const cachedCwd = oldPane.cwd

        let result: {
          sessionId: string
          pid: number
          cwd: string
          shell: string
        }
        try {
          result = await service.spawn({
            cwd: cachedCwd,
            env: {},
            enableAgentBridge: true,
          })
        } catch (err) {
          log.warn('restartSession: spawn failed; old session preserved', err)

          return
        }

        // Skip the kill when the seed ptyId is already gone (restore placeholder).
        let oldPtyPresent = true
        try {
          const live = await service.listSessions()
          oldPtyPresent = live.sessions.some(
            (info) => info.id === oldPane.ptyId
          )
        } catch (err) {
          log.warn(
            'restartSession: listSessions failed; assuming old pty present',
            err
          )
        }

        if (oldPtyPresent) {
          try {
            await service.kill({ sessionId: oldPane.ptyId })
          } catch (err) {
            log.warn(
              'restartSession: kill of old ptyId failed; killing new orphan',
              err
            )
            // eslint-disable-next-line promise/prefer-await-to-then,@typescript-eslint/no-empty-function
            service.kill({ sessionId: result.sessionId }).catch((): void => {})

            return
          }
        }

        dropAllForPty(oldPane.ptyId)
        deleteCacheHistory(oldPane.ptyId)
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
              shell: result.shell,
              status: 'running',
              agentType: 'generic',
              pid: result.pid,
              restoreData,
              // Clear sticky title state so the new PTY session starts
              // fresh — a user-renamed pane must not block ai-generated
              // titles from the new agent session.
              agentTitle: undefined,
              agentTitleSource: undefined,
              userLabel: undefined,
              cacheHistory: [],
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

            return next
          })
        })

        if (orphanedSessionId !== null) {
          // eslint-disable-next-line promise/prefer-await-to-then,@typescript-eslint/no-empty-function
          service.kill({ sessionId: orphanedSessionId }).catch((): void => {})
          restoreDataRef.current.delete(orphanedSessionId)
          restoreDataRef.current.delete(oldSession.id)
          dropAllForPty(orphanedSessionId)
          unregisterPtySession(orphanedSessionId)
        }

        // Cache ordering is persisted by `usePushWorkspaceGrouping` on the
        // sessions[] change above (see createSession for the rationale).

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

  // Set a per-pane user label — in-memory only (no IPC). The chord
  // hook calls this for every rename; for Claude/Codex panes it ALSO
  // dispatches the `rename_agent_session` IPC so the agent's transcript
  // stays in sync. See `pane.userLabel` doc in `../types/index.ts`.
  const setPaneUserLabel = useCallback(
    (
      ptyId: string,
      label: string | undefined,
      setOptions?: SetPaneUserLabelOptions
    ): void => {
      const next = normalizePaneUserLabel(label)

      const hasExpectedCurrentLabel =
        setOptions !== undefined && 'ifCurrentLabel' in setOptions

      const expectedCurrentLabel = hasExpectedCurrentLabel
        ? normalizePaneUserLabel(setOptions.ifCurrentLabel)
        : undefined

      setSessions((prev) => {
        const matchExists = prev.some((session) =>
          session.panes.some((pane) => pane.ptyId === ptyId)
        )
        if (!matchExists) {
          return prev
        }

        return prev.map((session) => ({
          ...session,
          panes: session.panes.map((pane) => {
            if (pane.ptyId !== ptyId) {
              return pane
            }

            if (
              hasExpectedCurrentLabel &&
              pane.userLabel !== expectedCurrentLabel
            ) {
              return pane
            }

            return { ...pane, userLabel: next }
          }),
        }))
      })
    },
    []
  )

  // Reorder sessions — purely a React-state update.
  //
  // Cache persistence is owned by `usePushWorkspaceGrouping`, which fires on
  // every `sessions[]` change and pushes the full snapshot via
  // `set_workspace_sessions`; that IPC now rebuilds `session_order` from the
  // snapshot's workspace * pane-index ordering, atomically with the grouping
  // write. So the legacy `reorder_sessions` IPC is redundant here.
  //
  // Use a FUNCTIONAL updater that merges the incoming order against the
  // latest committed `prev` rather than overwriting it. The caller passes a
  // snapshot built at drag-start; if an `addPane` (or `restartSession`,
  // `removePane`, `createSession`) commits between drag-start and
  // setSessions landing — a real ~50–500 ms window for the spawn IPC —
  // overwriting with the stale snapshot would silently erase the new pane
  // from React state while its PTY stays alive in Rust. Merge keys: take
  // `reordered`'s ORDER but each session's CONTENTS from `prev` (lookup by
  // session id). Sessions present in `prev` but absent from `reordered`
  // (e.g. a `createSession` that landed during the reorder) are appended
  // at the end so they survive the merge instead of disappearing.
  //
  // The active-pane invariant check is preserved — committing a session
  // without an active pane would trip the SplitView's `getActivePane` on
  // the next render.
  const reorderSessions = useCallback((reordered: Session[]): void => {
    const hasInvariantHole = reordered.some(
      (s) => findActivePane(s) === undefined
    )
    if (hasInvariantHole) {
      log.warn(
        'reorderSessions: skipping — at least one session has no active pane'
      )

      return
    }
    setSessions((prev) => {
      const prevById = new Map(prev.map((s) => [s.id, s]))
      const reorderedIds = new Set(reordered.map((s) => s.id))

      // DROP, don't fall back to the stale `s`, when `reordered` references
      // a session no longer present in `prev`. A `removeSession` (or a
      // pty-exit-driven cleanup) that committed during the drag would have
      // evicted that id from `prev`; restoring the stale snapshot here
      // would resurrect a zombie session whose PTY is already dead and the
      // tab can no longer be closed (kill_pty rejects "session not found"
      // and React filters can't find the id).
      const ordered = reordered.flatMap((s) => {
        const live = prevById.get(s.id)

        return live ? [live] : []
      })
      const extras = prev.filter((s) => !reorderedIds.has(s.id))

      return [...ordered, ...extras]
    })
  }, [])

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

          return {
            ...session,
            panes,
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
        log.warn('updatePaneCwd IPC failed', err)
      })
    },
    [service]
  )

  const appendPaneCacheReading = useCallback(
    (sessionId: string, paneId: string, percentage: number): void => {
      const target = sessionsRef.current.find((s) => s.id === sessionId)
      const targetPane = target?.panes.find((p) => p.id === paneId)
      if (!targetPane) {
        return
      }

      const current = targetPane.cacheHistory ?? []
      const next = pushCacheReading(current, percentage)
      if (next === current) {
        return
      }

      writeCacheHistory(targetPane.ptyId, next)

      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== sessionId) {
            return session
          }

          const panes = session.panes.map((pane) =>
            pane.id === paneId ? { ...pane, cacheHistory: next } : pane
          )

          return { ...session, panes }
        })
      )
    },
    []
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

  const updateBrowserPaneUrl = useCallback(
    (sessionId: string, paneId: string, browserUrl: string): void => {
      setSessions((prev) => {
        const sessionIndex = prev.findIndex(
          (session) => session.id === sessionId
        )

        if (sessionIndex === -1) {
          return prev
        }

        const session = prev[sessionIndex]

        const paneIndex = session.panes.findIndex(
          (pane) => pane.id === paneId && !isShellPane(pane)
        )

        if (paneIndex === -1) {
          return prev
        }

        const pane = session.panes[paneIndex]
        if (pane.browserUrl === browserUrl) {
          return prev
        }

        const panes = [
          ...session.panes.slice(0, paneIndex),
          { ...pane, browserUrl },
          ...session.panes.slice(paneIndex + 1),
        ]
        const updatedSession = { ...session, panes }

        return [
          ...prev.slice(0, sessionIndex),
          updatedSession,
          ...prev.slice(sessionIndex + 1),
        ]
      })
    },
    []
  )

  const setSessionActivityPanelCollapsed = useCallback(
    (sessionId: string, collapsed: boolean): void => {
      const session = sessionsRef.current.find((s) => s.id === sessionId)
      if (!session || session.activityPanelCollapsed === collapsed) {
        return
      }

      writeActivityPanelCollapsed(sessionId, collapsed)
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, activityPanelCollapsed: collapsed } : s
        )
      )
    },
    []
  )

  const updateSessionCwd = useCallback((id: string, cwd: string): void => {
    const target = sessionsRef.current.find((s) => s.id === id)
    if (!target) {
      return
    }

    if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
      log.warn(
        'updateSessionCwd is deprecated; use updatePaneCwd for live PTY cwd sync'
      )
    }

    // State-only baseline update. `updatePaneCwd` is the live PTY cwd path and
    // is responsible for calling `service.updateSessionCwd`.
    setSessions((prev) =>
      prev.map((session) =>
        session.id === id ? { ...session, workingDirectory: cwd } : session
      )
    )
  }, [])

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
    createBrowserSession,
    removeSession,
    setSessionLayout,
    setSessionActivePane,
    addPane,
    removePane,
    restartSession,
    renameSession,
    setPaneUserLabel,
    reorderSessions,
    updatePaneCwd,
    appendPaneCacheReading,
    updatePaneAgentType,
    updateBrowserPaneUrl,
    setSessionActivityPanelCollapsed,
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
    registerPending,
    dropAllForPty,
  }
}
