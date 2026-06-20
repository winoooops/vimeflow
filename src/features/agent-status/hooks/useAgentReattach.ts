import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke, listen } from '../../../lib/backend'
import { getPtySessionId } from '../../terminal/ptySessionMap'
import type { AgentStatusEvent } from '../types'

// `/clear` (and an in-session `resume`) point the codex agent at a NEW rollout
// file on the SAME pid, but the backend transcript watcher was pinned to the
// old rollout at attach time, so the panel silently stops updating (VIM-188).
// Reattach re-invokes `start_agent_watcher`, whose `run_watch_sequence`
// re-locates the rollout (now open-FD authoritative, VIM-191) and atomically
// replaces the watcher — no stop-then-start.
//
// `/clear` is detectable but fires BEFORE codex opens the new rollout, so the
// auto-reattach is deferred and bounded-retried until a fresh `agent-status`
// with a new `agentSessionId` proves the relocate landed. The in-session
// `resume` is undetectable, so the manual Reattach button is the universal
// recovery.

const REATTACH_AUTO_INITIAL_DELAY_MS = 400
const REATTACH_AUTO_RETRY_INTERVAL_MS = 700
const REATTACH_AUTO_MAX_ATTEMPTS = 5

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
}

export interface AgentReattachControls {
  /** The session is known-stale and the relocate has not yet landed. */
  needsReattach: boolean
  /** Manually re-invoke the watcher relocate (covers the undetectable resume). */
  reattach: () => void
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

  // Returns whether it actually issued an invoke (vs skipped under
  // single-flight) so the auto-retry budget only counts real calls.
  const reattachAsync = useCallback(async (): Promise<boolean> => {
    if (sessionId === null) {
      return false
    }
    const ptyId = getPtySessionId(sessionId)
    if (!ptyId || inFlightRef.current) {
      return false
    }
    inFlightRef.current = true
    // No stop-then-start: the backend re-locates and atomically replaces the
    // watcher; a failed relocate leaves the old watcher intact (rollback-safe).
    try {
      await invoke('start_agent_watcher', { sessionId: ptyId })
    } catch {
      // Relocate failed (transient backend miss / bridge unavailable). Swallow
      // so the bounded auto-retry keeps going and `void reattach()` never leaves
      // an unhandled rejection; the old watcher stays intact and we try again.
    } finally {
      inFlightRef.current = false
    }

    return true
  }, [sessionId])

  const reattach = useCallback((): void => {
    void reattachAsync()
  }, [reattachAsync])

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
          const key = armedStaleKeyRef.current
          if (key !== null) {
            resolvedKeysRef.current.add(key)
          }
          const currentKey = currentStaleKeyRef.current
          if (
            currentKey !== null &&
            currentKey !== key &&
            !resolvedKeysRef.current.has(currentKey)
          ) {
            armedStaleKeyRef.current = currentKey

            return
          }
          armedStaleKeyRef.current = null
          setNeedsReattach(false)
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
  }, [sessionId])

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

  // Deferred, bounded auto-reattach: each attempt waits for its IPC to settle
  // before scheduling the next, and the budget counts only issued calls — so a
  // slow `start_agent_watcher` can't exhaust the retries with single-flight
  // no-ops (codex review VIM-192). Stops as soon as the success predicate
  // clears `needsReattach` (cleanup cancels the pending timer).
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
      if (issued) {
        attempts += 1
      } else if (!inFlightRef.current) {
        attempts += 1
      }
      timer = setTimeout(() => void run(), REATTACH_AUTO_RETRY_INTERVAL_MS)
    }

    timer = setTimeout(() => void run(), REATTACH_AUTO_INITIAL_DELAY_MS)

    return (): void => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [needsReattach, reattachAsync])

  return { needsReattach, reattach }
}
