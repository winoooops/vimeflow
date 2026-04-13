import { useEffect, useRef, useState } from 'react'
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

export const useAgentStatus = (sessionId: string | null): AgentStatus => {
  const [status, setStatus] = useState<AgentStatus>(() =>
    createDefaultStatus(sessionId)
  )
  const prevSessionIdRef = useRef<string | null>(sessionId)

  // Reset state when sessionId changes
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId
      setStatus(createDefaultStatus(sessionId))
    }
  }, [sessionId])

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

  return status
}
