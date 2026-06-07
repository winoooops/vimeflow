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
      // Unmount-only timer clear. The main effect's cleanup deliberately
      // does NOT clear `retryTimerRef` (cycle 16 restructure): dep-change
      // cleanups must NOT reset the 5s backoff or a `cd`-flood during a
      // sidecar outage would retry on every OSC 7 update.
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
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

  // JSON of the snapshot whose failure caused the currently-armed retry
  // timer. Used to distinguish "identical no-op retry" (keep the 5s
  // backoff) from "structurally newer snapshot arrived" (drain
  // immediately) so a pane/layout change after a transient IPC error is
  // not trapped behind the flood gate (Claude MEDIUM on PR #381).
  const retryTargetJsonRef = useRef<string | null>(null)

  // Latest drain function. Codex re-verify caught that the cancel ref
  // alone wasn't enough: the timer callback still invoked the OLD
  // effect's `drain` closure (which captured the OLD `service`), so if
  // `service` changed between effect runs the deferred retry would push
  // through the stale service. Re-route the timer through this ref so
  // the retry always dispatches to the latest drain — which captures
  // the latest service.
  const latestDrainRef = useRef<(() => Promise<void>) | null>(null)

  // Memoize the last-pushed snapshot's JSON shape so we can skip pushes
  // whose payload is identical to the previous one. The effect dep
  // `sessions` triggers on EVERY `setSessions` call, including non-
  // structural mutations (OSC 7 cwd updates, agent-title events,
  // `setPaneUserLabel`, PTY-exit status flips) — none of which change
  // `buildGroupingSnapshot`'s output. Without this guard each one of
  // those mutations writes an identical JSON blob to disk through
  // `cache.mutate`, holding the cache mutex against concurrent
  // `spawn_pty` / `kill_pty` / `list_sessions`. JSON.stringify is fine
  // here: the snapshot is small (workspace + pane scalars only) and the
  // shape is deterministic.
  const lastPushedJsonRef = useRef<string | null>(null)

  // Reset the memoization on a service swap. Without this, a sidecar
  // restart that reconnects with a fresh empty cache would silently skip
  // the first push (the snapshot JSON matches the previous one cached
  // against the OLD service), leaving the new backend's `groupings` map
  // empty — the next reload would fragment every multi-pane workspace
  // back to single-pane, re-introducing the bug this PR fixes. Claude
  // HIGH on PR #290 cycle 16.
  useEffect(() => {
    lastPushedJsonRef.current = null
  }, [service])

  useEffect(() => {
    // Define the drain BEFORE any early returns. `latestDrainRef.current`
    // must be updated on every effect run — including the `loading=true`
    // and `sessions.length === 0` early-exit paths — so a deferred retry
    // timer scheduled by an OLDER closure dispatches through the LATEST
    // service when it fires (Claude MEDIUM on PR #290 cycle 16). drain
    // closes over `service` from the current render, so reassigning the
    // ref to this closure is what makes the swap visible to the timer.
    //
    // The continuation after a successful IPC also dispatches through
    // `latestDrainRef`, not the local `drain`, so a snapshot that landed
    // in `pending` during the in-flight await is pushed via the LATEST
    // closure (which captures the latest service). Codex re-verify on
    // PR #290 cycle 12.
    const drain = async (): Promise<void> => {
      if (queueRef.current.inFlight) {
        return
      }
      if (queueRef.current.pending === null) {
        return
      }
      const next = queueRef.current.pending
      queueRef.current.pending = null
      queueRef.current.inFlight = true
      const failedJson = JSON.stringify(next)
      let drainAfterFailure = false
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

        // Don't immediately retry. If the IPC keeps failing (sidecar
        // down, etc.) a synchronous re-entry here would saturate the
        // microtask queue and flood the log. The restored `pending`
        // will be retried either on the next `sessions` change (which
        // re-enters drain via the effect) OR by the deferred timer
        // below, whichever fires first. That covers the transient-error
        // case where the sidecar recovers in seconds but the user isn't
        // making structural changes — without the timer the cache would
        // stay stale until the next reload fragments. `inFlight` is
        // cleared by the `finally` below so the next entry isn't
        // blocked.
        //
        // Narrowing: a structurally newer snapshot that arrived during
        // the failed await should NOT sit behind the 5s backoff — it
        // drains as soon as `inFlight` clears. Only identical retries
        // (same JSON as the failed snapshot) get the backoff so a
        // stream of non-structural rerenders can't flood a down sidecar
        // (Claude MEDIUM on PR #381).
        const pendingAfterRestore = queueRef.current.pending
        if (mountedRef.current) {
          const pendingJson = JSON.stringify(pendingAfterRestore)
          if (pendingJson === failedJson) {
            retryTargetJsonRef.current = failedJson
            retryTimerRef.current ??= setTimeout(() => {
              retryTimerRef.current = null
              retryTargetJsonRef.current = null
              if (mountedRef.current && queueRef.current.pending !== null) {
                // Dispatch through `latestDrainRef`, NOT the local
                // `drain`, so a service swap between effect runs takes
                // effect even if this timer was scheduled by an old
                // closure.
                void latestDrainRef.current?.()
              }
            }, RETRY_BACKOFF_MS)
          } else {
            // Newer structurally-different snapshot is waiting. Drain
            // it immediately after `finally` clears `inFlight` instead
            // of making it wait for the stale backoff.
            retryTargetJsonRef.current = null
            drainAfterFailure = true
          }
        }

        return
      } finally {
        queueRef.current.inFlight = false
        if (drainAfterFailure && mountedRef.current) {
          if (queueRef.current.pending !== null) {
            void latestDrainRef.current?.()
          }
        }
      }

      // Successful push — if more arrived during the await, continue via
      // the latest drain (captures the latest `service`). The narrower
      // treats `pending` as still null after the consume above; the
      // disable is intentional — a concurrent effect re-run can populate
      // it with a newer snapshot.
      //
      // The `mountedRef` gate keeps the unmount contract symmetric with
      // the retry-timer path: an unmount mid-await must not enqueue
      // another IPC against a torn-down hook (Claude MEDIUM on PR #290
      // cycle 14).
      if (!mountedRef.current) {
        return
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (queueRef.current.pending !== null) {
        void latestDrainRef.current?.()
      }
    }
    // Always keep `latestDrainRef` pointed at the freshest closure —
    // BEFORE any early returns — so a deferred retry timer scheduled by
    // an OLD closure dispatches through this drain (and its captured
    // `service`) when it fires. Cycle 16 fix.
    latestDrainRef.current = drain

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
    const snapshotJson = JSON.stringify(snapshot)
    const isNoOpRerun = snapshotJson === lastPushedJsonRef.current
    if (!isNoOpRerun) {
      lastPushedJsonRef.current = snapshotJson

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
    }

    // Drive a drain whenever there's something to drain. If a retry
    // timer is already armed, compare the pending snapshot's JSON to the
    // failed snapshot that scheduled the timer: identical means the
    // timer is protecting against a no-op flood, so keep it; different
    // means a structurally newer snapshot arrived and should NOT sit
    // behind the 5s backoff — cancel the stale timer and drain now
    // (Claude MEDIUM on PR #381).
    if (queueRef.current.pending !== null) {
      if (retryTimerRef.current !== null) {
        const pendingJson = JSON.stringify(queueRef.current.pending)
        if (pendingJson === retryTargetJsonRef.current) {
          // Backoff already scheduled for this exact payload; wait.
        } else {
          clearTimeout(retryTimerRef.current)
          retryTimerRef.current = null
          retryTargetJsonRef.current = null
          void drain()
        }
      } else {
        void drain()
      }
    }

    // Cycle 16 restructure: NO timer clear in the dep-change cleanup
    // (that's what was bypassing the backoff). The mount-effect's
    // unmount-only cleanup handles `clearTimeout`.
  }, [service, sessions, loading])
}
