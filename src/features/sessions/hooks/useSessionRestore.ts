import { useEffect, useRef, useState } from 'react'
import type { SessionInfo } from '../../../bindings'
import type { Session } from '../types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type { PtyBufferDrain } from '../../terminal/orchestration/usePtyBufferDrain'
import { registerPtySession } from '../../terminal/ptySessionMap'
import { createLogger } from '../../../lib/log'
import { reconstructWorkspace } from '../utils/groupSessionsFromInfos'
import { isBrowserPane } from '../utils/paneKind'
import type {
  WorkspaceShapeDto,
  WorkspaceShapePane,
  WorkspaceShapeShellPane,
} from '../workspaceLayoutBridge'
import {
  beginWorkspaceHydration,
  endWorkspaceHydration,
  loadWorkspaceForRestore,
} from '../workspaceLayoutBridge'
import { createBrowserPane } from '../../browser/browserBridge'

const log = createLogger('restore')

// A restored browser pane that neither resolves nor rejects must not pin the
// hydration guard open forever — main keeps suppressing writes until restore
// settles. Treat a stuck create as timed-out so hydration always completes.
const RESTORE_PANE_TIMEOUT_MS = 4000

const isShapeShellPane = (
  pane: WorkspaceShapePane
): pane is WorkspaceShapeShellPane => pane.kind === 'shell'

interface StoreShellSelection {
  sessionId: string
  paneId: string
  pane: WorkspaceShapeShellPane
}

interface RestartedStoreShell {
  storeShape: WorkspaceShapeDto
  liveSession: SessionInfo
}

const findActiveStoreShell = (
  storeShape: WorkspaceShapeDto | null
): StoreShellSelection | null => {
  const activeSession = storeShape?.sessions.find((session) => session.active)
  if (!activeSession) {
    return null
  }

  // Normalize the active pane the same way reconstructWorkspace does: sort by
  // paneIndex and treat the first flagged pane as active. A transient snapshot
  // can mark both a browser and a shell pane active; in that case the browser
  // (the normalized active pane) wins and we must NOT restart a background
  // shell.
  const ordered = [...activeSession.panes].sort(
    (a, b) => a.paneIndex - b.paneIndex
  )
  if (ordered.length === 0) {
    return null
  }

  const firstActiveIdx = ordered.findIndex((pane) => pane.active)

  const activePane =
    firstActiveIdx === -1 ? ordered[0] : ordered[firstActiveIdx]

  if (!isShapeShellPane(activePane)) {
    return null
  }

  return {
    sessionId: activeSession.id,
    paneId: activePane.paneId,
    pane: activePane,
  }
}

const shapeWithRestartedShell = (
  storeShape: WorkspaceShapeDto,
  selection: StoreShellSelection,
  liveSession: SessionInfo
): WorkspaceShapeDto => ({
  sessions: storeShape.sessions.map((session) =>
    session.id !== selection.sessionId
      ? session
      : {
          ...session,
          panes: session.panes.map((pane) =>
            pane.kind === 'shell' && pane.paneId === selection.paneId
              ? {
                  ...pane,
                  ptyId: liveSession.id,
                  cwd: liveSession.cwd,
                  agentType: 'generic',
                  agentSessionId: null,
                }
              : pane
          ),
        }
  ),
})

const restartPersistedActiveShell = async (
  service: ITerminalService,
  storeShape: WorkspaceShapeDto | null,
  liveSessions: readonly SessionInfo[]
): Promise<RestartedStoreShell | null> => {
  const hasLiveSession = liveSessions.some(
    (session) => session.status.kind === 'Alive'
  )
  if (!storeShape || hasLiveSession) {
    return null
  }

  const selection = findActiveStoreShell(storeShape)
  if (!selection) {
    return null
  }

  try {
    const spawned = await service.spawn({
      cwd: selection.pane.cwd,
      env: {},
      enableAgentBridge: true,
    })

    const liveSession: SessionInfo = {
      id: spawned.sessionId,
      cwd: spawned.cwd,
      shell: spawned.shell,
      status: {
        kind: 'Alive',
        pid: spawned.pid,
        replay_data: '',
        replay_end_offset: 0n,
      },
    }

    return {
      storeShape: shapeWithRestartedShell(storeShape, selection, liveSession),
      liveSession,
    }
  } catch (err) {
    log.warn('failed to restart persisted active shell during restore', err)

    return null
  }
}

