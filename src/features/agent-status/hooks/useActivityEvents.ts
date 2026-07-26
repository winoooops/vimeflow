import { useMemo } from 'react'
import { toolCallsToEvents } from '../utils/toolCallsToEvents'
import type { AgentStatus } from '../types'
import type { ActivityEvent } from '../types/activityEvent'

export const useActivityEvents = (status: AgentStatus): ActivityEvent[] =>
  useMemo(
    () =>
      toolCallsToEvents(
        status.agentType,
        status.toolCalls.active,
        status.recentToolCalls
      ),
    [status.agentType, status.toolCalls.active, status.recentToolCalls]
  )
