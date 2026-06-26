// Push the renderer's shape-only workspace DTO to Electron main whenever the
// React `sessions[]` shape changes (spec §3.2). Main is the SOLE assembler +
// writer of the durable store: it joins this shape with the browser tab/history
// it owns and persists one atomic snapshot, coalescing by monotonic generation
// (see electron/workspace-layout-writer). So the renderer owns no write
// ordering — it only emits:
//   - structural changes (pane set / layout / active session/pane) → eager
//   - cwd (OSC 7) / agentType drift → debounced (trims push volume; main
//     would coalesce anyway)
// This single boundary means a future producer of shape changes (e.g. an agent
// driving the browser pane) routes through the same path without a second
// writer ever touching the store.
//
// Deliberately ONE integration point instead of threading a push through every
// structural mutation (createSession / addPane / removePane / setSessionLayout
// / setSessionActivePane / reorderSessions / restartSession): React commit
// batching coalesces synchronous bursts into one effect run.

import { useEffect, useMemo, useRef } from 'react'
import { createLogger } from '../../../lib/log'
import {
  onWorkspaceRequestFinalShape,
  pushWorkspaceShape,
  type PersistedWorkspaceShape,
  type PersistedWorkspacePaneShape,
} from '../workspaceLayoutBridge'
import {
  PaneLayoutRegistry,
  type PaneLayoutDefinition,
} from '../../terminal/layout-registry'
import { isShellPane } from '../utils/paneKind'
import { normalizePanePlacements } from '../utils/panePlacements'
import { isOpenSession } from '../utils/sessionStatus'
import type { Session } from '../types'

const log = createLogger('grouping')

const EMPTY_CUSTOM_PANE_LAYOUTS: readonly PaneLayoutDefinition[] = []

const DRIFT_DEBOUNCE_MS = 500

const pushShapeWithLog = async (
  shape: PersistedWorkspaceShape
): Promise<void> => {
  try {
    await pushWorkspaceShape(shape)
  } catch (err) {
    log.warn('pushWorkspaceShape failed', err)
  }
}

/**
 * Pure conversion of the in-memory `Session[]` shape into the shape-only DTO
 * main consumes. Browser tab/history is omitted (main owns it); shell panes
 * carry their restore fields. `agentSessionId` is reserved (`null`) until the
 * `--resume` feature populates it. Exposed for testability.
 */
export const buildWorkspaceShape = (
  sessions: readonly Session[],
  activeSessionId: string | null,
  customPaneLayouts: readonly PaneLayoutDefinition[] = []
): PersistedWorkspaceShape => {
  const layoutRegistry = new PaneLayoutRegistry(customPaneLayouts)

  return {
    customPaneLayouts,
    sessions: sessions.map((session) => {
      const layout = layoutRegistry.getFallbackLayout(session.layout)

      return {
        id: session.id,
        projectId: session.projectId,
        layout: session.layout,
        placements: normalizePanePlacements(
          session.panes,
          layout,
          session.placements
        ),
        workingDirectory: session.workingDirectory,
        active: session.id === activeSessionId,
        open: isOpenSession(session),
        panes: session.panes.map(
          (pane, paneIndex): PersistedWorkspacePaneShape =>
            isShellPane(pane)
              ? {
                  kind: 'shell',
                  paneId: pane.id,
                  paneIndex,
                  active: pane.active,
                  ptyId: pane.ptyId,
                  cwd: pane.cwd,
                  agentType: pane.agentType,
                  agentSessionId: null,
                }
              : {
                  kind: 'browser',
                  paneId: pane.id,
                  paneIndex,
                  active: pane.active,
                }
        ),
      }
    }),
  }
}

// Signature of the structural half (everything except cwd/agentType drift), so
// a `cd` or agent-detection update debounces instead of pushing eagerly.
const structuralSignature = (shape: PersistedWorkspaceShape): string =>
  JSON.stringify({
    customPaneLayouts: shape.customPaneLayouts ?? [],
    sessions: shape.sessions.map((session) => ({
      id: session.id,
      projectId: session.projectId,
      layout: session.layout,
      placements: session.placements,
      workingDirectory: session.workingDirectory,
      active: session.active,
      open: session.open,
      panes: session.panes.map((pane) => ({
        kind: pane.kind,
        paneId: pane.paneId,
        paneIndex: pane.paneIndex,
        active: pane.active,
        ptyId: pane.kind === 'shell' ? pane.ptyId : null,
      })),
    })),
  })

export interface UsePushWorkspaceGroupingOptions {
  sessions: readonly Session[]
  customPaneLayouts?: readonly PaneLayoutDefinition[]
  /** The active workspace session id, so the DTO marks which session restore
   *  should reselect. */
  activeSessionId: string | null
  /** Skip pushes while the initial restore is still loading — pushing an empty
   *  shape before the restored sessions land would clobber the store. */
  loading: boolean
  /** Allow an empty workspace to persist. Disabled until restore succeeds so a
   *  failed restore cannot wipe a previously saved layout. */
  canPushEmptyShape?: boolean
}

export const usePushWorkspaceGrouping = ({
  sessions,
  customPaneLayouts = EMPTY_CUSTOM_PANE_LAYOUTS,
  activeSessionId,
  loading,
  canPushEmptyShape = true,
}: UsePushWorkspaceGroupingOptions): void => {
  const shape = useMemo(
    () => buildWorkspaceShape(sessions, activeSessionId, customPaneLayouts),
    [sessions, activeSessionId, customPaneLayouts]
  )

  // Last full + structural shape JSON, to skip no-op rerenders and to tell a
  // structural change (eager) from a drift-only change (debounced).
  const lastFullRef = useRef<string | null>(null)
  const lastStructuralRef = useRef<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestShapeRef = useRef(shape)
  const loadingRef = useRef(loading)
  const canPushEmptyShapeRef = useRef(canPushEmptyShape)

  latestShapeRef.current = shape
  loadingRef.current = loading
  canPushEmptyShapeRef.current = canPushEmptyShape

  // Clear a pending drift push on unmount.
  useEffect(
    () => (): void => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current)
      }
    },
    []
  )

  useEffect(
    () =>
      onWorkspaceRequestFinalShape(() => {
        if (loadingRef.current) {
          return
        }

        const finalShape = latestShapeRef.current
        if (finalShape.sessions.length === 0 && !canPushEmptyShapeRef.current) {
          return
        }

        if (debounceRef.current !== null) {
          clearTimeout(debounceRef.current)
          debounceRef.current = null
        }

        void pushShapeWithLog(finalShape)
      }),
    []
  )

  useEffect(() => {
    if (loading || (shape.sessions.length === 0 && !canPushEmptyShape)) {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }

      return
    }

    const fullJson = JSON.stringify(shape)
    if (fullJson === lastFullRef.current) {
      // Non-shape rerender — leave any pending drift push alone.
      return
    }
    lastFullRef.current = fullJson

    const structuralJson = structuralSignature(shape)
    const structuralChanged = structuralJson !== lastStructuralRef.current
    lastStructuralRef.current = structuralJson

    // A real change supersedes any pending debounced drift push.
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    if (structuralChanged) {
      log.info(
        `pushing workspace shape: ${shape.sessions.length} session(s), ` +
          `${shape.sessions.reduce((n, s) => n + s.panes.length, 0)} pane(s)`
      )

      void pushShapeWithLog(shape)

      return
    }

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      void pushShapeWithLog(shape)
    }, DRIFT_DEBOUNCE_MS)
  }, [shape, loading, canPushEmptyShape])
}
