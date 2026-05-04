import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getPtySessionId } from '../../terminal/ptySessionMap'
import type {
  AgentDetectedEvent,
  AgentStatus,
  AgentStatusEvent,
  AgentToolCallEvent,
  AgentTurnEvent,
  RecentToolCall,
  TestRunSnapshot,
} from '../types'

// Backend cap for the sliding window of completed tool calls. The
// ActivityFeed paginates this with a 'show more' control so the whole
// buffer is reachable without overloading the initial render.
const RECENT_TOOL_CALLS_LIMIT = 50
const DETECTION_POLL_MS = 2000
const EXIT_HOLD_MS = 5000

const AGENT_TYPE_MAP = {
  claudeCode: 'claude-code',
  codex: 'codex',
  aider: 'aider',
  generic: 'generic',
} as const

const isKnownAgentType = (
  value: string
): value is keyof typeof AGENT_TYPE_MAP =>
  Object.prototype.hasOwnProperty.call(AGENT_TYPE_MAP, value)

const createDefaultStatus = (sessionId: string | null): AgentStatus => ({
  isActive: false,
  agentType: null,
  modelId: null,
  modelDisplayName: null,
  version: null,
  sessionId,
  agentSessionId: null,
  contextWindow: null,
  cost: null,
  rateLimits: null,
  numTurns: 0,
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
  testRun: null,
})

/**
 * Stop all agent watchers for a given session (best-effort, logs on failure).
 *
 * `knownPtyId` is the PTY session ID captured at the time the watcher was
 * started. Pass it whenever the call site has it, because by the time a
 * stale-start cleanup fires the workspace→PTY mapping may already be
 * unregistered — `getPtySessionId(workspaceSessionId)` would then fall back
 * to the workspace ID and the backend `stop_agent_watcher` IPC would target
 * the wrong session, leaking the newly-started backend watcher (Codex review
 * on PR #153, F14). When `knownPtyId` is omitted (session-change /
 * detection-loop / unmount cleanup paths), the workspace→PTY lookup is the
 * best available source.
 */
const stopWatchers = async (
  workspaceSessionId: string,
  knownPtyId?: string
): Promise<void> => {
  const ptyId =
    knownPtyId ?? getPtySessionId(workspaceSessionId) ?? workspaceSessionId
  try {
    await invoke('stop_agent_watcher', { sessionId: ptyId })
  } catch {
    // Watcher may not be running — ignore
  }
}

