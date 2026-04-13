import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  AgentDetectedEvent,
  AgentDisconnectedEvent,
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
const stopWatchers = async (sessionId: string): Promise<void> => {
  try {
    await invoke('stop_agent_watcher', { sessionId })
  } catch {
    // Watcher may not be running — ignore
  }
  try {
    await invoke('stop_transcript_watcher', { sessionId })
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
      setStatus(createDefaultStatus(sessionId))
    }
  }, [sessionId])

  // Detection polling: poll detect_agent_in_session every 2s.
  // On detection, update state. On agent exit, stop watchers and
  // hold final state for 5s before collapsing.
  const handleDetection = useCallback(async (sid: string): Promise<void> => {
    try {
      const result = await invoke<AgentDetectedEvent | null>(
        'detect_agent_in_session',
        { sessionId: sid }
      )

      if (result && !watcherStartedRef.current) {
        watcherStartedRef.current = true

        const agentKey = result.agentType as keyof typeof AGENT_TYPE_MAP

        const mapped = AGENT_TYPE_MAP[agentKey] as AgentStatus['agentType']

        setStatus((prev) => ({
          ...prev,
          isActive: true,
          agentType: mapped,
        }))
      } else if (!result && watcherStartedRef.current) {
        // Agent exited — stop watchers
        watcherStartedRef.current = false
        void stopWatchers(sid)

        // Hold final state for 5s, then collapse
        setTimeout(() => {
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

  // Event subscriptions for status updates, tool calls, and disconnects
  useEffect(() => {
    if (!sessionId) {
      return
    }

    // Track unlisten functions. Because listen() is async, cleanup may
    // run before all promises resolve. We collect them in a ref-like
    // mutable array and also track a `cancelled` flag so late-resolving
    // subscriptions still get cleaned up immediately.
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
      const unlistenDetected = await listen<AgentDetectedEvent>(
        'agent-detected',
        (event) => {
          if (event.payload.sessionId !== sessionId) {
            return
          }

          setStatus((prev) => ({
            ...prev,
            isActive: true,
            agentType: AGENT_TYPE_MAP[event.payload.agentType],
          }))
        }
      )

      addUnlisten(unlistenDetected)

      const unlistenStatus = await listen<AgentStatusEvent>(
        'agent-status',
        (event) => {
          if (event.payload.sessionId !== sessionId) {
            return
          }

          const p = event.payload

          setStatus((prev) => ({
            ...prev,
            modelId: p.modelId,
            modelDisplayName: p.modelDisplayName,
            version: p.version,
            agentSessionId: p.agentSessionId,
            contextWindow: {
              usedPercentage: p.contextWindow.usedPercentage ?? 0,
              contextWindowSize: Number(p.contextWindow.contextWindowSize),
              totalInputTokens: Number(p.contextWindow.totalInputTokens),
              totalOutputTokens: Number(p.contextWindow.totalOutputTokens),
            },
            cost: {
              totalCostUsd: p.cost.totalCostUsd,
              totalDurationMs: Number(p.cost.totalDurationMs),
              totalApiDurationMs: Number(p.cost.totalApiDurationMs),
              totalLinesAdded: Number(p.cost.totalLinesAdded),
              totalLinesRemoved: Number(p.cost.totalLinesRemoved),
            },
            rateLimits: {
              fiveHour: {
                usedPercentage: p.rateLimits.fiveHour.usedPercentage,
                resetsAt: Date.parse(p.rateLimits.fiveHour.resetsAt),
              },
              ...(p.rateLimits.sevenDay
                ? {
                    sevenDay: {
                      usedPercentage: p.rateLimits.sevenDay.usedPercentage,
                      resetsAt: Date.parse(p.rateLimits.sevenDay.resetsAt),
                    },
                  }
                : {}),
            },
          }))
        }
      )

      addUnlisten(unlistenStatus)

      const unlistenToolCall = await listen<AgentToolCallEvent>(
        'agent-tool-call',
        (event) => {
          if (event.payload.sessionId !== sessionId) {
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
              durationMs: Number(p.durationMs),
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

      const unlistenDisconnected = await listen<AgentDisconnectedEvent>(
        'agent-disconnected',
        (event) => {
          if (event.payload.sessionId !== sessionId) {
            return
          }

          setStatus((prev) => ({
            ...prev,
            isActive: false,
          }))
        }
      )

      addUnlisten(unlistenDisconnected)
    }

    void subscribe()

    return (): void => {
      cancelled = true

      for (const unlisten of unlistenFns) {
        unlisten()
      }
    }
  }, [sessionId])

  // Cleanup watchers when the hook unmounts entirely
  useEffect(
    () => (): void => {
      if (sessionId) {
        void stopWatchers(sessionId)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only run on unmount
    []
  )

  return status
}
