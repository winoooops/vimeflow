// cspell:ignore Ghostty
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { flushSync } from 'react-dom'
import type {
  CreateSessionOptions,
  LayoutSlotId,
  NewPaneSpec,
  Pane,
  PaneKind,
  PaneLayoutId,
  PanePlacement,
  Session,
  SessionStatus,
} from '../types'
import type {
  AgentLifecycleEvent,
  AgentPhase,
  AgentSessionTitleEvent,
} from '../../../bindings'
import { invoke, listen, type UnlistenFn } from '../../../lib/backend'
import { isDesktop } from '../../../lib/environment'
import type { ITerminalService } from '../../terminal/services/terminalService'
import {
  PaneLayoutRegistry,
  isCustomPaneLayoutId,
  MAX_BUILTIN_PANE_COUNT,
  type PaneLayoutDefinition,
} from '../../terminal/layout-registry'
import type {
  RestoreData,
  PaneEventHandler,
  NotifyPaneReadyResult,
  PTYSpawnResult,
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
  hasLivePane,
  isOpenSession,
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
import type { AgentStatusEvent } from '../../agent-status/types'
import { isShellPane } from '../utils/paneKind'
import { commandToPane } from '../utils/commandToPane'
import { deriveSessionName } from '../utils/sessionPaths'
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
import {
  agentLauncherFromCommand,
  buildAgentResumeCommand,
  buildAgentStartCommand,
  loadAgentAliasConfig,
  submittedLauncherTokenFromCommand,
  type AgentAliasConfig,
} from '../utils/agentResumeCommand'
import { createLogger } from '../../../lib/log'

export type { RestoreData, PaneEventHandler, NotifyPaneReadyResult }

export interface SessionManager {
  sessions: Session[]
  activeSessionId: string | null
  setActiveSessionId: (id: string) => void
  createSession: (opts?: CreateSessionOptions) => void
  createBrowserSession: () => void
  removeSession: (id: string) => void
  customPaneLayouts: readonly PaneLayoutDefinition[]
  layoutRegistry: PaneLayoutRegistry
  setCustomPaneLayouts: (
    updater:
      | readonly PaneLayoutDefinition[]
      | ((
          previous: readonly PaneLayoutDefinition[]
        ) => readonly PaneLayoutDefinition[]),
    setOptions?: { skipPreservation?: boolean }
  ) => void
  setSessionLayout: (sessionId: string, layoutId: PaneLayoutId) => void
  /**
   * Replace a session's explicit pane-to-slot placements (VIM-167
   * drag-into-slot swap/move). The supplied array is written verbatim — the
   * caller (SplitView drop handler) computes a fully-normalized placement list
   * via `swapPanePlacements` / `movePaneToSlot`, so this action stays a thin
   * setter. Persisted through the same workspace push bridge as every other
   * `sessions[]` change. No-op on an unknown session id.
   */
  setSessionPlacements: (
    sessionId: string,
    placements: readonly PanePlacement[]
  ) => void
  setSessionActivePane: (sessionId: string, paneId: string) => void
  addPane: (sessionId: string, kind?: PaneKind, slotId?: LayoutSlotId) => void
  removePane: (sessionId: string, paneId: string) => void
  /**
   * Recreate a shell pane in its saved cwd. Resume its exact agent conversation
   * when a safe persisted identity is available; legacy panes without one use
   * the agent's native latest-conversation command once per agent/canonical cwd
   * so duplicate panes cannot attach to the same conversation. The stable
   * workspace and pane ids remain unchanged while `pane.ptyId` rotates.
   *
   * No-op if the session/pane is unknown. Spawn and resume-write errors leave
   * the old pane retryable and surface through the configured error callback.
   */
  restartSession: (id: string, paneId?: string) => void
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
  /** Record the canonical executable or configured alias submitted in a pane. */
  recordPaneAgentLauncher: (ptyId: string, command: string) => void
  invalidatePaneAgentSession: (
    sessionId: string,
    paneId: string,
    agentSessionId: string | null,
    tokenTotal: number | null
  ) => void
  appendPaneCacheReading: (
    sessionId: string,
    paneId: string,
    percentage: number
  ) => void
  clearPaneCacheHistory: (sessionId: string, paneId: string) => void
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
  onTerminalSpawnError?: (message: string) => void
}

const spawnErrorMessage = (action: string, error: unknown): string => {
  const detail = error instanceof Error ? error.message : String(error)

  return `${action}: ${detail}`
}

// Generated AgentPhase is lower-camel (serde rename_all camelCase).
const phaseToStatus: Record<AgentPhase, SessionStatus> = {
  running: 'running',
  idle: 'idle',
  awaiting: 'awaiting',
}

const bindAgentSessionId = (pane: Pane, agentSessionId: string | null): Pane =>
  agentSessionId && pane.agentSessionId !== agentSessionId
    ? { ...pane, agentSessionId }
    : pane

const log = createLogger('sessions')
const RESUMED_AGENT_WATCHER_MAX_RETRY_DELAY_MS = 2000
const RESUMED_AGENT_WATCHER_MAX_ATTEMPTS = 20
const AGENT_ALIAS_MISS_TTL_MS = 30_000

const stopAgentWatcher = async (ptyId: string): Promise<void> => {
  try {
    await invoke('stop_agent_watcher', { sessionId: ptyId })
  } catch {
    // The watcher may already have stopped with its agent/PTY.
  }
}

export const useSessionManager = (
  service: ITerminalService,
  options: UseSessionManagerOptions = {}
): SessionManager => {
  const { autoCreateOnEmpty = true, onTerminalSpawnError } = options

  const [sessions, setSessions] = useState<Session[]>([])

  const [customPaneLayouts, setCustomPaneLayoutsState] = useState<
    readonly PaneLayoutDefinition[]
  >([])
  const customPaneLayoutsRef = useRef(customPaneLayouts)
  customPaneLayoutsRef.current = customPaneLayouts

  const layoutRegistry = useMemo(
    () => new PaneLayoutRegistry(customPaneLayouts),
    [customPaneLayouts]
  )
  const layoutRegistryRef = useRef(layoutRegistry)
  layoutRegistryRef.current = layoutRegistry

  const setCustomPaneLayouts = useCallback(
    (
      updater:
        | readonly PaneLayoutDefinition[]
        | ((
            previous: readonly PaneLayoutDefinition[]
          ) => readonly PaneLayoutDefinition[]),
      setOptions?: { skipPreservation?: boolean }
    ): void => {
      // Custom layouts that support more panes than any builtin layout must be
      // preserved while sessions still depend on them. Otherwise
      // autoShrinkLayoutFor falls back to grid3x2, and the backend durable
      // repair caps non-custom layouts at six panes — silently dropping extra
      // panes on the next save/reload.
      //
      // Derive the next registry at top-level (outside the layout-state
      // updater) so the session migration can be performed as a separate
      // top-level state update. Keeping setSessions out of the functional
      // updater avoids impure-updater hazards under Strict Mode / concurrent
      // rendering.

      const previous = customPaneLayoutsRef.current

      const nextCustomPaneLayouts =
        typeof updater === 'function' ? updater(previous) : updater
      const candidateRegistry = new PaneLayoutRegistry(nextCustomPaneLayouts)

      let nextRegistry: PaneLayoutRegistry

      if (setOptions?.skipPreservation) {
        nextRegistry = candidateRegistry
      } else {
        const neededLayoutIds = new Set(
          sessionsRef.current
            .filter(
              (session) =>
                isCustomPaneLayoutId(session.layout) &&
                session.panes.length > MAX_BUILTIN_PANE_COUNT
            )
            .map((session) => session.layout)
        )

        const preservedLayouts = layoutRegistryRef.current.customLayouts.filter(
          (layout) => {
            if (!neededLayoutIds.has(layout.id)) {
              return false
            }

            const dependentPaneCount = Math.max(
              ...sessionsRef.current
                .filter((session) => session.layout === layout.id)
                .map((session) => session.panes.length)
            )

            const candidateFits =
              candidateRegistry.hasLayoutId(layout.id) &&
              candidateRegistry.capacityFor(layout.id) >= dependentPaneCount

            return !candidateFits
          }
        )

        const preservedIds = new Set(
          preservedLayouts.map((layout) => layout.id)
        )

        const mergedCustomPaneLayouts = [
          ...nextCustomPaneLayouts.filter(
            (layout) => !preservedIds.has(layout.id)
          ),
          ...preservedLayouts,
        ]

        nextRegistry = new PaneLayoutRegistry(mergedCustomPaneLayouts)
      }

      const nextCustomLayouts = nextRegistry.customLayouts

      // Migrate any sessions whose current layout is no longer available or
      // no longer fits. This runs as a top-level update so it sees the latest
      // sessions state (e.g. a layout change queued just before this call).
      setSessions((prev) =>
        prev.map((session) => {
          const currentLayoutStillFits =
            nextRegistry.hasLayoutId(session.layout) &&
            session.panes.length <= nextRegistry.capacityFor(session.layout)

          if (currentLayoutStillFits) {
            return session
          }

          const nextLayout = nextRegistry.autoShrinkLayoutFor(
            session.panes.length,
            session.layout
          )

          return nextLayout === session.layout
            ? session
            : { ...session, layout: nextLayout }
        })
      )

      setCustomPaneLayoutsState(nextCustomLayouts)
    },
    []
  )
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

  const invalidatedAgentSessionsRef = useRef(
    new Map<string, { agentSessionId: string; tokenTotal: number | null }>()
  )
  const autoStartedAgentWatcherPtyIds = useRef(new Set<string>())

  const agentAliasConfigInFlightRef = useRef<Promise<AgentAliasConfig> | null>(
    null
  )
  const agentAliasMissExpiresByLauncherRef = useRef(new Map<string, number>())

  const readAgentAliasConfig =
    useCallback(async (): Promise<AgentAliasConfig> => {
      const pending =
        agentAliasConfigInFlightRef.current ?? loadAgentAliasConfig()
      agentAliasConfigInFlightRef.current = pending

      try {
        return await pending
      } finally {
        if (agentAliasConfigInFlightRef.current === pending) {
          agentAliasConfigInFlightRef.current = null
        }
      }
    }, [])

  const acceptAgentSessionEvent = useCallback(
    (
      ptyId: string,
      agentSessionId: string,
      tokenTotal?: number | null
    ): boolean => {
      const invalidated = invalidatedAgentSessionsRef.current.get(ptyId)
      if (invalidated === undefined) {
        return true
      }

      const identityChanged = agentSessionId !== invalidated.agentSessionId

      const tokensReset =
        tokenTotal !== undefined &&
        tokenTotal !== null &&
        (tokenTotal === 0 ||
          (invalidated.tokenTotal !== null &&
            tokenTotal < invalidated.tokenTotal))
      if (!identityChanged && !tokensReset) {
        return false
      }

      invalidatedAgentSessionsRef.current.delete(ptyId)

      return true
    },
    []
  )

  const invalidatePaneAgentSession = useCallback(
    (
      sessionId: string,
      paneId: string,
      agentSessionId: string | null,
      tokenTotal: number | null
    ): void => {
      const pane = sessionsRef.current
        .find((session) => session.id === sessionId)
        ?.panes.find((candidate) => candidate.id === paneId)
      if (pane === undefined || !isShellPane(pane)) {
        return
      }

      const invalidatedId =
        agentSessionId ??
        pane.agentSessionId ??
        agentSessionIdsRef.current.get(pane.ptyId)
      if (invalidatedId === undefined) {
        invalidatedAgentSessionsRef.current.delete(pane.ptyId)
      } else {
        invalidatedAgentSessionsRef.current.set(pane.ptyId, {
          agentSessionId: invalidatedId,
          tokenTotal,
        })
      }
      agentSessionIdsRef.current.delete(pane.ptyId)

      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                panes: session.panes.map((candidate) =>
                  candidate.id === paneId &&
                  candidate.agentSessionId !== undefined
                    ? { ...candidate, agentSessionId: undefined }
                    : candidate
                ),
              }
            : session
        )
      )
    },
    []
  )

  const releaseAutoStartedAgentWatcher = useCallback(
    (ptyId: string): void => {
      if (!autoStartedAgentWatcherPtyIds.current.delete(ptyId)) {
        return
      }

      const activePaneOwnsWatcher = sessionsRef.current
        .find((session) => session.id === activeSessionIdRef.current)
        ?.panes.some(
          (pane) =>
            isShellPane(pane) &&
            pane.ptyId === ptyId &&
            pane.active &&
            !isTerminalStatus(pane.status)
        )

      if (activePaneOwnsWatcher) {
        return
      }

      void stopAgentWatcher(ptyId)
    },
    [activeSessionIdRef]
  )

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
    onCustomPaneLayoutsRestore: (restoredCustomPaneLayouts): void => {
      setCustomPaneLayouts(restoredCustomPaneLayouts)
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
          open: hasLivePane(newPanes) ? s.open : false,
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
          open: hasLivePane(newPanes) ? s.open : false,
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
            if (
              !acceptAgentSessionEvent(
                payload.sessionId,
                payload.agentSessionId
              )
            ) {
              return
            }

            // Title events are a reliable run-start signal: a new
            // agentSessionId here means the pane's active agent run has
            // changed, so future lifecycle comparisons must use this id.
            agentSessionIdsRef.current.set(
              payload.sessionId,
              payload.agentSessionId
            )
            releaseAutoStartedAgentWatcher(payload.sessionId)

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

                  const boundPane = bindAgentSessionId(
                    pane,
                    payload.agentSessionId
                  )

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
                    return boundPane
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
                    ...boundPane,
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
  }, [acceptAgentSessionEvent, releaseAutoStartedAgentWatcher])

  // Status snapshots are the shared identity source for every supported
  // adapter, including Kimi and OpenCode which do not emit title events.
  useEffect(() => {
    if (!isDesktop()) {
      return
    }

    let cancelled = false
    let unlistenFn: UnlistenFn | undefined

    void (async (): Promise<void> => {
      let fn: UnlistenFn
      try {
        fn = await listen<AgentStatusEvent>('agent-status', (payload) => {
          if (!payload.agentSessionId) {
            return
          }

          const tokenTotal =
            payload.contextWindow === null
              ? null
              : Number(payload.contextWindow.totalInputTokens) +
                Number(payload.contextWindow.totalOutputTokens)
          if (
            !acceptAgentSessionEvent(
              payload.sessionId,
              payload.agentSessionId,
              tokenTotal
            )
          ) {
            return
          }

          agentSessionIdsRef.current.set(
            payload.sessionId,
            payload.agentSessionId
          )
          releaseAutoStartedAgentWatcher(payload.sessionId)

          setSessions((prev) => {
            const matchExists = prev.some((session) =>
              session.panes.some((pane) => pane.ptyId === payload.sessionId)
            )
            if (!matchExists) {
              return prev
            }

            return prev.map((session) => ({
              ...session,
              panes: session.panes.map((pane) =>
                pane.ptyId === payload.sessionId
                  ? bindAgentSessionId(pane, payload.agentSessionId)
                  : pane
              ),
            }))
          })
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
  }, [acceptAgentSessionEvent, releaseAutoStartedAgentWatcher])

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
          if (
            !acceptAgentSessionEvent(payload.sessionId, payload.agentSessionId)
          ) {
            return
          }

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
                  ? {
                      ...pane,
                      agentSessionId: payload.agentSessionId,
                      status: phaseToStatus[payload.phase],
                    }
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
  }, [acceptAgentSessionEvent])

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
  const pendingRestartPaneKeys = useRef<Set<string>>(new Set())
  const autoHydratedSessionIds = useRef<Set<string>>(new Set())

  const claimedLatestAgentResumeKeys = useRef<Map<string, Set<string>>>(
    new Map()
  )
  const resumeClaimQueueTailRef = useRef(Promise.resolve())
  const inFlightRestartPtyIds = useRef<Set<string>>(new Set())
  const restartMountedRef = useRef(true)

  const hasClaimedLatestAgentResumeKey = useCallback((key: string): boolean => {
    const owners = claimedLatestAgentResumeKeys.current.get(key)

    return owners !== undefined && owners.size > 0
  }, [])

  const claimLatestAgentResumeKey = useCallback(
    (key: string, ptyId: string): void => {
      const owners = claimedLatestAgentResumeKeys.current.get(key)
      if (owners !== undefined) {
        owners.add(ptyId)

        return
      }

      claimedLatestAgentResumeKeys.current.set(key, new Set([ptyId]))
    },
    []
  )

  const releaseLatestAgentResumeKey = useCallback(
    (key: string, ptyId: string): void => {
      const owners = claimedLatestAgentResumeKeys.current.get(key)
      if (owners === undefined) {
        return
      }

      owners.delete(ptyId)
      if (owners.size === 0) {
        claimedLatestAgentResumeKeys.current.delete(key)
      }
    },
    []
  )

  const releaseLatestAgentResumeClaimsForPty = useCallback(
    (ptyId: string): void => {
      for (const [key, owners] of claimedLatestAgentResumeKeys.current) {
        owners.delete(ptyId)
        if (owners.size === 0) {
          claimedLatestAgentResumeKeys.current.delete(key)
        }
      }
    },
    []
  )

  const disposeRestartPty = useCallback(
    async (ptyId: string): Promise<void> => {
      if (!inFlightRestartPtyIds.current.delete(ptyId)) {
        return
      }

      releaseLatestAgentResumeClaimsForPty(ptyId)
      dropAllForPty(ptyId)
      restoreDataRef.current.delete(ptyId)
      agentSessionIdsRef.current.delete(ptyId)
      invalidatedAgentSessionsRef.current.delete(ptyId)
      unregisterPtySession(ptyId)

      try {
        await service.kill({ sessionId: ptyId })
      } catch (err) {
        log.warn(`failed to kill uncommitted restart PTY ${ptyId}`, err)
      }
    },
    [dropAllForPty, releaseLatestAgentResumeClaimsForPty, service]
  )

  useEffect(() => {
    restartMountedRef.current = true
    const inFlightPtyIds = inFlightRestartPtyIds.current
    const autoStartedWatcherPtyIds = autoStartedAgentWatcherPtyIds.current

    return (): void => {
      restartMountedRef.current = false
      const pendingPtyIds = [...inFlightPtyIds]

      for (const ptyId of pendingPtyIds) {
        void disposeRestartPty(ptyId)
      }

      for (const ptyId of autoStartedWatcherPtyIds) {
        autoStartedWatcherPtyIds.delete(ptyId)
        void stopAgentWatcher(ptyId)
      }
    }
  }, [disposeRestartPty])

  useEffect(() => {
    for (const ptyId of autoStartedAgentWatcherPtyIds.current) {
      const pane = sessions
        .flatMap((session) => session.panes)
        .find(
          (candidate) => isShellPane(candidate) && candidate.ptyId === ptyId
        )

      if (
        pane === undefined ||
        isTerminalStatus(pane.status) ||
        pane.agentType === 'generic'
      ) {
        releaseAutoStartedAgentWatcher(ptyId)
      }
    }
  }, [releaseAutoStartedAgentWatcher, sessions])

  const attachResumedAgentWatcher = useCallback(
    async (ptyId: string, agentType: Pane['agentType']): Promise<void> => {
      if (!isDesktop()) {
        return
      }

      let retryDelayMs = 0
      const isRestartMounted = (): boolean => restartMountedRef.current

      for (
        let attempt = 0;
        attempt < RESUMED_AGENT_WATCHER_MAX_ATTEMPTS;
        attempt += 1
      ) {
        if (retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
        }

        const pane = sessionsRef.current
          .flatMap((session) => session.panes)
          .find(
            (candidate) => isShellPane(candidate) && candidate.ptyId === ptyId
          )
        if (
          !isRestartMounted() ||
          pane === undefined ||
          isTerminalStatus(pane.status) ||
          pane.agentSessionId !== undefined ||
          pane.agentType !== agentType
        ) {
          return
        }

        try {
          await invoke<boolean>('start_agent_watcher', { sessionId: ptyId })

          const currentPane = sessionsRef.current
            .flatMap((session) => session.panes)
            .find(
              (candidate) => isShellPane(candidate) && candidate.ptyId === ptyId
            )
          if (
            !isRestartMounted() ||
            currentPane === undefined ||
            isTerminalStatus(currentPane.status) ||
            currentPane.agentType !== agentType
          ) {
            void stopAgentWatcher(ptyId)

            return
          }

          autoStartedAgentWatcherPtyIds.current.add(ptyId)
          if (
            agentSessionIdsRef.current.has(ptyId) ||
            currentPane.agentSessionId !== undefined
          ) {
            releaseAutoStartedAgentWatcher(ptyId)
          }

          return
        } catch {
          if (attempt === RESUMED_AGENT_WATCHER_MAX_ATTEMPTS - 1) {
            break
          }

          // Keep a capped background retry while this exact legacy pane still
          // needs identity; agent startup/transcript creation can be delayed.
          retryDelayMs =
            retryDelayMs === 0
              ? 100
              : Math.min(
                  retryDelayMs * 2,
                  RESUMED_AGENT_WATCHER_MAX_RETRY_DELAY_MS
                )
        }
      }

      log.warn(`agent watcher did not attach after resume for PTY ${ptyId}`)
      agentSessionIdsRef.current.delete(ptyId)
      invalidatedAgentSessionsRef.current.delete(ptyId)
      setSessions((prev) =>
        prev.map((session) => {
          const pane = session.panes.find(
            (candidate) =>
              isShellPane(candidate) &&
              candidate.ptyId === ptyId &&
              candidate.agentType === agentType &&
              candidate.agentSessionId === undefined
          )
          if (pane === undefined) {
            return session
          }

          const panes = session.panes.map((candidate) =>
            candidate === pane
              ? { ...candidate, agentType: 'generic' as const }
              : candidate
          )

          return {
            ...session,
            agentType: pane.active ? 'generic' : session.agentType,
            panes,
          }
        })
      )
    },
    [releaseAutoStartedAgentWatcher]
  )

  const createSession = useCallback(
    (opts?: CreateSessionOptions): void => {
      const layout: PaneLayoutId = opts?.layout ?? 'single'
      const capacity = layoutRegistry.capacityFor(layout)
      const requestedCwd = opts?.cwd ?? '~'

      // Exactly `capacity` slots: explicit picks override; missing slots = shell.
      const specs: NewPaneSpec[] = Array.from(
        { length: capacity },
        (_, i) => opts?.panes?.[i] ?? { command: 'shell' }
      )

      const aliasConfigPromise = specs.some(
        (spec) => spec.command !== 'browser' && spec.command !== 'shell'
      )
        ? readAgentAliasConfig()
        : Promise.resolve<AgentAliasConfig>({ enabled: false, aliases: [] })

      setPendingSpawns((c) => c + 1)
      void (async (): Promise<void> => {
        try {
          // Spawn shell/agent PTYs concurrently + independently (one failure
          // must not reject the rest). Browser slots need no PTY.
          const spawned = await Promise.allSettled(
            specs.map((spec) =>
              commandToPane(spec.command).kind === 'browser'
                ? Promise.resolve(null)
                : service.spawn({
                    cwd: requestedCwd,
                    env: {},
                    enableAgentBridge: true,
                  })
            )
          )
          const aliasConfig = await aliasConfigPromise

          const now = new Date().toISOString()
          const newSessionId = crypto.randomUUID()

          // Resolved baseline cwd: the path Rust echoes back for the chosen dir.
          // Falls back to the requested cwd for an all-browser session (and
          // defensively when a spawn result omits cwd — Rust always returns
          // one, but minimal mocks may not).
          const firstResolved = spawned.find(
            (s): s is PromiseFulfilledResult<PTYSpawnResult> =>
              s.status === 'fulfilled' && s.value !== null
          )
          const workingDirectory = firstResolved?.value.cwd ?? requestedCwd

          const panes: Pane[] = []
          const browserPaneIds: string[] = []
          const agentStarts: { command: string; ptyId: string }[] = []
          let shellSpawnFailure: unknown = null

          specs.forEach((spec, i) => {
            const mapped = commandToPane(spec.command)
            const paneId = `p${panes.length}`

            if (mapped.kind === 'browser') {
              panes.push({
                kind: 'browser',
                id: paneId,
                ptyId: `browser:${crypto.randomUUID()}`,
                cwd: workingDirectory,
                agentType: 'generic',
                status: 'idle',
                active: false,
                browserUrl: DEFAULT_BROWSER_URL,
                ...(mapped.userLabel ? { userLabel: mapped.userLabel } : {}),
              })
              browserPaneIds.push(paneId)

              return
            }

            const settled = spawned[i]
            if (settled.status !== 'fulfilled' || settled.value === null) {
              log.warn(
                'createSession: pane spawn failed',
                settled.status === 'rejected' ? settled.reason : undefined
              )
              if (settled.status === 'rejected') {
                shellSpawnFailure = settled.reason
              }

              return
            }

            const result = settled.value

            const startCommand = buildAgentStartCommand(spec.command, {
              aliasConfig,
              launcher: spec.agentLauncher,
            })

            const restoreData: RestoreData = {
              sessionId: result.sessionId,
              cwd: result.cwd,
              pid: result.pid,
              replayData: '',
              replayEndOffset: 0,
              bufferedEvents: [],
            }
            registerPending(result.sessionId)
            registerPtySession(result.sessionId, result.sessionId, result.cwd)
            panes.push({
              kind: 'shell',
              id: paneId,
              ptyId: result.sessionId,
              cwd: result.cwd,
              shell: result.shell,
              agentType: 'generic',
              status: 'running',
              active: false,
              pid: result.pid,
              restoreData,
              ...(startCommand === null ? {} : { agentLauncher: startCommand }),
              ...(mapped.userLabel ? { userLabel: mapped.userLabel } : {}),
            })
            if (startCommand !== null) {
              agentStarts.push({
                command: startCommand,
                ptyId: result.sessionId,
              })
            }
          })

          if (panes.length === 0) {
            log.warn('createSession: no panes spawned; session not created')
            onTerminalSpawnError?.(
              shellSpawnFailure === null
                ? 'Failed to create terminal'
                : spawnErrorMessage(
                    'Failed to create terminal',
                    shellSpawnFailure
                  )
            )

            return
          }
          if (shellSpawnFailure !== null) {
            onTerminalSpawnError?.(
              spawnErrorMessage(
                'Failed to create one or more terminal panes',
                shellSpawnFailure
              )
            )
          }
          panes[0] = { ...panes[0], active: true }

          // Mirror the single-pane path's public restoreData contract.
          const firstRestore = panes.find((p) => p.restoreData)?.restoreData
          if (firstRestore) {
            restoreDataRef.current.set(newSessionId, firstRestore)
          }

          const hasShell = panes.some((p) => p.kind !== 'browser')
          const name = opts?.name ?? deriveSessionName(workingDirectory)

          flushSync(() => {
            setSessions((prev) => {
              const newSession: Session = {
                id: newSessionId,
                projectId: 'proj-1',
                name,
                status: hasShell ? 'running' : 'idle',
                workingDirectory,
                agentType: 'generic',
                layout,
                activityPanelCollapsed: false,
                panes,
                createdAt: now,
                lastActivityAt: now,
                activity: { ...emptyActivity },
              }

              return [...prev, newSession]
            })
          })

          flushSync(() => {
            setActiveSessionId(newSessionId)
          })
          opts?.onCreated?.(newSessionId)

          const startResults = await Promise.allSettled(
            agentStarts.map(({ command, ptyId }) =>
              service.write({ sessionId: ptyId, data: `${command}\r` })
            )
          )

          const failedStart = startResults.find(
            (result): result is PromiseRejectedResult =>
              result.status === 'rejected'
          )

          if (failedStart !== undefined) {
            log.warn(
              'createSession: agent start write failed',
              failedStart.reason
            )

            onTerminalSpawnError?.(
              spawnErrorMessage(
                'Failed to start coding agent',
                failedStart.reason
              )
            )
          }

          // Browser panes: create the WebContents after state is committed
          // (guarded — a startup/shutdown rejection must not surface).
          for (const paneId of browserPaneIds) {
            void (async (): Promise<void> => {
              try {
                await createBrowserPane({
                  sessionId: newSessionId,
                  paneId,
                  workspaceId: 'proj-1',
                  initialUrl: DEFAULT_BROWSER_URL,
                })
              } catch (err) {
                log.warn('createSession: createBrowserPane failed', err)
              }
            })()
          }
        } catch (err) {
          log.warn('createSession failed', err)
          onTerminalSpawnError?.(
            spawnErrorMessage('Failed to create terminal', err)
          )
        } finally {
          setPendingSpawns((c) => c - 1)
        }
      })()
    },
    [
      layoutRegistry,
      onTerminalSpawnError,
      readAgentAliasConfig,
      registerPending,
      service,
      setActiveSessionId,
    ]
  )

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
          status: 'idle',
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
              status: 'idle',
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
  // no usable/open session at that point, we fire createSession() to seed a
  // default tab. The ref-guard prevents this from re-firing — if the
  // user later closes all tabs, we DO NOT auto-create another (closing
  // all tabs is intentional; re-creating one would be confusing).
  //
  // "No open session" — not just "empty list" — covers the post-crash
  // path: if the previous app was killed (SIGKILL, OOM, wdio session
  // teardown without graceful exit), `list_sessions` lazy-reconciles
  // every cached "alive" entry to Exited. The user (or E2E suite) lands
  // in a workspace full of "Restart" tabs and zero live PTYs, defeating
  // the round-7 auto-create that was supposed to guarantee a usable
  // terminal on first paint. Treat that case the same as empty cache
  // and seed a fresh tab; the Exited tabs remain available for the user
  // to Restart in their original cwd if they want to.
  // Graceful-quit placeholders explicitly remain open while their PTYs hydrate,
  // and browser-only sessions are usable without a shell. Both must suppress a
  // duplicate default tab; naturally exited legacy/cache sessions do not.
  const hasLiveSession = sessions.some(isOpenSession)
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
    customPaneLayouts,
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
          releaseLatestAgentResumeClaimsForPty(ptyId)
          dropAllForPty(ptyId)
          deleteCacheHistory(ptyId)
          restoreDataRef.current.delete(ptyId)
          agentSessionIdsRef.current.delete(ptyId)
          invalidatedAgentSessionsRef.current.delete(ptyId)
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
      releaseLatestAgentResumeClaimsForPty,
      service,
      setActiveSessionId,
      setActiveSessionIdRaw,
    ]
  )

  const setSessionLayout = useCallback(
    (sessionId: string, layoutId: PaneLayoutId): void => {
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

  const setSessionPlacements = useCallback(
    (sessionId: string, placements: readonly PanePlacement[]): void => {
      // Warn outside `setSessions` for StrictMode parity with setSessionLayout
      // (the updater may run twice; the warn must fire once).
      const session = sessionsRef.current.find((s) => s.id === sessionId)
      if (!session) {
        log.warn(`setSessionPlacements: no session ${sessionId}`)

        return
      }

      setSessions((prev) => {
        const sessionIndex = prev.findIndex((s) => s.id === sessionId)
        if (sessionIndex === -1) {
          return prev
        }

        return [
          ...prev.slice(0, sessionIndex),
          { ...prev[sessionIndex], placements: [...placements] },
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
      // chasing a "⌘1-6 stopped working for 50–300ms" report sees
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
    (
      sessionId: string,
      kind: PaneKind = 'shell',
      slotId?: LayoutSlotId
    ): void => {
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

      if (session.panes.length >= layoutRegistry.capacityFor(session.layout)) {
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
            status: 'idle',
            active: true,
            browserUrl: DEFAULT_BROWSER_URL,
          }

          let appended = false as boolean
          flushSync(() => {
            setSessions((prev) => {
              const target = prev.find((s) => s.id === sessionId)

              const capacity = target
                ? layoutRegistry.capacityFor(target.layout)
                : 0

              const update = applyAddPane(
                prev,
                sessionId,
                newPane,
                capacity,
                slotId
              )
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

              const capacity = target
                ? layoutRegistry.capacityFor(target.layout)
                : 0

              const update = applyAddPane(
                prev,
                sessionId,
                newPane,
                capacity,
                slotId
              )
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
          onTerminalSpawnError?.(
            spawnErrorMessage('Failed to add terminal pane', err)
          )
        } finally {
          setPendingSpawns((count) => count - 1)
          pendingPaneOps.current.delete(sessionId)
        }
      })()
    },
    [
      activeSessionIdRef,
      dropAllForPty,
      layoutRegistry,
      onTerminalSpawnError,
      registerPending,
      service,
    ]
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
            agentSessionIdsRef.current.delete(target.ptyId)
            invalidatedAgentSessionsRef.current.delete(target.ptyId)
            releaseLatestAgentResumeClaimsForPty(target.ptyId)
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
                fresh?.layout ?? session.layout,
                layoutRegistry
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
    [
      activeSessionIdRef,
      dropAllForPty,
      layoutRegistry,
      releaseLatestAgentResumeClaimsForPty,
      service,
    ]
  )

  // Shared explicit-restart and relaunch-hydration primitive. Spawn first so a
  // failure cannot retire the old cache entry, arm output buffering before an
  // optional resume write, then rotate only the ephemeral PTY id. SplitView's
  // ptyId key remounts either Ghostty or xterm downstream of this boundary.
  const restartPane = useCallback(
    async (sessionId: string, paneId: string): Promise<void> => {
      const paneKey = `${sessionId}:${paneId}`
      if (pendingRestartPaneKeys.current.has(paneKey)) {
        return
      }

      const oldSession = sessionsRef.current.find((s) => s.id === sessionId)
      const oldPane = oldSession?.panes.find((pane) => pane.id === paneId)
      if (!oldSession || !oldPane || !isShellPane(oldPane)) {
        log.warn(`restartPane: no shell pane ${paneId} in session ${sessionId}`)

        return
      }

      pendingRestartPaneKeys.current.add(paneKey)
      let claimedLatestResumeKey: string | null = null
      let claimedLatestResumePtyId: string | null = null
      let resumeClaimCommitted = false
      let resumeClaimPredecessor: Promise<void> | null = null
      let releaseResumeClaim = (): void => undefined

      try {
        const candidateResumeCommand = buildAgentResumeCommand(
          oldPane.agentType,
          oldPane.agentSessionId
        )
        let resumeCommand = candidateResumeCommand

        const aliasConfigPromise =
          candidateResumeCommand === null
            ? Promise.resolve<AgentAliasConfig>({
                enabled: false,
                aliases: [],
              })
            : readAgentAliasConfig()

        if (candidateResumeCommand !== null) {
          const predecessor = resumeClaimQueueTailRef.current

          const claim = new Promise<void>((resolve) => {
            releaseResumeClaim = resolve
          })
          resumeClaimPredecessor = predecessor
          resumeClaimQueueTailRef.current = (async (): Promise<void> => {
            await predecessor
            await claim
          })()
        }

        let result: PTYSpawnResult
        try {
          result = await service.spawn({
            cwd: oldPane.cwd,
            env: {},
            enableAgentBridge: true,
          })
        } catch (err) {
          log.warn('restartPane: spawn failed; old pane preserved', err)
          onTerminalSpawnError?.(
            spawnErrorMessage('Failed to restart terminal', err)
          )

          return
        }

        inFlightRestartPtyIds.current.add(result.sessionId)
        registerPending(result.sessionId)

        const paneIsCurrent = (): boolean =>
          sessionsRef.current
            .find((session) => session.id === sessionId)
            ?.panes.some(
              (pane) =>
                pane.id === paneId &&
                isShellPane(pane) &&
                pane.ptyId === oldPane.ptyId
            ) === true

        const restartCanCommit = (): boolean =>
          restartMountedRef.current && paneIsCurrent()

        if (resumeClaimPredecessor !== null) {
          await resumeClaimPredecessor

          if (!restartCanCommit()) {
            await disposeRestartPty(result.sessionId)

            return
          }

          const canonicalResumeKey = `${oldPane.agentType}\0${result.cwd}`
          if (oldPane.agentSessionId === undefined) {
            if (hasClaimedLatestAgentResumeKey(canonicalResumeKey)) {
              resumeCommand = null
            } else {
              claimLatestAgentResumeKey(canonicalResumeKey, result.sessionId)
              claimedLatestResumeKey = canonicalResumeKey
              claimedLatestResumePtyId = result.sessionId
            }
          } else {
            // Exact identities always resume, but reserve the canonical cwd so
            // a later legacy pane cannot select the same run as "latest".
            claimLatestAgentResumeKey(canonicalResumeKey, result.sessionId)
            claimedLatestResumeKey = canonicalResumeKey
            claimedLatestResumePtyId = result.sessionId
          }
        }

        if (!restartCanCommit()) {
          await disposeRestartPty(result.sessionId)

          return
        }

        if (resumeCommand !== null) {
          const aliasConfig = await aliasConfigPromise
          resumeCommand = buildAgentResumeCommand(
            oldPane.agentType,
            oldPane.agentSessionId,
            {
              aliasConfig,
              launcher: oldPane.agentLauncher,
            }
          )
        }

        if (resumeCommand !== null) {
          try {
            await service.write({
              sessionId: result.sessionId,
              data: `${resumeCommand}\r`,
            })
          } catch (err) {
            log.warn('restartPane: agent resume write failed', err)
            onTerminalSpawnError?.(
              spawnErrorMessage('Failed to resume agent conversation', err)
            )
            await disposeRestartPty(result.sessionId)

            return
          }
        }

        if (!restartCanCommit()) {
          await disposeRestartPty(result.sessionId)

          return
        }

        // Restored placeholders no longer have a backend PTY. A manual restart
        // can still target a cached exited/live PTY, so retire it only when it
        // is actually present.
        let oldPtyPresent = true
        try {
          const live = await service.listSessions()
          oldPtyPresent = live.sessions.some(
            (info) => info.id === oldPane.ptyId
          )
        } catch (err) {
          log.warn(
            'restartPane: listSessions failed; assuming old PTY present',
            err
          )
        }

        if (!restartCanCommit()) {
          await disposeRestartPty(result.sessionId)

          return
        }

        if (oldPtyPresent) {
          try {
            await service.kill({ sessionId: oldPane.ptyId })
          } catch (err) {
            log.warn(
              'restartPane: old PTY kill failed; preserving the old pane',
              err
            )
            await disposeRestartPty(result.sessionId)

            return
          }
        }

        const restoreData: RestoreData = {
          sessionId: result.sessionId,
          cwd: result.cwd,
          pid: result.pid,
          replayData: '',
          replayEndOffset: 0,
          bufferedEvents: [],
        }

        const replacementAgentType =
          resumeCommand === null ? 'generic' : oldPane.agentType

        const replacementAgentSessionId =
          resumeCommand === null ? undefined : oldPane.agentSessionId

        const replacementAgentLauncher =
          resumeCommand === null ? undefined : resumeCommand.split(' ', 1)[0]

        flushSync(() => {
          setSessions((prev) => {
            const idx = prev.findIndex((session) => session.id === sessionId)
            if (idx === -1) {
              return prev
            }

            const current = prev[idx]
            const currentPane = current.panes.find((pane) => pane.id === paneId)
            if (
              currentPane === undefined ||
              !isShellPane(currentPane) ||
              currentPane.ptyId !== oldPane.ptyId
            ) {
              return prev
            }

            const replacementPane: Pane = {
              ...currentPane,
              ptyId: result.sessionId,
              cwd: result.cwd,
              shell: result.shell,
              status: 'running',
              agentType: replacementAgentType,
              agentSessionId: replacementAgentSessionId,
              agentLauncher: replacementAgentLauncher,
              pid: result.pid,
              restoreData,
              agentTitle: undefined,
              agentTitleSource: undefined,
              userLabel: undefined,
              cacheHistory: [],
            }

            const panes = current.panes.map((pane) =>
              pane.id === paneId ? replacementPane : pane
            )
            const next = [...prev]

            next[idx] = {
              ...current,
              open: true,
              status: deriveShellSessionStatus(panes),
              workingDirectory: currentPane.active
                ? result.cwd
                : current.workingDirectory,
              agentType: currentPane.active
                ? replacementAgentType
                : current.agentType,
              panes,
              lastActivityAt: new Date().toISOString(),
            }

            return next
          })
        })

        const committed =
          sessionsRef.current
            .find((session) => session.id === sessionId)
            ?.panes.some(
              (pane) => pane.id === paneId && pane.ptyId === result.sessionId
            ) === true
        if (!committed) {
          await disposeRestartPty(result.sessionId)

          return
        }
        resumeClaimCommitted = true

        inFlightRestartPtyIds.current.delete(result.sessionId)
        releaseLatestAgentResumeClaimsForPty(oldPane.ptyId)
        dropAllForPty(oldPane.ptyId)
        deleteCacheHistory(oldPane.ptyId)
        restoreDataRef.current.delete(oldPane.ptyId)
        restoreDataRef.current.delete(oldSession.id)
        restoreDataRef.current.set(oldSession.id, restoreData)
        agentSessionIdsRef.current.delete(oldPane.ptyId)
        invalidatedAgentSessionsRef.current.delete(oldPane.ptyId)
        if (replacementAgentSessionId !== undefined) {
          agentSessionIdsRef.current.set(
            result.sessionId,
            replacementAgentSessionId
          )
        }
        unregisterPtySession(oldPane.ptyId)
        registerPtySession(result.sessionId, result.sessionId, result.cwd)

        if (resumeCommand !== null && oldPane.agentSessionId === undefined) {
          void attachResumedAgentWatcher(result.sessionId, oldPane.agentType)
        }

        // Cache ordering is persisted by usePushWorkspaceGrouping after the
        // state rotation. Keep the stable workspace/session id selected while
        // the pane's backend PTY id changes underneath it.
        if (activeSessionIdRef.current === sessionId) {
          setActiveSessionId(sessionId)
        }
      } finally {
        if (
          !resumeClaimCommitted &&
          claimedLatestResumeKey !== null &&
          claimedLatestResumePtyId !== null
        ) {
          releaseLatestAgentResumeKey(
            claimedLatestResumeKey,
            claimedLatestResumePtyId
          )
        }
        releaseResumeClaim()
        pendingRestartPaneKeys.current.delete(paneKey)
      }
    },
    [
      activeSessionIdRef,
      attachResumedAgentWatcher,
      claimLatestAgentResumeKey,
      disposeRestartPty,
      dropAllForPty,
      hasClaimedLatestAgentResumeKey,
      onTerminalSpawnError,
      readAgentAliasConfig,
      registerPending,
      releaseLatestAgentResumeClaimsForPty,
      releaseLatestAgentResumeKey,
      service,
      setActiveSessionId,
    ]
  )

  const restartSession = useCallback(
    (sessionId: string, paneId?: string): void => {
      const session = sessionsRef.current.find((item) => item.id === sessionId)
      if (!session) {
        log.warn(`restartSession: no session with id ${sessionId}`)

        return
      }

      const requestedPane =
        paneId === undefined
          ? undefined
          : session.panes.find((pane) => pane.id === paneId)
      if (paneId !== undefined && requestedPane === undefined) {
        log.warn(`restartSession: no pane ${paneId} in session ${sessionId}`)

        return
      }

      const activePane = paneId === undefined ? getActivePane(session) : null

      const shellPane =
        requestedPane ??
        (activePane !== null && isShellPane(activePane)
          ? activePane
          : session.panes.find(isShellPane))
      if (!shellPane || !isShellPane(shellPane)) {
        log.warn('restartSession: no shell pane found')

        return
      }

      void restartPane(sessionId, shellPane.id)
    },
    [restartPane]
  )

  // Graceful quit persists every open workspace but intentionally retires its
  // PTYs. Rehydrate all shell placeholders only when their workspace becomes
  // active; inactive workspaces remain cheap serialized state until selected.
  useEffect(() => {
    if (loading || activeSessionId === null) {
      return
    }

    const session = sessionsRef.current.find(
      (item) => item.id === activeSessionId
    )
    if (session?.open !== true) {
      return
    }

    if (autoHydratedSessionIds.current.has(session.id)) {
      return
    }

    const shellPlaceholders = session.panes.filter(
      (pane) => isShellPane(pane) && isTerminalStatus(pane.status)
    )
    if (shellPlaceholders.length === 0) {
      return
    }

    autoHydratedSessionIds.current.add(session.id)

    const orderedShellPlaceholders = [
      ...shellPlaceholders.filter((pane) => pane.agentSessionId !== undefined),
      ...shellPlaceholders.filter(
        (pane) => pane.agentSessionId === undefined && pane.active
      ),
      ...shellPlaceholders.filter(
        (pane) => pane.agentSessionId === undefined && !pane.active
      ),
    ]

    for (const pane of orderedShellPlaceholders) {
      void restartPane(session.id, pane.id)
    }
  }, [activeSessionId, loading, restartPane])

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

  const clearPaneCacheHistory = useCallback(
    (sessionId: string, paneId: string): void => {
      const target = sessionsRef.current.find((s) => s.id === sessionId)
      const targetPane = target?.panes.find((p) => p.id === paneId)
      if (!targetPane) {
        return
      }

      deleteCacheHistory(targetPane.ptyId)

      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== sessionId) {
            return session
          }

          const panes = session.panes.map((pane) =>
            pane.id === paneId ? { ...pane, cacheHistory: [] } : pane
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

  const recordPaneAgentLauncher = useCallback(
    (ptyId: string, command: string): void => {
      const currentPane = sessionsRef.current
        .flatMap((session) => session.panes)
        .find((candidate) => candidate.ptyId === ptyId)
      if (
        currentPane === undefined ||
        !isShellPane(currentPane) ||
        currentPane.agentType !== 'generic' ||
        isTerminalStatus(currentPane.status)
      ) {
        return
      }

      void (async (): Promise<void> => {
        const submittedLauncher = submittedLauncherTokenFromCommand(command)
        if (submittedLauncher === null) {
          return
        }

        const canonicalLauncher = agentLauncherFromCommand(command, undefined)
        if (canonicalLauncher !== null) {
          agentAliasMissExpiresByLauncherRef.current.delete(submittedLauncher)
        }

        const now = Date.now()

        const aliasMissExpiresAt =
          agentAliasMissExpiresByLauncherRef.current.get(submittedLauncher)
        if (
          canonicalLauncher === null &&
          aliasMissExpiresAt !== undefined &&
          aliasMissExpiresAt > now
        ) {
          return
        }
        if (aliasMissExpiresAt !== undefined && aliasMissExpiresAt <= now) {
          agentAliasMissExpiresByLauncherRef.current.delete(submittedLauncher)
        }

        const aliasConfig =
          canonicalLauncher === null ? await readAgentAliasConfig() : undefined

        const launcher =
          canonicalLauncher ?? agentLauncherFromCommand(command, aliasConfig)
        if (launcher === null) {
          agentAliasMissExpiresByLauncherRef.current.set(
            submittedLauncher,
            now + AGENT_ALIAS_MISS_TTL_MS
          )

          return
        }
        agentAliasMissExpiresByLauncherRef.current.delete(submittedLauncher)

        if (!restartMountedRef.current) {
          return
        }

        setSessions((prev) => {
          const paneExists = prev.some((session) =>
            session.panes.some(
              (pane) =>
                isShellPane(pane) &&
                pane.ptyId === ptyId &&
                pane.agentLauncher !== launcher
            )
          )
          if (!paneExists) {
            return prev
          }

          return prev.map((session) => ({
            ...session,
            panes: session.panes.map((pane) =>
              isShellPane(pane) && pane.ptyId === ptyId
                ? { ...pane, agentLauncher: launcher }
                : pane
            ),
          }))
        })
      })()
    },
    [readAgentAliasConfig]
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
    customPaneLayouts,
    layoutRegistry,
    setCustomPaneLayouts,
    setActiveSessionId,
    createSession,
    createBrowserSession,
    removeSession,
    setSessionLayout,
    setSessionPlacements,
    setSessionActivePane,
    addPane,
    removePane,
    restartSession,
    renameSession,
    setPaneUserLabel,
    reorderSessions,
    updatePaneCwd,
    appendPaneCacheReading,
    clearPaneCacheHistory,
    updatePaneAgentType,
    recordPaneAgentLauncher,
    invalidatePaneAgentSession,
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
