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

import { useEffect, useRef } from 'react'
import { createLogger } from '../../../lib/log'
import {
  pushWorkspaceShape,
  type WorkspaceShapeDto,
  type WorkspaceShapePane,
} from '../workspaceLayoutBridge'
import { isShellPane } from '../utils/paneKind'
import type { Session } from '../types'

const log = createLogger('grouping')

const DRIFT_DEBOUNCE_MS = 500

/**
 * Pure conversion of the in-memory `Session[]` shape into the shape-only DTO
 * main consumes. Browser tab/history is omitted (main owns it); shell panes
 * carry their restore fields. `agentSessionId` is reserved (`null`) until the
 * `--resume` feature populates it. Exposed for testability.
 */
export const buildWorkspaceShape = (
  sessions: readonly Session[],
  activeSessionId: string | null
): WorkspaceShapeDto => ({
  sessions: sessions.map((session) => ({
    id: session.id,
    projectId: session.projectId,
    layout: session.layout,
    workingDirectory: session.workingDirectory,
    active: session.id === activeSessionId,
    panes: session.panes.map(
      (pane, paneIndex): WorkspaceShapePane =>
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
  })),
})

// Signature of the structural half (everything except cwd/agentType drift), so
// a `cd` or agent-detection update debounces instead of pushing eagerly.
const structuralSignature = (shape: WorkspaceShapeDto): string =>
  JSON.stringify(
    shape.sessions.map((session) => ({
      id: session.id,
      projectId: session.projectId,
      layout: session.layout,
      workingDirectory: session.workingDirectory,
      active: session.active,
      panes: session.panes.map((pane) => ({
        kind: pane.kind,
        paneId: pane.paneId,
        paneIndex: pane.paneIndex,
        active: pane.active,
        ptyId: pane.kind === 'shell' ? pane.ptyId : null,
      })),
    }))
  )

export interface UsePushWorkspaceGroupingOptions {
  sessions: readonly Session[]
  /** The active workspace session id, so the DTO marks which session restore
   *  should reselect. */
  activeSessionId: string | null
  /** Skip pushes while the initial restore is still loading — pushing an empty
   *  shape before the restored sessions land would clobber the store. */
  loading: boolean
}

export const usePushWorkspaceGrouping = ({
  sessions,
  activeSessionId,
  loading,
}: UsePushWorkspaceGroupingOptions): void => {
  // Last full + structural shape JSON, to skip no-op rerenders and to tell a
  // structural change (eager) from a drift-only change (debounced).
  const lastFullRef = useRef<string | null>(null)
  const lastStructuralRef = useRef<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear a pending drift push on unmount.
  useEffect(
    () => (): void => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current)
      }
    },
    []
  )

  useEffect(() => {
    if (loading || sessions.length === 0) {
      return
    }

    const shape = buildWorkspaceShape(sessions, activeSessionId)
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
      void pushWorkspaceShape(shape)

      return
    }

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      void pushWorkspaceShape(shape)
    }, DRIFT_DEBOUNCE_MS)
  }, [sessions, activeSessionId, loading])
}
