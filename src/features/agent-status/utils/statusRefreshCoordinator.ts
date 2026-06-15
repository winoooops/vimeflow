import { invoke } from '../../../lib/backend'
import type { AgentDetectedEvent, AgentStatus } from '../types'
import {
  createDefaultAgentStatus,
  mapDetectedAgentType,
} from './agentStatusModel'
import {
  readStatusSnapshot,
  writeStatusSnapshot,
  type AgentStatusSnapshot,
} from './statusSnapshotStore'

export const MAX_VISIBLE_STATUS_REFRESH_PANES = 4

export interface VisibleStatusRefreshRequest {
  activePtyId: string | null
  visiblePtyIds: readonly string[]
}

export interface AgentStatusRefreshCoordinator {
  refreshPane: (ptyId: string) => Promise<AgentStatus | null>
  refreshVisiblePanes: (
    request: VisibleStatusRefreshRequest
  ) => Promise<AgentStatus[]>
  clear: () => void
}

interface AgentStatusRefreshCoordinatorDeps {
  detectAgent?: (ptyId: string) => Promise<AgentDetectedEvent | null>
  readStatus?: (ptyId: string) => AgentStatus | null
  writeStatus?: (ptyId: string, status: AgentStatus) => AgentStatusSnapshot
}

const defaultDetectAgent = async (
  ptyId: string
): Promise<AgentDetectedEvent | null> =>
  invoke<AgentDetectedEvent | null>('detect_agent_in_session', {
    sessionId: ptyId,
  })

const normalizePtyId = (ptyId: string | null | undefined): string | null => {
  if (ptyId === undefined || ptyId === null || ptyId.length === 0) {
    return null
  }

  return ptyId
}

export const planVisibleStatusRefreshes = ({
  activePtyId,
  visiblePtyIds,
}: VisibleStatusRefreshRequest): string[] => {
  const uniqueVisible = new Set<string>()

  for (const ptyId of visiblePtyIds) {
    const normalized = normalizePtyId(ptyId)

    if (normalized !== null) {
      uniqueVisible.add(normalized)
    }
  }

  const normalizedActive = normalizePtyId(activePtyId)
  const ordered: string[] = []

  if (normalizedActive !== null && uniqueVisible.has(normalizedActive)) {
    ordered.push(normalizedActive)
  }

  for (const ptyId of uniqueVisible) {
    if (ptyId !== normalizedActive) {
      ordered.push(ptyId)
    }
  }

  return ordered.slice(0, MAX_VISIBLE_STATUS_REFRESH_PANES)
}

const mergeDetectedAgent = (
  ptyId: string,
  detected: AgentDetectedEvent,
  previous: AgentStatus | null
): AgentStatus => ({
  ...(previous ?? createDefaultAgentStatus(ptyId)),
  sessionId: ptyId,
  isActive: true,
  agentExited: false,
  agentType: mapDetectedAgentType(detected.agentType as string),
})

export const createAgentStatusRefreshCoordinator = ({
  detectAgent = defaultDetectAgent,
  readStatus = readStatusSnapshot,
  writeStatus = writeStatusSnapshot,
}: AgentStatusRefreshCoordinatorDeps = {}): AgentStatusRefreshCoordinator => {
  const inFlight = new Map<string, Promise<AgentStatus | null>>()
  let visiblePtyIds: Set<string> | null = null

  const runRefresh = async (ptyId: string): Promise<AgentStatus | null> => {
    try {
      const detected = await detectAgent(ptyId)

      if (visiblePtyIds !== null && !visiblePtyIds.has(ptyId)) {
        return null
      }

      const previous = readStatus(ptyId)

      if (detected === null) {
        if (previous !== null) {
          return previous
        }

        return writeStatus(ptyId, createDefaultAgentStatus(ptyId)).status
      }

      return writeStatus(ptyId, mergeDetectedAgent(ptyId, detected, previous))
        .status
    } catch {
      return null
    }
  }

  const clearInFlightAfter = async (
    ptyId: string,
    request: Promise<AgentStatus | null>
  ): Promise<void> => {
    await request

    if (inFlight.get(ptyId) === request) {
      inFlight.delete(ptyId)
    }
  }

  const refreshPane = (ptyId: string): Promise<AgentStatus | null> => {
    const existing = inFlight.get(ptyId)

    if (existing !== undefined) {
      return existing
    }

    const request = runRefresh(ptyId)

    inFlight.set(ptyId, request)
    void clearInFlightAfter(ptyId, request)

    return request
  }

  const refreshVisiblePanes = async (
    request: VisibleStatusRefreshRequest
  ): Promise<AgentStatus[]> => {
    const plannedPtyIds = planVisibleStatusRefreshes(request)
    visiblePtyIds = new Set(plannedPtyIds)

    const results = await Promise.all(plannedPtyIds.map(refreshPane))

    return results.filter((status): status is AgentStatus => status !== null)
  }

  const clear = (): void => {
    visiblePtyIds = new Set()
    inFlight.clear()
  }

  return {
    refreshPane,
    refreshVisiblePanes,
    clear,
  }
}

const agentStatusRefreshCoordinator = createAgentStatusRefreshCoordinator()

export const refreshVisibleAgentStatusPanes = (
  request: VisibleStatusRefreshRequest
): Promise<AgentStatus[]> =>
  agentStatusRefreshCoordinator.refreshVisiblePanes(request)

export const clearAgentStatusRefreshCoordinator = (): void => {
  agentStatusRefreshCoordinator.clear()
}
