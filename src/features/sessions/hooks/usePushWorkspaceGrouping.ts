// Push the current workspace-session grouping to the Rust cache whenever the
// React `sessions[]` shape changes. The backend rebuilds its `groupings` map
// (and `session_order`) from each snapshot, so the cache mirrors the live
// React structure and a later restore can reconstruct the multi-pane layout
// instead of fragmenting each PTY into its own single-pane session (see
// useSessionRestore + groupSessionsFromInfos for the read side).
//
// Deliberately ONE integration point instead of threading the snapshot push
// through every structural mutation (createSession / addPane / removePane /
// setSessionLayout / setSessionActivePane / reorderSessions / restartSession).
// React commit batching means most synchronous bursts coalesce into one
// render and one effect run; bursts that cross render boundaries are handled
// by the single-flight queue below, so the backend never sees an older
// snapshot persist after a newer one.

import { useEffect, useRef } from 'react'
import type {
  SetWorkspaceSessionsRequest,
  WorkspaceSessionSnapshot,
} from '../../../bindings'
import { createLogger } from '../../../lib/log'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type { Session } from '../types'

const log = createLogger('grouping')

/**
 * Pure conversion of the in-memory `Session[]` shape into the IPC payload.
 * Exposed for testability — call sites should use the hook below.
 */
export const buildGroupingSnapshot = (
  sessions: readonly Session[]
): SetWorkspaceSessionsRequest => ({
  sessions: sessions.map(
    (session): WorkspaceSessionSnapshot => ({
      id: session.id,
      layout: session.layout,
      // Carry the stable session baseline cwd through to the cache so
      // restore can reseed `addPane`'s spawn cwd correctly (Codex P2 on
      // PR #290 cycle 7). Without this the active pane's drifted cwd
      // (via OSC 7) would become the post-reload baseline, and new panes
      // would spawn in the wrong directory.
      workingDirectory: session.workingDirectory,
      panes: session.panes.map((pane, paneIndex) => ({
        ptyId: pane.ptyId,
        paneId: pane.id,
        paneIndex,
        agentType: pane.agentType,
        active: pane.active,
      })),
    })
  ),
})

export interface UsePushWorkspaceGroupingOptions {
  service: ITerminalService
  sessions: readonly Session[]
  /** Skip pushes while the initial restore is still loading — pushing an
   *  empty snapshot before the restored sessions land would clobber the
   *  cache `groupings` we are about to read from. */
  loading: boolean
}

interface PushQueueState {
  inFlight: boolean
  pending: SetWorkspaceSessionsRequest | null
}

const RETRY_BACKOFF_MS = 5000

