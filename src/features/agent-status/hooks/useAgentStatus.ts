import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getPtySessionId } from '../../terminal/ptySessionMap'
import type {
  AgentDetectedEvent,
  AgentStatus,
  AgentStatusEvent,
  AgentToolCallEvent,
  RecentToolCall,
} from '../types'

const RECENT_TOOL_CALLS_LIMIT = 10
const DETECTION_POLL_MS = 2000
const EXIT_HOLD_MS = 5000

const AGENT_TYPE_MAP = {
  claudeCode: 'claude-code',
  codex: 'codex',
  aider: 'aider',
  generic: 'generic',
} as const

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
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
})

/** Stop all agent watchers for a given session (best-effort, logs on failure) */
const stopWatchers = async (workspaceSessionId: string): Promise<void> => {
  const ptyId = getPtySessionId(workspaceSessionId) ?? workspaceSessionId
  try {
    await invoke('stop_agent_watcher', { sessionId: ptyId })
  } catch {
    // Watcher may not be running — ignore
  }
  try {
    await invoke('stop_transcript_watcher', { sessionId: ptyId })
  } catch {
    // Transcript watcher may not be running — ignore
  }
}

export const useAgentStatus = (sessionId: string | null): AgentStatus => {
  const [status, setStatus] = useState<AgentStatus>(() =>
    createDefaultStatus(sessionId)
  )
  const prevSessionIdRef = useRef<string | null>(sessionId)

  // Track whether the watcher has been started for this session so we
  // don't start duplicate watchers on every poll hit.
  const watcherStartedRef = useRef(false)

  // Track the collapse timeout so it can be cancelled if the agent
  // reappears before the 5s hold expires (e.g., brief detection gap).
  const collapseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset state when sessionId changes
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      // Clean up watchers for the old session
      const oldId = prevSessionIdRef.current
      if (oldId) {
        void stopWatchers(oldId)
      }

      prevSessionIdRef.current = sessionId
      watcherStartedRef.current = false
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

      if (result) {
        // Cancel any pending collapse timeout — agent is (still) running
        if (collapseTimeoutRef.current) {
          clearTimeout(collapseTimeoutRef.current)
          collapseTimeoutRef.current = null
        }

        const agentKey = result.agentType as keyof typeof AGENT_TYPE_MAP
        const mapped = AGENT_TYPE_MAP[agentKey] as AgentStatus['agentType']

        setStatus((prev) => ({
          ...prev,
          isActive: true,
          agentType: mapped,
        }))

        // Start the status-line file watcher (only once).
        // The path is derived server-side from the PTY session's CWD —
        // the frontend only sends the session ID (prevents path traversal).
        if (!watcherStartedRef.current) {
          try {
            await invoke('start_agent_watcher', {
              sessionId: ptySessionId,
            })
            watcherStartedRef.current = true
          } catch {
            // Watcher may fail if bridge files weren't generated — retry next poll
          }
        }
      } else {
        // Agent exited — stop watchers if they were running.
        if (!watcherStartedRef.current) {
          return
        }
        watcherStartedRef.current = false
        void stopWatchers(sid)

        // Hold final state for 5s, then collapse.
        // Store the timeout ID so it can be cancelled if the agent restarts.
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

    // Run immediately on mount
    void handleDetection(sessionId)

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
      // Only agent-status and agent-tool-call are event-driven.

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
                }
              : prev.contextWindow,
            cost: p.cost
              ? {
                  totalCostUsd: p.cost.totalCostUsd,
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
                active: { tool: p.tool, args: p.args },
              },
            }))
          } else {
            // done or failed
            const recentCall: RecentToolCall = {
              id: `${p.tool}-${p.timestamp}`,
              tool: p.tool,
              args: p.args,
              status: p.status,
              durationMs: Number(p.durationMs) || null,
              timestamp: p.timestamp,
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
  useEffect(
    () => (): void => {
      const sid = prevSessionIdRef.current
      if (sid) {
        void stopWatchers(sid)
      }
    },
    []
  )

  return status
}