export interface UseSessionRestoreOptions {
  service: ITerminalService
  buffer: PtyBufferDrain
  onRestore: (sessions: Session[]) => void
  onActiveResolved: (sessionId: string) => void
  onActiveFallback?: (sessionId: string) => void
  /** Activate the store's persisted-active session (browser-capable, §5). */
  onActivePersisted?: (sessionId: string) => void
  /** Active project context for the load command's repair defaults (§2.2). */
  projectId?: string
  workingDirectory?: string
}

export interface SessionRestoreState {
  loading: boolean
}

// Resolve once `task` settles or the timeout elapses, so a single hung restore
// can never block hydration completion. The helper absorbs late rejections after
// the timeout wins the race.
const withTimeout = async (task: Promise<void>, ms: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined

  const absorbTaskRejection = async (): Promise<void> => {
    try {
      await task
    } catch {
      // Late restore-create failures are best-effort once hydration has timed out.
    }
  }

  try {
    await Promise.race([
      absorbTaskRejection(),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          resolve()
        }, ms)
      }),
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

export const useSessionRestore = ({
  service,
  buffer,
  onRestore,
  onActiveResolved,
  onActiveFallback,
  onActivePersisted,
  projectId = 'proj-1',
  workingDirectory = '~',
}: UseSessionRestoreOptions): SessionRestoreState => {
  const [loading, setLoading] = useState(true)
  const bufferRef = useRef(buffer)
  const onRestoreRef = useRef(onRestore)
  const onActiveResolvedRef = useRef(onActiveResolved)
  const onActiveFallbackRef = useRef(onActiveFallback)
  const onActivePersistedRef = useRef(onActivePersisted)

  bufferRef.current = buffer
  onRestoreRef.current = onRestore
  onActiveResolvedRef.current = onActiveResolved
  onActiveFallbackRef.current = onActiveFallback
  onActivePersistedRef.current = onActivePersisted

  useEffect(() => {
    let cancelled = false
    let stopBuffering: (() => void) | null = null

    // Register the buffer + ptySessionMap side effects for every Alive pane,
    // then attach the buffered-events snapshot to each pane's restoreData.
    // Browser/placeholder panes carry no restoreData and pass through.
    const attachBuffers = (sessions: Session[]): Session[] =>
      sessions.map((session) => ({
        ...session,
        panes: session.panes.map((pane) => {
          if (!pane.restoreData) {
            return pane
          }
          bufferRef.current.registerPending(pane.ptyId)
          registerPtySession(pane.ptyId, pane.ptyId, pane.cwd)

          return {
            ...pane,
            restoreData: {
              ...pane.restoreData,
              bufferedEvents: bufferRef.current.getBufferedSnapshot(pane.ptyId),
            },
          }
        }),
      }))

    // Trigger main-owned restore creation for every browser pane BEFORE the
    // React tree mounts them: main creates the WebContents + replays history,
    // so when `BrowserPane` later issues its normal create it reconnects to the
    // already-restored view (browser-pane.ts createPane) instead of loading a
    // fresh default url. Awaiting these IS the hydration settle (§3.2): each is
    // bounded by a per-pane timeout so the guard always clears.
    const restoreBrowserPanes = async (sessions: Session[]): Promise<void> => {
      // Per-pane best-effort: a create failure is logged by main and must not
      // reject (one pane's failure can't block the others or the hydration
      // settle).
      const createOne = async (
        session: Session,
        paneId: string
      ): Promise<void> => {
        try {
          await createBrowserPane({
            sessionId: session.id,
            paneId,
            workspaceId: session.projectId,
            restore: true,
          })
        } catch {
          // ignore — restore is best-effort per pane
        }
      }

      const creations = sessions.flatMap((session) =>
        session.panes
          .filter(isBrowserPane)
          .map((pane) =>
            withTimeout(createOne(session, pane.id), RESTORE_PANE_TIMEOUT_MS)
          )
      )
      if (creations.length === 0) {
        return
      }

      await Promise.allSettled(creations)
    }

    // Select the active session: the store's persisted-active wins (activated
    // through the browser-capable `setActiveSessionId` so a browser-only
    // session is selectable); otherwise fall back to the PTY-driven order.
    const activate = (
      storeShape: WorkspaceShapeDto | null,
      sessions: Session[],
      activePtyId: string | null
    ): void => {
      const activeStoreId =
        storeShape?.sessions.find((s) => s.active)?.id ?? null
      if (activeStoreId && sessions.some((s) => s.id === activeStoreId)) {
        if (onActivePersistedRef.current) {
          onActivePersistedRef.current(activeStoreId)

          return
        }
      }

      if (activePtyId !== null) {
        const matched = sessions.find((s) =>
          s.panes.some((pane) => pane.ptyId === activePtyId)
        )
        if (matched) {
          onActiveResolvedRef.current(matched.id)

          return
        }
      }

      if (sessions.length > 0) {
        onActiveFallbackRef.current?.(sessions[0].id)
      }
    }

    let hydrationStarted = false
    let pendingRestartId: string | null = null

    const disposePendingRestart = (): void => {
      if (pendingRestartId) {
        const sessionId = pendingRestartId
        pendingRestartId = null
        void (async (): Promise<void> => {
          try {
            await service.kill({ sessionId })
          } catch (err) {
            log.warn(
              'failed to kill orphaned restarted PTY on restore cancel',
              err
            )
          }
        })()
      }
    }

    void (async (): Promise<void> => {
      try {
        stopBuffering = await service.onData(
          (
            sessionId,
            data,
            offsetStart,
            byteLen,
            bytesBase64,
            ghosttySnapshot,
            ghosttyCwdUri
          ) => {
            bufferRef.current.bufferEvent(
              sessionId,
              data,
              offsetStart,
              byteLen,
              bytesBase64,
              ghosttySnapshot,
              ghosttyCwdUri
            )
          }
        )
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled) {
          stopBuffering()
          stopBuffering = null

          return
        }

        // Suppress main's persistence writes until restore settles, so a
        // restore-time shape push can't overwrite the durable store with
        // empty browser tabs before history is replayed (§3.2).
        await beginWorkspaceHydration()
        hydrationStarted = true

        // The durable store is the authoritative shape; live PTYs overlay it
        // by ptyId. Load both, then reconstruct.
        let storeShape = await loadWorkspaceForRestore({
          projectId,
          workingDirectory,
        })
        const list = await service.listSessions()
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled) {
          return
        }

        let liveSessions = list.sessions
        let activePtyId = list.activeSessionId

        log.info(
          `listSessions returned ${list.sessions.length} PTY session(s); ` +
            `store ${storeShape ? 'present' : 'absent'}`,
          {
            ptySessionIds: list.sessions.map((info) => info.id),
            activeSessionId: list.activeSessionId,
            storeSessionCount: storeShape?.sessions.length ?? 0,
          }
        )

        const restarted = await restartPersistedActiveShell(
          service,
          storeShape,
          liveSessions
        )
        if (restarted) {
          storeShape = restarted.storeShape
          liveSessions = [restarted.liveSession]
          activePtyId = restarted.liveSession.id
          pendingRestartId = restarted.liveSession.id
        }

        // If cleanup ran while spawn was in flight, kill the orphaned PTY.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled) {
          disposePendingRestart()

          return
        }

        const restored = attachBuffers(
          reconstructWorkspace(storeShape, liveSessions, activePtyId)
        )

        log.info(
          `reconstructed ${restored.length} workspace session(s) from ` +
            `${liveSessions.length} PTY session(s)`,
          {
            workspaceSessions: restored.map((session) => ({
              id: session.id,
              layout: session.layout,
              paneCount: session.panes.length,
              paneIds: session.panes.map((pane) => pane.id),
            })),
          }
        )

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled) {
          return
        }

        await restoreBrowserPanes(restored)
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled) {
          return
        }

        onRestoreRef.current(restored)
        activate(storeShape, restored, activePtyId)
        pendingRestartId = null

        setLoading(false)
      } catch (err) {
        log.error('restore failed; starting empty', err)
        // If a restarted PTY was spawned but restore threw before it was
        // committed, kill the orphaned session so it does not leak as a
        // phantom session in later restore rounds.
        disposePendingRestart()
        // F15 (claude LOW): intentionally do NOT call stopBuffering() here.
        // The pty-data buffering listener stays alive for the lifetime of
        // useSessionManager so createSession (post-restore) still benefits
        // from the buffer→drain protocol when spawn outpaces the pane's
        // useTerminal subscription. Tearing it down on restore failure
        // would silently lose early pty-data on every fresh tab. Cleanup
        // happens via the effect's return path on unmount (see below).
        setLoading(false)
      } finally {
        // Always release the hydration guard so main can never be stuck
        // suppressing writes (§3.2) — even on a restore error / cancel.
        if (hydrationStarted) {
          try {
            await endWorkspaceHydration()
          } catch (err) {
            log.error('failed to release workspace hydration', err)
          }
        }
      }
    })()

    return (): void => {
      cancelled = true
      stopBuffering?.()
      disposePendingRestart()
    }
  }, [service, projectId, workingDirectory])

  return { loading }
}
