import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke, listen } from '../../../lib/backend'
import { getPtySessionId } from '../../terminal/ptySessionMap'
import type { AgentStatusEvent } from '../types'

// `/clear` (and an in-session `resume`) point the codex agent at a NEW rollout
// file on the SAME pid, but the backend transcript watcher was pinned to the
// old rollout at attach time, so the panel silently stops updating (VIM-188).
// Reattach re-invokes `start_agent_watcher`, whose `run_watch_sequence`
// re-locates the rollout (open-FD authoritative, VIM-191; idempotent no-op when
// unchanged, VIM-192) and atomically replaces the watcher — no stop-then-start.
//
// Recovery is fully automatic; there is NO manual button (it would mislead,
// since the relocate can only land once codex WRITES the conversation — i.e.
// when the user sends a prompt). Two mechanisms drive it:
//   - `/clear` is detectable, so it arms a red indicator + a bounded fast
//     auto-reattach to catch the new rollout the moment codex writes it.
//   - the in-session `resume` is undetectable, so an always-on drift tick
//     re-locates the active Codex pane on a cadence; once the resumed
//     conversation is written it becomes the newest rollout and the relocate
//     lands. Either way a fresh `agent-status` (new `agentSessionId`) confirms
//     it and clears the red indicator.

const REATTACH_AUTO_INITIAL_DELAY_MS = 400
const REATTACH_AUTO_RETRY_INTERVAL_MS = 700
const REATTACH_AUTO_MAX_ATTEMPTS = 5
// Always-on drift tick (VIM-192): the active Codex pane re-locates on this
// cadence, regardless of the red state. An in-session `resume` is undetectable
// (it types no `/clear`, so red is never armed) and codex exposes no active-thread
// signal, so the ONLY way the panel can follow a resume is to re-locate
// periodically and relocate once the resumed conversation is written (it then
// becomes the newest `updated_at`). The backend relocate is idempotent — a
// same-rollout re-locate is a cheap no-op (`changed=false`, no re-tail) — so this
// poll costs one per-pid `lsof` + one sqlite query every few seconds for one
// pane. Clearing stays event-gated; the drift tick never clears red itself.
const REATTACH_DRIFT_INTERVAL_MS = 4000

const eventTokenTotal = (
  contextWindow: AgentStatusEvent['contextWindow']
): number | null =>
  contextWindow === null
    ? null
    : Number(contextWindow.totalInputTokens) +
      Number(contextWindow.totalOutputTokens)

interface UseAgentReattachOptions {
  /** Workspace session id of the active pty-backed pane (or `null`). */
  sessionId: string | null
  /**
   * The live agent session id (from `useAgentStatus`). Captured when the pane
   * goes stale so the success predicate can tell the relocated watcher's events
   * (a NEW id) from the old watcher's (the captured id).
   */
  agentSessionId: string | null
  /**
   * Total tokens (input + output) of the live session, from `useAgentStatus`,
   * captured at stale time. A same-session `/clear` keeps the `agentSessionId`
   * but resets the token total, so a later lower total also counts as "fresh".
   */
  agentTokenTotal?: number | null
  /**
   * Increments whenever the session becomes known-stale (a `/clear` was
   * detected for the active pane). `0` means "not stale". The value is
   * per-active-pane, so it reappears when that pane is re-selected — staleness
   * is therefore keyed by `sessionId:staleGeneration` and tracked as resolved
   * once the relocate lands, so a re-selected (already-recovered) pane does not
   * flash red again.
   */
  staleGeneration: number
  /**
   * Gate for the always-on drift tick: `true` only when the active pty-backed
   * pane is running a live Codex agent. Drift re-locates this pane every
   * `REATTACH_DRIFT_INTERVAL_MS` so the panel follows an in-session `resume`
   * (undetectable, so it never arms red). Off for non-Codex / no live agent so
   * the periodic `lsof` cost is paid only where a rollout switch can happen.
   */
  driftEnabled?: boolean
}

export interface AgentReattachControls {
  /**
   * The session is known-stale (a codex `/clear`) and the relocate has not yet
   * landed. Recovery is automatic — the bounded auto-reattach + the always-on
   * drift tick relocate once codex writes the conversation — so this drives a
   * red "send a prompt to reattach" indicator, not a manual action.
   */
  needsReattach: boolean
}

/**
 * Recovery controls for a codex agent-status panel that froze after a `/clear`
 * or in-session `resume`.
 */