export const useAgentStatus = (sessionId: string | null): AgentStatus => {
  const [status, setStatus] = useState<AgentStatus>(() =>
    createDefaultStatus(sessionId)
  )
  const prevSessionIdRef = useRef<string | null>(sessionId)

  // Two refs with distinct semantics — DO NOT collapse them. Collapsing
  // them was the source of the F1 panel-stuck bug Codex flagged twice
  // on PR #152: a transient detection failure on the backend leaves
  // `watcherStartedRef` false, so the exit-collapse `else` branch
  // early-returns and the panel stays in `isActive: true` forever.
  //
  //   - `agentEverDetectedRef`: did detect_agent_in_session ever
  //     succeed for this session? Used to gate the exit-collapse path
  //     (only collapse if we ever showed an active agent).
  //   - `watcherStartedRef`: did `start_agent_watcher` invoke succeed?
  //     Used to gate re-invoking `start_agent_watcher` (avoid duplicate
  //     watchers per detection poll). Stop calls are NOT gated on this
  //     ref — every cleanup path invokes `stopWatchers` unconditionally
  //     (see F2 fix on PR #153). The ref reflects only the LAST local
  //     start outcome, so a prior failed stop would lie and let a
  //     stale-cwd backend watcher leak across session changes.
  //
  // The collapse path runs whenever the agent has been detected in the
  // past and is now gone, regardless of whether the backend watcher
  // start succeeded — so transient `start_agent_watcher` failures no
  // longer leave the panel stuck.
  const agentEverDetectedRef = useRef(false)
  const watcherStartedRef = useRef(false)
  // Distinct from watcherStartedRef: this guards the await window while
  // start_agent_watcher is in flight. Without it, overlapping detection
  // polls can both observe watcherStartedRef=false and both invoke start,
  // causing backend watcher churn and repeated transcript replays when the
  // user switches rapidly between sessions.
  const watcherStartInFlightRef = useRef(false)
  // Monotonic generation for invalidating stale watcher-start completions.
  // Increment on session changes and agent-exit transitions so an old
  // start_agent_watcher resolve cannot "win" after the session moved on.
  const watcherStartGenerationRef = useRef(0)
  // PTY id captured at start so cleanup stops the right backend watcher.
  const knownPtyIdRef = useRef<string | undefined>(undefined)

  // Stale-detection guard: written synchronously during render so IPC continuations see the latest sessionId.
  const currentSessionIdRef = useRef(sessionId)
  currentSessionIdRef.current = sessionId

  // Mount guard for in-flight IPC continuations that resolve after unmount.
  // Maintained by a dedicated [] effect (below) so the ref is reset to true
  // when React StrictMode runs its mount→cleanup→remount cycle in dev.
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true

    return (): void => {
      isMountedRef.current = false
    }
  }, [])

  // Track the collapse timeout so it can be cancelled if the agent
  // reappears before the 5s hold expires (e.g., brief detection gap).
  const collapseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset state when sessionId changes
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      // Clean up watchers for the old session. We always invoke
      // `stopWatchers` (which suppresses errors) rather than gating on
      // `watcherStartedRef.current`, because the ref reflects only the
      // last LOCAL start outcome — if a prior `stop_agent_watcher`
      // failed transiently, the ref reads false but the BACKEND watcher
      // is still alive. Skipping stop here would leak that watcher
      // across the session-change boundary (Codex review on PR #153).
      const oldId = prevSessionIdRef.current
      if (oldId) {
        void stopWatchers(oldId, knownPtyIdRef.current)
      }

      prevSessionIdRef.current = sessionId
      agentEverDetectedRef.current = false
      watcherStartedRef.current = false
      watcherStartInFlightRef.current = false
      watcherStartGenerationRef.current += 1
      knownPtyIdRef.current = undefined
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current)
        collapseTimeoutRef.current = null
      }
      setStatus(createDefaultStatus(sessionId))
    }
  }, [sessionId])

  // Detection polling: poll detect_agent_in_session every 2s.
  // On detection, update state. On agent exit, stop watchers and
  // hold final state for 5s before collapsing.
  const handleDetection = useCallback(async (sid: string): Promise<void> => {
    try {
      // Resolve workspace session ID → PTY session ID
      const ptySessionId = getPtySessionId(sid)
      if (!ptySessionId) {
        return // PTY not spawned yet
      }

      const result = await invoke<AgentDetectedEvent | null>(
        'detect_agent_in_session',
        { sessionId: ptySessionId }
      )

      // Drop stale results: session changed since this detection started,
      // or the component unmounted (unmount doesn't re-render so the
      // session-id ref can't catch that case alone).
      if (!isMountedRef.current || currentSessionIdRef.current !== sid) {
        return
      }

      if (result) {
        // Cancel any pending collapse timeout — agent is (still) running
        if (collapseTimeoutRef.current) {
          clearTimeout(collapseTimeoutRef.current)
          collapseTimeoutRef.current = null
        }

        const agentKey = result.agentType as string

        const mapped = isKnownAgentType(agentKey)
          ? AGENT_TYPE_MAP[agentKey]
          : 'generic'

        setStatus((prev) =>
          prev.sessionId === sid
            ? {
                ...prev,
                isActive: true,
                agentType: mapped,
              }
            : prev
        )
        agentEverDetectedRef.current = true

        // Start the status-line file watcher (only once).
        // The path is derived server-side from the PTY session's CWD —
        // the frontend only sends the session ID (prevents path traversal).
        // If start_agent_watcher fails (transient backend detection
        // miss), `watcherStartedRef` stays false and we retry on the
        // next poll. The exit-collapse path is gated on
        // `agentEverDetectedRef`, NOT this ref, so a stuck-failed start
        // no longer leaves the panel active forever.
        if (!watcherStartedRef.current && !watcherStartInFlightRef.current) {
          const startGeneration = ++watcherStartGenerationRef.current
          watcherStartInFlightRef.current = true
          try {
            await invoke('start_agent_watcher', {
              sessionId: ptySessionId,
            })

            // Stale-start cleanup also catches post-unmount races; pass
            // the captured ptySessionId so stop targets the right watcher.
            // ESLint can't see that `isMountedRef.current` is mutated by
            // the dedicated mount-tracking effect's cleanup, nor that
            // `currentSessionIdRef.current` / `agentEverDetectedRef.current`
            // / `watcherStartGenerationRef.current` are mutated by other
            // async paths — so it flags these checks as "unnecessary."
            // They ARE
            // load-bearing across the await above.
            /* eslint-disable @typescript-eslint/no-unnecessary-condition */
            if (
              !isMountedRef.current ||
              currentSessionIdRef.current !== sid ||
              !agentEverDetectedRef.current ||
              watcherStartGenerationRef.current !== startGeneration
            ) {
              void stopWatchers(sid, ptySessionId)

              return
            }
            /* eslint-enable @typescript-eslint/no-unnecessary-condition */

            knownPtyIdRef.current = ptySessionId
            watcherStartedRef.current = true
          } catch {
            // Watcher may fail if bridge files weren't generated, or the
            // backend's re-detect raced with agent exit — retry next poll.
          } finally {
            if (watcherStartGenerationRef.current === startGeneration) {
              watcherStartInFlightRef.current = false
            }
          }
        }
      } else {
        // Agent exited (or was never detected this session). Only run
        // the collapse path if we actually showed an active agent at
        // some point — otherwise we'd schedule a no-op timeout from
        // every "no agent yet" poll.
        if (!agentEverDetectedRef.current) {
          return
        }
        agentEverDetectedRef.current = false

        watcherStartedRef.current = false
        watcherStartInFlightRef.current = false
        watcherStartGenerationRef.current += 1
        // Do not clear `knownPtyIdRef` here: stopWatchers is fire-and-forget
        // with swallowed errors. If this attempt fails transiently, the
        // session-change cleanup must still have the captured PTY id to retry.
        void stopWatchers(sid, knownPtyIdRef.current)

        // Hold final state for 5s, then collapse. Runs regardless of
        // watcherStartedRef — that's the F1 fix: a transient
        // start_agent_watcher failure no longer blocks collapse.
        collapseTimeoutRef.current = setTimeout(() => {
          collapseTimeoutRef.current = null
          setStatus((prev) =>
            prev.sessionId === sid ? { ...prev, isActive: false } : prev
          )
        }, EXIT_HOLD_MS)
      }
    } catch {
      // Session may not exist yet or IPC failed — ignore
    }
  }, [])

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const interval = setInterval(() => {
      void handleDetection(sessionId)
    }, DETECTION_POLL_MS)

    // Note: the initial detection call is fired by the subscribe useEffect
    // *after* listeners are attached. Triggering it here would race with
    // subscribe() and potentially fire start_agent_watcher before the
    // test-run listener is attached, missing the latest-of-replay snapshot.

    return (): void => {
      clearInterval(interval)
    }
  }, [sessionId, handleDetection])

  // Event subscriptions for status updates, tool calls, and disconnects.
  // Events from Rust use the PTY session ID, so we need to resolve
  // the workspace session ID → PTY session ID for filtering.
  useEffect(() => {
    if (!sessionId) {
      return
    }

    const unlistenFns: (() => void)[] = []
    let cancelled = false

    const addUnlisten = (fn: () => void): void => {
      if (cancelled) {
        fn()
      } else {
        unlistenFns.push(fn)
      }
    }

    const subscribe = async (): Promise<void> => {
      const resolvePtyId = (): string | undefined => getPtySessionId(sessionId)

      // agent-detected and agent-disconnected are handled by polling in
      // handleDetection — no Rust-side events are emitted for these.
      // Only agent-status, agent-tool-call, agent-turn, and test-run are
      // event-driven.

      const unlistenStatus = await listen<AgentStatusEvent>(
        'agent-status',
        (event) => {
          if (event.payload.sessionId !== resolvePtyId()) {
            return
          }

          const p = event.payload

          setStatus((prev) => ({
            ...prev,
            modelId: p.modelId ?? prev.modelId,
            modelDisplayName: p.modelDisplayName ?? prev.modelDisplayName,
            version: p.version ?? prev.version,
            agentSessionId: p.agentSessionId ?? prev.agentSessionId,
            // All nested objects can be null (Option<T> in Rust) —
            // guard every access to avoid silent TypeError crashes.
            contextWindow: p.contextWindow
              ? {
                  usedPercentage: p.contextWindow.usedPercentage ?? 0,
                  contextWindowSize: Number(p.contextWindow.contextWindowSize),
                  totalInputTokens: Number(p.contextWindow.totalInputTokens),
                  totalOutputTokens: Number(p.contextWindow.totalOutputTokens),
                  currentUsage: p.contextWindow.currentUsage
                    ? {
                        inputTokens: Number(
                          p.contextWindow.currentUsage.inputTokens
                        ),
                        outputTokens: Number(
                          p.contextWindow.currentUsage.outputTokens
                        ),
                        cacheCreationInputTokens: Number(
                          p.contextWindow.currentUsage.cacheCreationInputTokens
                        ),
                        cacheReadInputTokens: Number(
                          p.contextWindow.currentUsage.cacheReadInputTokens
                        ),
                      }
                    : null,
                }
              : prev.contextWindow,
            cost: p.cost
              ? {
                  totalCostUsd: p.cost.totalCostUsd ?? null,
                  totalDurationMs: Number(p.cost.totalDurationMs),
                  totalApiDurationMs: Number(p.cost.totalApiDurationMs),
                  totalLinesAdded: Number(p.cost.totalLinesAdded),
                  totalLinesRemoved: Number(p.cost.totalLinesRemoved),
                }
              : prev.cost,
            rateLimits: p.rateLimits?.fiveHour
              ? {
                  fiveHour: {
                    usedPercentage: p.rateLimits.fiveHour.usedPercentage,
                    // resets_at is Unix epoch seconds (u64 from Rust → bigint in TS)
                    resetsAt: Number(p.rateLimits.fiveHour.resetsAt) * 1000,
                  },
                  ...(p.rateLimits.sevenDay
                    ? {
                        sevenDay: {
                          usedPercentage: p.rateLimits.sevenDay.usedPercentage,
                          resetsAt:
                            Number(p.rateLimits.sevenDay.resetsAt) * 1000,
                        },
                      }
                    : {}),
                }
              : prev.rateLimits,
          }))
        }
      )

      addUnlisten(unlistenStatus)

      const unlistenToolCall = await listen<AgentToolCallEvent>(
        'agent-tool-call',
        (event) => {
          const ptyId = getPtySessionId(sessionId)
          if (event.payload.sessionId !== ptyId) {
            return
          }

          const p = event.payload

          if (p.status === 'running') {
            setStatus((prev) => ({
              ...prev,
              toolCalls: {
                ...prev.toolCalls,
                active: {
                  tool: p.tool,
                  args: p.args,
                  startedAt: p.timestamp,
                  toolUseId: p.toolUseId,
                },
              },
            }))
          } else {
            // done or failed
            //
            // Use the Anthropic tool_use id as the React key.
            // `${p.tool}-${p.timestamp}` collides when parallel tool calls
            // share a user-message timestamp (common with parallel Read/Grep);
            // React silently drops the duplicate rows from the feed.
            const recentCall: RecentToolCall = {
              id: p.toolUseId,
              tool: p.tool,
              args: p.args,
              status: p.status,
              durationMs: Number(p.durationMs) || null,
              timestamp: p.timestamp,
              isTestFile: p.isTestFile,
            }

            setStatus((prev) => {
              const newByType = { ...prev.toolCalls.byType }
              newByType[p.tool] = (newByType[p.tool] ?? 0) + 1

              const newRecent = [recentCall, ...prev.recentToolCalls].slice(
                0,
                RECENT_TOOL_CALLS_LIMIT
              )

              return {
                ...prev,
                toolCalls: {
                  total: prev.toolCalls.total + 1,
                  byType: newByType,
                  active: null,
                },
                recentToolCalls: newRecent,
              }
            })
          }
        }
      )

      addUnlisten(unlistenToolCall)

      const unlistenTurn = await listen<AgentTurnEvent>(
        'agent-turn',
        (event) => {
          if (event.payload.sessionId !== resolvePtyId()) {
            return
          }

          // numTurns is u32 in the Rust binding — fits safely in JS number,
          // no Number() coercion needed (those are reserved for u64/i64
          // fields where serde-json may emit values past Number.MAX_SAFE_INTEGER).
          const nextTurns = event.payload.numTurns

          setStatus((prev) => ({
            ...prev,
            // A drop in numTurns signals a transcript restart on the same
            // PTY (e.g. user re-ran `claude`); accept the lower value as
            // the reset. Math.max otherwise keeps the count monotonic
            // against out-of-order replay events within a single run.
            numTurns:
              nextTurns < prev.numTurns
                ? nextTurns
                : Math.max(prev.numTurns, nextTurns),
          }))
        }
      )

      addUnlisten(unlistenTurn)

      // test-run listener — must be attached before start_agent_watcher fires.
      // Without a backend snapshot cache in v1, missing the latest-of-replay
      // batch from session start would lose the snapshot entirely.
      const unlistenTestRun = await listen<TestRunSnapshot>(
        'test-run',
        (event) => {
          if (event.payload.sessionId !== resolvePtyId()) {
            return
          }

          setStatus((prev) => ({
            ...prev,
            testRun: event.payload,
          }))
        }
      )

      addUnlisten(unlistenTestRun)
    }

    // After all listeners are active, trigger a detection poll to sync
    // any events that fired during the async setup window.
    void (async (): Promise<void> => {
      await subscribe()
      // cancelled may have been set during the await — cleanup ran before
      // subscribe resolved. The linter can't see cross-await mutation.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!cancelled) {
        void handleDetection(sessionId)
      }
    })()

    return (): void => {
      cancelled = true

      for (const unlisten of unlistenFns) {
        unlisten()
      }
    }
  }, [sessionId, handleDetection])

  // Cleanup watchers when the hook unmounts entirely.
  // Read from prevSessionIdRef (not the closure's sessionId) so the
  // cleanup sees the LATEST session, not the mount-time null.
  //
  // Also clear the pending collapse timeout — if the hook unmounts
  // during the 5s exit-hold window, the scheduled callback would
  // otherwise fire setStatus against an unmounted component
  // (no-op in React 18, but the closure retains a reference and
  // leaks the state setter across multi-session navigation).
  useEffect(
    () => (): void => {
      // The dedicated `isMountedRef` effect above flips the ref to
      // false on this same unmount and resets it to true on a
      // StrictMode remount. Don't duplicate the flip here — doing so
      // would race with the StrictMode remount-setup effect.
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current)
        collapseTimeoutRef.current = null
      }
      const sid = prevSessionIdRef.current
      if (sid) {
        watcherStartedRef.current = false
        watcherStartInFlightRef.current = false
        watcherStartGenerationRef.current += 1
        void stopWatchers(sid, knownPtyIdRef.current)
        knownPtyIdRef.current = undefined
      }
    },
    []
  )

  return status
}
