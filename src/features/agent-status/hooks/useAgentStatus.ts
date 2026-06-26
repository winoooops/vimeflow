import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke, listen } from '../../../lib/backend'
import { getPtySessionId } from '../../terminal/ptySessionMap'
import {
  readStatusSeenToolUseIds,
  readStatusSnapshot,
  writeStatusSeenToolUseIds,
  writeStatusSnapshot,
} from '../utils/statusSnapshotStore'
import {
  createDefaultAgentStatus,
  mapDetectedAgentType,
} from '../utils/agentStatusModel'
import type {
  AgentCwdEvent,
  AgentDetectedEvent,
  AgentReplaySummaryEvent,
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
const DETECTION_POLL_MS = 500
const EXIT_HOLD_MS = 5000

const TOOL_CALL_FLOOD_THRESHOLD = 16

const applyToolCallEvents = (
  prev: AgentStatus,
  events: readonly AgentToolCallEvent[]
): AgentStatus => {
  let toolCalls = prev.toolCalls
  let recentToolCalls = prev.recentToolCalls

  for (const event of events) {
    if (event.status === 'running') {
      toolCalls = {
        ...toolCalls,
        active: {
          tool: event.tool,
          args: event.args,
          startedAt: event.timestamp,
          toolUseId: event.toolUseId,
        },
      }
    } else {
      const byType = { ...toolCalls.byType }
      byType[event.tool] = (byType[event.tool] ?? 0) + 1

      const recentCall: RecentToolCall = {
        id: event.toolUseId,
        tool: event.tool,
        args: event.args,
        status: event.status,
        durationMs: Number(event.durationMs),
        timestamp: event.timestamp,
        isTestFile: event.isTestFile,
      }
      recentToolCalls = [recentCall, ...recentToolCalls].slice(
        0,
        RECENT_TOOL_CALLS_LIMIT
      )

      toolCalls = {
        total: toolCalls.total + 1,
        byType,
        active: null,
      }
    }
  }

  return { ...prev, toolCalls, recentToolCalls }
}

const createStatusForSession = (sessionId: string | null): AgentStatus => {
  if (sessionId === null) {
    return createDefaultAgentStatus(null)
  }

  return readStatusSnapshot(sessionId) ?? createDefaultAgentStatus(sessionId)
}

const shouldTreatStatusAsDetected = (status: AgentStatus): boolean =>
  status.isActive || status.agentExited

const createSeenToolUseIds = (status: AgentStatus): Set<string> =>
  new Set(status.recentToolCalls.map((call) => call.id))

const createSeenToolUseIdsForSession = (
  sessionId: string | null,
  status: AgentStatus
): Set<string> => {
  if (sessionId === null) {
    return createSeenToolUseIds(status)
  }

  const stored = readStatusSeenToolUseIds(sessionId)

  return stored.size > 0 ? stored : createSeenToolUseIds(status)
}

const createRunResetStatus = (
  prev: AgentStatus,
  sessionId: string | null
): AgentStatus => ({
  ...createDefaultAgentStatus(sessionId),
  isActive: prev.isActive,
  agentExited: prev.agentExited,
  agentType: prev.agentType,
  modelId: prev.modelId,
  modelDisplayName: prev.modelDisplayName,
  version: prev.version,
  cwd: prev.cwd,
})

const statusTokenTotal = (
  contextWindow: AgentStatus['contextWindow']
): number | null =>
  contextWindow === null
    ? null
    : contextWindow.totalInputTokens + contextWindow.totalOutputTokens

const eventTokenTotal = (
  contextWindow: AgentStatusEvent['contextWindow']
): number | null =>
  contextWindow === null
    ? null
    : Number(contextWindow.totalInputTokens) +
      Number(contextWindow.totalOutputTokens)

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

export const useAgentStatus = (
  sessionId: string | null,
  resetGeneration = 0
): AgentStatus => {
  const [status, setStatus] = useState<AgentStatus>(() =>
    createStatusForSession(sessionId)
  )

  const seenToolUseIdsRef = useRef<Set<string>>(
    createSeenToolUseIdsForSession(sessionId, status)
  )
  const prevSessionIdRef = useRef<string | null>(sessionId)
  const prevResetGenerationRef = useRef(resetGeneration)
  const locallyResetAgentSessionIdRef = useRef<string | null>(null)
  const locallyResetTokenTotalRef = useRef<number | null>(null)
  const locallyResetRunScopedEventsRef = useRef(false)

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
  const agentEverDetectedRef = useRef(shouldTreatStatusAsDetected(status))
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
  // Agent PID captured from detect_agent_in_session. A pane refresh can
  // replace the Codex/Claude process while preserving the same PTY/pane
  // identity; when that happens, the old transcript watcher must be
  // restarted and run-scoped panel state must be cleared.
  const detectedAgentPidRef = useRef<number | null>(null)

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
  // Detection can start the backend watcher, whose replay events must not
  // fire before the event listeners below are attached.
  const listenersReadyRef = useRef(false)

  useEffect(() => {
    if (prevResetGenerationRef.current === resetGeneration) {
      return
    }

    prevResetGenerationRef.current = resetGeneration
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current)
      collapseTimeoutRef.current = null
    }

    setStatus((prev) => {
      if (prev.agentSessionId !== null) {
        locallyResetAgentSessionIdRef.current = prev.agentSessionId
        locallyResetTokenTotalRef.current = statusTokenTotal(prev.contextWindow)
      }
      locallyResetRunScopedEventsRef.current = true

      return createRunResetStatus(prev, sessionId)
    })
  }, [resetGeneration, sessionId])

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
      const nextStatus = createStatusForSession(sessionId)
      seenToolUseIdsRef.current = createSeenToolUseIdsForSession(
        sessionId,
        nextStatus
      )
      agentEverDetectedRef.current = shouldTreatStatusAsDetected(nextStatus)
      watcherStartedRef.current = false
      watcherStartInFlightRef.current = false
      watcherStartGenerationRef.current += 1
      knownPtyIdRef.current = undefined
      detectedAgentPidRef.current = null
      locallyResetAgentSessionIdRef.current = null
      locallyResetTokenTotalRef.current = null
      locallyResetRunScopedEventsRef.current = false
      listenersReadyRef.current = false
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current)
        collapseTimeoutRef.current = null
      }
      setStatus(nextStatus)
    }
  }, [sessionId])

  useEffect(() => {
    if (status.sessionId === null) {
      return
    }

    writeStatusSnapshot(status.sessionId, status)
    writeStatusSeenToolUseIds(status.sessionId, seenToolUseIdsRef.current)
  }, [status])

  // Detection polling: poll detect_agent_in_session frequently enough that
  // pane chrome returns to shell styling promptly after an agent exits.
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

        const detectedPid = result.pid

        const agentProcessChanged =
          detectedAgentPidRef.current !== null &&
          detectedAgentPidRef.current !== detectedPid

        detectedAgentPidRef.current = detectedPid

        if (agentProcessChanged) {
          watcherStartedRef.current = false
          watcherStartInFlightRef.current = false
          watcherStartGenerationRef.current += 1
          seenToolUseIdsRef.current = new Set()
          writeStatusSeenToolUseIds(sid, seenToolUseIdsRef.current)
          await stopWatchers(sid, knownPtyIdRef.current ?? ptySessionId)
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!isMountedRef.current || currentSessionIdRef.current !== sid) {
            return
          }

          knownPtyIdRef.current = ptySessionId
        }

        setStatus((prev) =>
          prev.sessionId === sid
            ? {
                ...(agentProcessChanged ? createDefaultAgentStatus(sid) : prev),
                isActive: true,
                agentExited: false,
                agentType: mapDetectedAgentType(result.agentType as string),
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
              // Skip stop only when a newer same-sid start has already
              // registered a backend watcher; otherwise we'd tear down
              // its watcher (backend stop is sid-keyed). All other bail
              // paths leave watcherStartedRef false, so they correctly
              // stop here.
              const newerSameSidWatcherIsActive =
                currentSessionIdRef.current === sid &&
                watcherStartGenerationRef.current !== startGeneration &&
                watcherStartedRef.current
              if (!newerSameSidWatcherIsActive) {
                void stopWatchers(sid, ptySessionId)
              }

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
        detectedAgentPidRef.current = null

        watcherStartedRef.current = false
        watcherStartInFlightRef.current = false
        watcherStartGenerationRef.current += 1
        // Do not clear `knownPtyIdRef` here: stopWatchers is fire-and-forget
        // with swallowed errors. If this attempt fails transiently, the
        // session-change cleanup must still have the captured PTY id to retry.
        void stopWatchers(sid, knownPtyIdRef.current)

        setStatus((prev) =>
          prev.sessionId === sid ? { ...prev, agentExited: true } : prev
        )

        // Hold the final snapshot for 5s, then reset the panel to a clean
        // idle state. Reset to the full default rather than only flipping
        // isActive/agentExited: the panel renders run-scoped metrics
        // (context window, tool calls, activity feed, tests, turns)
        // unconditionally, so retaining them here leaves a dead agent's
        // frozen snapshot painting the panel forever while the PTY/pane
        // stays alive (agent exited without closing the pane). Mirrors the
        // session-change and agent-process-change resets above.
        //
        // Runs regardless of watcherStartedRef — that's the F1 fix: a
        // transient start_agent_watcher failure no longer blocks collapse.
        collapseTimeoutRef.current = setTimeout(() => {
          collapseTimeoutRef.current = null
          setStatus((prev) =>
            prev.sessionId === sid ? createDefaultAgentStatus(sid) : prev
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
      if (!listenersReadyRef.current) {
        return
      }

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
    listenersReadyRef.current = false

    const addUnlisten = (fn: () => void): void => {
      if (cancelled) {
        fn()
      } else {
        unlistenFns.push(fn)
      }
    }

    // Coalesce agent-tool-call events into one render per animation frame. A
    // resume replays the whole transcript as thousands of tool-call events; one
    // setState each freezes the renderer. We buffer and flush the latest batch
    // per frame instead. `toolCallFlushScheduled` (a boolean, not the rAF id)
    // gates scheduling so a synchronous rAF (tests/jsdom) still re-arms cleanly.
    let pendingToolCalls: AgentToolCallEvent[] = []
    let toolCallFlushScheduled = false
    let toolCallFrame: number | null = null

    const flushToolCalls = (): void => {
      toolCallFlushScheduled = false
      toolCallFrame = null
      if (pendingToolCalls.length === 0) {
        return
      }
      if (pendingToolCalls.length > TOOL_CALL_FLOOD_THRESHOLD) {
        // Default mode (replay flood): drain the whole backlog in one render so
        // a resume's thousands of historical tool calls don't re-render per event.
        const batch = pendingToolCalls
        pendingToolCalls = []
        setStatus((prev) => applyToolCallEvents(prev, batch))
      } else {
        // Active mode (live agent): release ONE per frame so the JAR stacks each
        // tool call individually as the agent runs.
        const next = pendingToolCalls.shift()!
        setStatus((prev) => applyToolCallEvents(prev, [next]))
      }
      if (pendingToolCalls.length > 0) {
        toolCallFlushScheduled = true
        toolCallFrame = requestAnimationFrame(flushToolCalls)
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
        (payload) => {
          if (payload.sessionId !== resolvePtyId()) {
            return
          }

          const p = payload

          setStatus((prev) => {
            const locallyResetAgentSessionId =
              locallyResetAgentSessionIdRef.current
            if (
              locallyResetAgentSessionId !== null &&
              p.agentSessionId === locallyResetAgentSessionId
            ) {
              const priorTokenTotal = locallyResetTokenTotalRef.current
              const nextTokenTotal = eventTokenTotal(p.contextWindow)
              if (nextTokenTotal === null) {
                return prev
              }

              if (
                nextTokenTotal !== 0 &&
                (priorTokenTotal === null || nextTokenTotal >= priorTokenTotal)
              ) {
                return prev
              }

              locallyResetAgentSessionIdRef.current = null
              locallyResetTokenTotalRef.current = null
            }

            if (
              locallyResetAgentSessionId !== null &&
              p.agentSessionId !== locallyResetAgentSessionId
            ) {
              locallyResetAgentSessionIdRef.current = null
              locallyResetTokenTotalRef.current = null
              locallyResetRunScopedEventsRef.current = false
            }

            if (locallyResetAgentSessionIdRef.current === null) {
              locallyResetRunScopedEventsRef.current = false
            }

            const agentSessionChanged =
              p.agentSessionId !== null &&
              prev.agentSessionId !== null &&
              p.agentSessionId !== prev.agentSessionId

            if (agentSessionChanged && prev.sessionId !== null) {
              seenToolUseIdsRef.current = new Set()
              writeStatusSeenToolUseIds(
                prev.sessionId,
                seenToolUseIdsRef.current
              )
            }

            const base = agentSessionChanged
              ? {
                  ...createDefaultAgentStatus(prev.sessionId),
                  isActive: prev.isActive,
                  agentExited: prev.agentExited,
                  agentType: prev.agentType,
                }
              : prev

            return {
              ...base,
              modelId: p.modelId ?? base.modelId,
              modelDisplayName: p.modelDisplayName ?? base.modelDisplayName,
              version: p.version ?? base.version,
              agentSessionId: p.agentSessionId ?? base.agentSessionId,
              // All nested objects can be null (Option<T> in Rust) —
              // guard every access to avoid silent TypeError crashes.
              contextWindow: p.contextWindow
                ? {
                    usedPercentage:
                      p.contextWindow.usedPercentage === null
                        ? null
                        : Number(p.contextWindow.usedPercentage),
                    contextWindowSize: Number(
                      p.contextWindow.contextWindowSize
                    ),
                    totalInputTokens: Number(p.contextWindow.totalInputTokens),
                    totalOutputTokens: Number(
                      p.contextWindow.totalOutputTokens
                    ),
                    currentUsage: p.contextWindow.currentUsage
                      ? {
                          inputTokens: Number(
                            p.contextWindow.currentUsage.inputTokens
                          ),
                          outputTokens: Number(
                            p.contextWindow.currentUsage.outputTokens
                          ),
                          cacheCreationInputTokens: Number(
                            p.contextWindow.currentUsage
                              .cacheCreationInputTokens
                          ),
                          cacheReadInputTokens: Number(
                            p.contextWindow.currentUsage.cacheReadInputTokens
                          ),
                        }
                      : null,
                  }
                : base.contextWindow,
              cost: p.cost
                ? {
                    totalCostUsd: p.cost.totalCostUsd ?? null,
                    totalDurationMs: Number(p.cost.totalDurationMs),
                    totalApiDurationMs: Number(p.cost.totalApiDurationMs),
                    totalLinesAdded: Number(p.cost.totalLinesAdded),
                    totalLinesRemoved: Number(p.cost.totalLinesRemoved),
                  }
                : base.cost,
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
                            usedPercentage:
                              p.rateLimits.sevenDay.usedPercentage,
                            resetsAt:
                              Number(p.rateLimits.sevenDay.resetsAt) * 1000,
                          },
                        }
                      : {}),
                  }
                : base.rateLimits,
              usageFetched: p.usageFetched,
            }
          })
        }
      )

      addUnlisten(unlistenStatus)

      const unlistenToolCall = await listen<AgentToolCallEvent>(
        'agent-tool-call',
        (payload) => {
          const ptyId = getPtySessionId(sessionId)
          if (payload.sessionId !== ptyId) {
            return
          }

          if (locallyResetRunScopedEventsRef.current) {
            return
          }

          const p = payload

          if (p.status !== 'running') {
            const duplicate = seenToolUseIdsRef.current.has(p.toolUseId)
            seenToolUseIdsRef.current.add(p.toolUseId)
            writeStatusSeenToolUseIds(sessionId, seenToolUseIdsRef.current)

            if (duplicate) {
              setStatus((prev) => {
                const active =
                  prev.toolCalls.active?.toolUseId === p.toolUseId
                    ? null
                    : prev.toolCalls.active

                if (active === prev.toolCalls.active) {
                  return prev
                }

                return {
                  ...prev,
                  toolCalls: {
                    ...prev.toolCalls,
                    active,
                  },
                }
              })

              return
            }
          }

          pendingToolCalls.push(payload)
          if (!toolCallFlushScheduled) {
            toolCallFlushScheduled = true
            toolCallFrame = requestAnimationFrame(flushToolCalls)
          }
        }
      )

      addUnlisten(unlistenToolCall)

      const unlistenTurn = await listen<AgentTurnEvent>(
        'agent-turn',
        (payload) => {
          if (payload.sessionId !== resolvePtyId()) {
            return
          }

          if (locallyResetRunScopedEventsRef.current) {
            return
          }

          // numTurns is u32 in the Rust binding — fits safely in JS number,
          // no Number() coercion needed (those are reserved for u64/i64
          // fields where serde-json may emit values past Number.MAX_SAFE_INTEGER).
          const nextTurns = payload.numTurns

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

      const unlistenCwd = await listen<AgentCwdEvent>(
        'agent-cwd',
        (payload) => {
          if (payload.sessionId !== resolvePtyId()) {
            return
          }

          if (locallyResetRunScopedEventsRef.current) {
            return
          }

          setStatus((prev) =>
            prev.cwd === payload.cwd ? prev : { ...prev, cwd: payload.cwd }
          )
        }
      )

      addUnlisten(unlistenCwd)

      // test-run listener — must be attached before start_agent_watcher fires.
      // Without a backend snapshot cache in v1, missing the latest-of-replay
      // batch from session start would lose the snapshot entirely.
      const unlistenTestRun = await listen<TestRunSnapshot>(
        'test-run',
        (payload) => {
          if (payload.sessionId !== resolvePtyId()) {
            return
          }

          if (locallyResetRunScopedEventsRef.current) {
            return
          }

          setStatus((prev) => ({
            ...prev,
            testRun: payload,
          }))
        }
      )

      addUnlisten(unlistenTestRun)

      // Replay summary — one coalesced event at the replay→live boundary that
      // replaces the thousands of per-line agent-tool-call / agent-turn /
      // agent-cwd events the backend suppresses during a resume's transcript
      // replay (those would flood the IPC queue and freeze the renderer). Apply
      // its aggregated state in one update; live per-line events resume after.
      const unlistenReplaySummary = await listen<AgentReplaySummaryEvent>(
        'agent-replay-summary',
        (payload) => {
          if (payload.sessionId !== resolvePtyId()) {
            return
          }

          if (locallyResetRunScopedEventsRef.current) {
            return
          }

          seenToolUseIdsRef.current = new Set([
            ...seenToolUseIdsRef.current,
            ...payload.recentToolCalls.map((event) => event.toolUseId),
            ...(payload.activeToolCall
              ? [payload.activeToolCall.toolUseId]
              : []),
          ])
          writeStatusSeenToolUseIds(sessionId, seenToolUseIdsRef.current)

          setStatus((prev) => ({
            ...prev,
            numTurns: payload.numTurns,
            cwd: payload.cwd ?? prev.cwd,
            toolCalls: {
              total: payload.toolCallTotal,
              // ts-rs types a Rust HashMap<String, u32> as { [k: string]?: number }
              // (optional values); the wire shape never carries undefined values,
              // so coerce to the non-optional Record the state expects.
              byType: payload.toolCallByType as Record<string, number>,
              active: payload.activeToolCall
                ? {
                    tool: payload.activeToolCall.tool,
                    args: payload.activeToolCall.args,
                    startedAt: payload.activeToolCall.timestamp,
                    toolUseId: payload.activeToolCall.toolUseId,
                  }
                : null,
            },
            recentToolCalls: payload.recentToolCalls
              .slice(0, RECENT_TOOL_CALLS_LIMIT)
              .map((e) => ({
                id: e.toolUseId,
                tool: e.tool,
                args: e.args,
                // The backend only folds completed (done/failed) calls into a
                // replay summary's recentToolCalls — never `running` — so this
                // narrowing is sound at runtime (see ReplayActivity::record_completed).
                status: e.status as 'done' | 'failed',
                durationMs: Number(e.durationMs),
                timestamp: e.timestamp,
                isTestFile: e.isTestFile,
              })),
          }))
        }
      )

      addUnlisten(unlistenReplaySummary)
    }

    // After all listeners are active, trigger a detection poll to sync
    // any events that fired during the async setup window.
    void (async (): Promise<void> => {
      await subscribe()
      // cancelled may have been set during the await — cleanup ran before
      // subscribe resolved. The linter can't see cross-await mutation.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!cancelled) {
        listenersReadyRef.current = true
        void handleDetection(sessionId)
      }
    })()

    return (): void => {
      cancelled = true
      listenersReadyRef.current = false

      if (toolCallFrame !== null) {
        cancelAnimationFrame(toolCallFrame)
        toolCallFrame = null
      }

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
        detectedAgentPidRef.current = null
      }
    },
    []
  )

  return status.sessionId === sessionId
    ? status
    : createStatusForSession(sessionId)
}