export const useAgentReattach = ({
  sessionId,
  agentSessionId,
  agentTokenTotal = null,
  staleGeneration,
  driftEnabled = false,
}: UseAgentReattachOptions): AgentReattachControls => {
  const [needsReattach, setNeedsReattach] = useState(false)

  // Identity of the active pane's current staleness, or `null` when not stale.
  const staleKey =
    sessionId !== null && staleGeneration !== 0
      ? `${sessionId}:${staleGeneration}`
      : null

  // Mirrors so the long-lived event listener reads current values without being
  // torn down and re-subscribed on every change.
  const needsReattachRef = useRef(false)
  needsReattachRef.current = needsReattach
  const agentSessionIdRef = useRef(agentSessionId)
  agentSessionIdRef.current = agentSessionId
  const agentTokenTotalRef = useRef(agentTokenTotal)
  agentTokenTotalRef.current = agentTokenTotal
  const currentStaleKeyRef = useRef(staleKey)
  currentStaleKeyRef.current = staleKey
  // Single-flight guard so a manual click and the auto-retry can't issue
  // overlapping `start_agent_watcher` invokes.
  const inFlightRef = useRef(false)
  // The agent session id that was live when the pane went stale. The relocated
  // watcher proves success by emitting a DIFFERENT id; the old watcher keeps
  // emitting this one, so its events must not clear the red state.
  const staleAgentSessionIdRef = useRef<string | null>(null)
  const staleTokenTotalRef = useRef<number | null>(null)
  // Session the stale identity was captured for, so a repeated `/clear` on the
  // same pane keeps the original pre-clear identity (by then useAgentStatus has
  // already reset the live id/total to null).
  const staleCaptureSessionRef = useRef<string | null>(null)
  // Stale keys whose relocate has succeeded — re-selecting that pane must not
  // re-arm the red state (codex review VIM-192).
  const resolvedKeysRef = useRef<Set<string>>(new Set())
  // The stale key armed by the current red-state cycle. Unlike `staleKey`,
  // this is not a render mirror, so an async success event cannot resolve a
  // newer `/clear` generation that arrived while the event was in flight.
  const armedStaleKeyRef = useRef<string | null>(null)

  // Resolve the armed `/clear` cycle: mark its key resolved and drop red. If a
  // NEWER `/clear` armed after this resolve was decided, re-arm for it instead
  // of clearing (it still needs its own recovery). No-op when not currently
  // stale. Shared by the success listener and the manual button.
  const resolveArmedReattach = useCallback((): void => {
    if (!needsReattachRef.current) {
      return
    }
    const armed = armedStaleKeyRef.current
    if (armed !== null) {
      resolvedKeysRef.current.add(armed)
    }
    const currentKey = currentStaleKeyRef.current
    if (
      currentKey !== null &&
      currentKey !== armed &&
      !resolvedKeysRef.current.has(currentKey)
    ) {
      armedStaleKeyRef.current = currentKey

      return
    }
    armedStaleKeyRef.current = null
    setNeedsReattach(false)
  }, [])

  // Issue `start_agent_watcher` under the single-flight guard. Outcome:
  //   'ok'      — the IPC resolved (await?-propagated; the resolver fails safe
  //               with `Err`). The backend relocate is idempotent: a same-rollout
  //               re-locate is a cheap no-op, so this is safe to call on a tick.
  //   'failed'  — the IPC threw (transient miss / bridge / rollout not open yet).
  //   'skipped' — no session/pty, or another invoke is already in flight.
  // Clearing red is strictly event-gated (there is no optimistic clear / manual
  // button), so the caller never needs to know whether the relocate switched.
  const issueReattach = useCallback(async (): Promise<
    'ok' | 'failed' | 'skipped'
  > => {
    if (sessionId === null) {
      return 'skipped'
    }
    const ptyId = getPtySessionId(sessionId)
    if (!ptyId || inFlightRef.current) {
      return 'skipped'
    }
    inFlightRef.current = true
    // No stop-then-start: the backend re-locates and atomically replaces the
    // watcher; a failed relocate leaves the old watcher intact (rollback-safe).
    try {
      await invoke('start_agent_watcher', { sessionId: ptyId })

      return 'ok'
    } catch {
      return 'failed'
    } finally {
      inFlightRef.current = false
    }
  }, [sessionId])

  // Auto-retry path: "issued" = an invoke was attempted (ok or failed), so the
  // budget isn't burned by single-flight skips. It NEVER clears red — clearing
  // is event-gated (the listener), confirming the relocate actually landed.
  const reattachAsync = useCallback(
    async (): Promise<boolean> => (await issueReattach()) !== 'skipped',
    [issueReattach]
  )

  // Success predicate: a fresh `agent-status` carrying an `agentSessionId` that
  // DIFFERS from the one live when we went stale means the relocated watcher is
  // emitting → mark the key resolved and drop the red state. The old watcher
  // keeps emitting the captured stale id, which is correctly ignored.
  useEffect(() => {
    if (sessionId === null) {
      return
    }

    let cancelled = false
    let unlisten: (() => void) | undefined

    const subscribe = async (): Promise<void> => {
      const fn = await listen<AgentStatusEvent>('agent-status', (payload) => {
        if (cancelled || payload.sessionId !== getPtySessionId(sessionId)) {
          return
        }
        const id = payload.agentSessionId
        const staleId = staleAgentSessionIdRef.current
        const staleTotal = staleTokenTotalRef.current
        const eventTotal = eventTokenTotal(payload.contextWindow)

        // Fresh when a relocated run is observed: a DIFFERENT agentSessionId, or
        // the SAME id whose token total reset — either a drop below the captured
        // total, an explicit zero (covers a `/clear` whose pre-clear total was
        // 0), or any known total when the pre-clear baseline was unknown.
        // Mirrors useAgentStatus's local reset latch so the red state only
        // clears when the status panel can accept the same event.
        const tokensReset =
          eventTotal !== null &&
          (eventTotal === 0 || staleTotal === null || eventTotal < staleTotal)
        const isFresh = id !== null && (id !== staleId || tokensReset)
        if (needsReattachRef.current && isFresh) {
          resolveArmedReattach()
        }
      })
      if (cancelled) {
        fn()
      } else {
        unlisten = fn
      }
    }

    void subscribe()

    return (): void => {
      cancelled = true
      unlisten?.()
    }
  }, [sessionId, resolveArmedReattach])

  // Derive the red state from the active pane's stale key: armed when stale and
  // not yet resolved, cleared otherwise. Keyed by `sessionId:staleGeneration`
  // so switching to a non-stale (or already-recovered) pane clears it and a
  // re-selected recovered pane never flashes red again.
  useEffect(() => {
    if (staleKey === null) {
      armedStaleKeyRef.current = null
      setNeedsReattach(false)

      return
    }

    if (resolvedKeysRef.current.has(staleKey)) {
      staleAgentSessionIdRef.current = null
      staleTokenTotalRef.current = null
      staleCaptureSessionRef.current = null
      armedStaleKeyRef.current = null
      setNeedsReattach(false)

      return
    }
    // Preserve the original pre-clear identity across repeated `/clear` on the
    // same session: by the second clear useAgentStatus has reset the live id to
    // null, and overwriting with null would let the OLD watcher's events look
    // fresh and falsely resolve (codex review VIM-192).
    const sameSession = staleCaptureSessionRef.current === sessionId
    if (!sameSession || agentSessionIdRef.current !== null) {
      staleAgentSessionIdRef.current = agentSessionIdRef.current
      staleTokenTotalRef.current = agentTokenTotalRef.current
    }
    staleCaptureSessionRef.current = sessionId
    if (!needsReattachRef.current || armedStaleKeyRef.current === null) {
      armedStaleKeyRef.current = staleKey
    }
    setNeedsReattach(true)
  }, [staleKey, sessionId])

  // Deferred, bounded auto-reattach for each armed `/clear` cycle (keyed by
  // `staleKey` so a repeated `/clear` restarts the window). Quick speculative
  // retries catch the common `/clear` relocate the moment codex opens + writes
  // the new rollout. The budget counts only issued calls — so a slow
  // `start_agent_watcher` can't exhaust the retries with single-flight no-ops.
  // It NEVER clears red itself (event-gated). Late recovery (the user interacts
  // with the new/resumed rollout long after this window) is covered by the
  // always-on drift tick below, so this stays bounded. Stops as soon as the
  // success predicate clears `needsReattach` (cleanup cancels the pending timer).
  useEffect(() => {
    if (!needsReattach) {
      return
    }

    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>

    const run = async (): Promise<void> => {
      if (cancelled || attempts >= REATTACH_AUTO_MAX_ATTEMPTS) {
        return
      }
      const issued = await reattachAsync()
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the effect cleanup sets `cancelled` across the await above
      if (cancelled) {
        return
      }
      if (issued || !inFlightRef.current) {
        attempts += 1
      }
      timer = setTimeout(() => void run(), REATTACH_AUTO_RETRY_INTERVAL_MS)
    }

    timer = setTimeout(() => void run(), REATTACH_AUTO_INITIAL_DELAY_MS)

    return (): void => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [needsReattach, staleKey, reattachAsync])

  // Always-on drift tick: re-locate the active Codex pane on a fixed cadence so
  // the panel follows an in-session `resume`. Resume is undetectable (no `/clear`
  // → red is never armed) and codex exposes no active-thread signal, so the only
  // way to notice the switch is to re-locate periodically: once the resumed
  // conversation is written it becomes the newest `updated_at`, the backend
  // relocate reports `changed=true`, and its fresh `agent-status` event updates
  // the panel (and clears red if a `/clear` cycle happens to be armed). A
  // same-rollout tick is a cheap backend no-op. Single-flight is shared with the
  // bounded retry + manual button (`inFlightRef`), so the periodic `lsof` can't
  // stack. Off unless the active pane runs a live Codex agent.
  useEffect(() => {
    if (!driftEnabled || sessionId === null) {
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const tick = async (): Promise<void> => {
      if (cancelled) {
        return
      }
      // Fire and forget: clearing is strictly event-gated, so the drift tick
      // never resolves red on its own — it only re-invites the resolver.
      await issueReattach()
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the effect cleanup sets `cancelled` across the await above
      if (cancelled) {
        return
      }
      timer = setTimeout(() => void tick(), REATTACH_DRIFT_INTERVAL_MS)
    }

    timer = setTimeout(() => void tick(), REATTACH_DRIFT_INTERVAL_MS)

    return (): void => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [driftEnabled, sessionId, issueReattach])

  return { needsReattach }
}