export const usePushWorkspaceGrouping = ({
  service,
  sessions,
  loading,
}: UsePushWorkspaceGroupingOptions): void => {
  // Single-flight queue: only one `set_workspace_sessions` IPC is in flight
  // at a time, and intermediate snapshots that arrive while one is running
  // collapse into the next push (latest wins).
  //
  // Why this matters: the previous fire-and-forget `service.setWorkspaceSessions(snapshot)`
  // could overlap two snapshots over the wire. The sidecar's IPC router
  // spawns each request into its own handler — two concurrent handlers
  // acquire the cache mutex in whichever order they reach it, so the older
  // snapshot can win last and silently drop the newer pane/layout shape.
  // The next restore would then read the stale cache and fragment back to
  // the older layout. Codex review on PR #290 (P2) flagged this race.
  //
  // Refs (not state): the queue is a side-channel; pushes should not
  // schedule additional renders. The effect re-runs on every sessions
  // change, mutating `queue.current.pending` to the latest snapshot.
  const queueRef = useRef<PushQueueState>({ inFlight: false, pending: null })

  // Mount-lifetime ref for the unmount race. The per-effect cleanup
  // ALSO runs on dependency changes (sessions / service / loading), so a
  // per-effect `disposed` local would conflate harmless re-runs with
  // teardown — a sessions change mid-failed-await would then incorrectly
  // suppress the retry timer and leave the newer snapshot stuck in
  // `pending`. A mount-lifetime ref flips false only on actual unmount,
  // so the catch can distinguish the two.
  //
  // Setup MUST re-assert `true` because React StrictMode runs every
  // effect in dev as setup → cleanup → setup; without the re-assertion
  // the second setup leaves the ref stuck at `false` for the whole
  // mounted lifetime, and the retry gate degrades to "never schedule".
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true

    return (): void => {
      mountedRef.current = false
    }
  }, [])

  // Mount-lifetime ref for the deferred retry timer. Was a per-effect
  // local in cycle 7; Claude reviewer caught the leak (PR #290 cycle 8):
  // if the IPC fails AFTER a dependency-change cleanup ran (cleanup saw
  // `retryTimer === null` because the catch hadn't scheduled yet), the
  // catch then scheduled a timer in the OLD effect's closure — which the
  // NEW effect's cleanup couldn't reach. The orphaned timer would fire
  // unconditionally 5s later, making an extra IPC call against the OLD
  // closure's `service`. Lifting the handle to a useRef means every
  // cleanup — regardless of which effect invocation it belongs to —
  // cancels the same handle.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Latest drain function. Codex re-verify caught that the cancel ref
  // alone wasn't enough: the timer callback still invoked the OLD
  // effect's `drain` closure (which captured the OLD `service`), so if
  // `service` changed between effect runs the deferred retry would push
  // through the stale service. Re-route the timer through this ref so
  // the retry always dispatches to the latest drain — which captures
  // the latest service.
  const latestDrainRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    if (loading) {
      return
    }
    // No live sessions in React state: rely on per-PTY kill_pty cleanup
    // that already drops grouping entries individually. Pushing an empty
    // snapshot here would race the restore window if `sessions` is
    // transiently empty.
    if (sessions.length === 0) {
      return
    }

    const snapshot = buildGroupingSnapshot(sessions)
    log.info(
      `pushing grouping snapshot: ${snapshot.sessions.length} workspace ` +
        `session(s), ${snapshot.sessions.reduce(
          (n, s) => n + s.panes.length,
          0
        )} pane(s)`,
      {
        workspaces: snapshot.sessions.map((s) => ({
          id: s.id,
          layout: s.layout,
          panes: s.panes.length,
        })),
      }
    )

    // Latest wins: overwrite whatever pending snapshot was there.
    queueRef.current.pending = snapshot

    // Drain the queue if no push is currently in flight. JS is
    // single-threaded; the `inFlight` check and set are atomic within a
    // microtask, so two concurrent drain calls cannot both pass the guard.
    const drain = async (): Promise<void> => {
      if (queueRef.current.inFlight) {
        return
      }
      while (queueRef.current.pending !== null) {
        const next = queueRef.current.pending
        queueRef.current.pending = null
        queueRef.current.inFlight = true
        try {
          await service.setWorkspaceSessions(next)
        } catch (err) {
          log.warn('setWorkspaceSessions IPC failed', err)

          // Restore the failed snapshot so the next `sessions` change (or
          // any other call into `drain`) retries it instead of silently
          // dropping it. Without this restore a sidecar crash or transient
          // IPC error mid-push would leave the cache permanently out of
          // sync with React — the layout would fragment back to single-
          // pane on the next reload with no visible signal beyond the
          // console warn.
          //
          // Only restore when no newer snapshot has arrived during the
          // await. `??=` only assigns when the left-hand side is
          // null/undefined, so a concurrent effect re-run that populated
          // `pending` with a newer snapshot wins ("latest wins").
          queueRef.current.pending ??= next

          // Break out of the drain loop instead of immediately retrying.
          // If the IPC keeps failing (sidecar down, etc.), looping here
          // would saturate the microtask queue and flood the log. The
          // restored `pending` will be retried either on the next
          // `sessions` change (which re-enters drain via the effect) OR
          // by the deferred timer below, whichever fires first. That
          // covers the transient-error case where the sidecar recovers
          // in seconds but the user isn't making structural changes —
          // without the timer the cache would stay stale until the next
          // reload fragments. `inFlight` is cleared by the `finally`
          // below so the next entry isn't blocked.
          if (mountedRef.current) {
            retryTimerRef.current ??= setTimeout(() => {
              retryTimerRef.current = null
              if (mountedRef.current && queueRef.current.pending !== null) {
                // Dispatch through `latestDrainRef`, NOT the local
                // `drain`, so a service swap between effect runs takes
                // effect even if this timer was scheduled by an old
                // closure.
                void latestDrainRef.current?.()
              }
            }, RETRY_BACKOFF_MS)
          }

          return
        } finally {
          queueRef.current.inFlight = false
        }
      }
    }
    latestDrainRef.current = drain
    void drain()

    return (): void => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    }
  }, [service, sessions, loading])
}
