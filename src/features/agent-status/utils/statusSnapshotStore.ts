import type {
  ActiveToolCall,
  AgentStatus,
  RecentToolCall,
  ToolCallState,
} from '../types'

export interface AgentStatusSnapshot {
  status: AgentStatus
  scrollTop: number
  updatedAt: number
}

export interface AgentStatusSnapshotStore {
  readSnapshot: (key: string) => AgentStatusSnapshot | null
  readStatus: (key: string) => AgentStatus | null
  writeStatus: (key: string, status: AgentStatus) => AgentStatusSnapshot
  readSeenToolUseIds: (key: string) => Set<string>
  writeSeenToolUseIds: (key: string, toolUseIds: Iterable<string>) => void
  readScrollAnchor: (key: string) => number
  writeScrollAnchor: (key: string, scrollTop: number) => void
  deleteSnapshot: (key: string) => void
  clear: () => void
}

export const MAX_STATUS_SNAPSHOT_ENTRIES = 64

const recordsEqual = (
  left: Record<string, number>,
  right: Record<string, number>
): boolean => {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)

  if (leftKeys.length !== rightKeys.length) {
    return false
  }

  return leftKeys.every((key) => left[key] === right[key])
}

const activeToolCallsEqual = (
  left: ActiveToolCall | null,
  right: ActiveToolCall | null
): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.tool === right.tool &&
    left.args === right.args &&
    left.startedAt === right.startedAt &&
    left.toolUseId === right.toolUseId)

const recentToolCallsEqual = (
  left: RecentToolCall,
  right: RecentToolCall
): boolean =>
  left.id === right.id &&
  left.tool === right.tool &&
  left.args === right.args &&
  left.status === right.status &&
  left.durationMs === right.durationMs &&
  left.timestamp === right.timestamp &&
  left.isTestFile === right.isTestFile

const mergeRecentToolCalls = (
  previous: RecentToolCall[],
  next: RecentToolCall[]
): RecentToolCall[] => {
  const previousById = new Map(previous.map((call) => [call.id, call]))
  let changed = previous.length !== next.length

  const merged = next.map((nextCall, index) => {
    const previousCall = previousById.get(nextCall.id)

    if (
      previousCall !== undefined &&
      recentToolCallsEqual(previousCall, nextCall)
    ) {
      if (previous[index] !== previousCall) {
        changed = true
      }

      return previousCall
    }

    changed = true

    return nextCall
  })

  return changed ? merged : previous
}

const mergeToolCalls = (
  previous: ToolCallState,
  next: ToolCallState
): ToolCallState => {
  const byType = recordsEqual(previous.byType, next.byType)
    ? previous.byType
    : next.byType

  const active = activeToolCallsEqual(previous.active, next.active)
    ? previous.active
    : next.active

  if (
    previous.total === next.total &&
    previous.byType === byType &&
    previous.active === active
  ) {
    return previous
  }

  return {
    total: next.total,
    byType,
    active,
  }
}

const stripActiveToolCall = (status: AgentStatus): AgentStatus => {
  if (status.toolCalls.active === null) {
    return status
  }

  return {
    ...status,
    toolCalls: {
      ...status.toolCalls,
      active: null,
    },
  }
}

export const mergeAgentStatusSnapshot = (
  previous: AgentStatus,
  next: AgentStatus
): AgentStatus => {
  const toolCalls = mergeToolCalls(previous.toolCalls, next.toolCalls)

  const recentToolCalls = mergeRecentToolCalls(
    previous.recentToolCalls,
    next.recentToolCalls
  )

  if (
    previous === next ||
    (previous.toolCalls === toolCalls &&
      previous.recentToolCalls === recentToolCalls &&
      previous.isActive === next.isActive &&
      previous.agentExited === next.agentExited &&
      previous.agentType === next.agentType &&
      previous.modelId === next.modelId &&
      previous.modelDisplayName === next.modelDisplayName &&
      previous.version === next.version &&
      previous.sessionId === next.sessionId &&
      previous.agentSessionId === next.agentSessionId &&
      previous.cwd === next.cwd &&
      previous.contextWindow === next.contextWindow &&
      previous.cost === next.cost &&
      previous.rateLimits === next.rateLimits &&
      previous.numTurns === next.numTurns &&
      previous.testRun === next.testRun)
  ) {
    return previous
  }

  return {
    ...next,
    toolCalls,
    recentToolCalls,
  }
}

const normalizeScrollTop = (scrollTop: number): number =>
  Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0

const deleteOldestEntry = <Value>(
  entries: Map<string, Value>
): string | null => {
  const oldestKey = entries.keys().next().value

  if (oldestKey === undefined) {
    return null
  }

  entries.delete(oldestKey)

  return oldestKey
}

export const createAgentStatusSnapshotStore = (
  now: () => number = () => Date.now()
): AgentStatusSnapshotStore => {
  const statuses = new Map<string, { status: AgentStatus; updatedAt: number }>()
  const seenToolUseIds = new Map<string, Set<string>>()
  const scrollAnchors = new Map<string, number>()

  const pruneStatusSnapshots = (): void => {
    while (statuses.size > MAX_STATUS_SNAPSHOT_ENTRIES) {
      const deletedKey = deleteOldestEntry(statuses)

      if (deletedKey === null) {
        return
      }

      seenToolUseIds.delete(deletedKey)
      scrollAnchors.delete(deletedKey)
    }
  }

  const pruneScrollAnchors = (): void => {
    while (scrollAnchors.size > MAX_STATUS_SNAPSHOT_ENTRIES) {
      deleteOldestEntry(scrollAnchors)
    }
  }

  const pruneSeenToolUseIds = (): void => {
    while (seenToolUseIds.size > MAX_STATUS_SNAPSHOT_ENTRIES) {
      deleteOldestEntry(seenToolUseIds)
    }
  }

  const readSnapshot = (key: string): AgentStatusSnapshot | null => {
    const entry = statuses.get(key)

    if (entry === undefined) {
      return null
    }

    return {
      status: stripActiveToolCall(entry.status),
      scrollTop: scrollAnchors.get(key) ?? 0,
      updatedAt: entry.updatedAt,
    }
  }

  const writeStatus = (
    key: string,
    status: AgentStatus
  ): AgentStatusSnapshot => {
    const previous = statuses.get(key)

    const nextSnapshotStatus = stripActiveToolCall(status)

    const previousSnapshotStatus =
      previous === undefined ? undefined : stripActiveToolCall(previous.status)

    const nextStatus =
      previousSnapshotStatus === undefined
        ? nextSnapshotStatus
        : mergeAgentStatusSnapshot(previousSnapshotStatus, nextSnapshotStatus)

    const updatedAt = now()

    statuses.delete(key)
    statuses.set(key, {
      status: nextStatus,
      updatedAt,
    })

    if (!seenToolUseIds.has(key)) {
      seenToolUseIds.set(
        key,
        new Set(nextStatus.recentToolCalls.map((call) => call.id))
      )
    }

    pruneStatusSnapshots()

    return {
      status: nextStatus,
      scrollTop: scrollAnchors.get(key) ?? 0,
      updatedAt,
    }
  }

  const readStatus = (key: string): AgentStatus | null =>
    readSnapshot(key)?.status ?? null

  const readSeenToolUseIds = (key: string): Set<string> =>
    new Set(seenToolUseIds.get(key) ?? [])

  const writeSeenToolUseIds = (
    key: string,
    toolUseIds: Iterable<string>
  ): void => {
    seenToolUseIds.delete(key)
    seenToolUseIds.set(key, new Set(toolUseIds))
    pruneSeenToolUseIds()
  }

  const readScrollAnchor = (key: string): number => scrollAnchors.get(key) ?? 0

  const writeScrollAnchor = (key: string, scrollTop: number): void => {
    scrollAnchors.delete(key)
    scrollAnchors.set(key, normalizeScrollTop(scrollTop))
    pruneScrollAnchors()
  }

  const deleteSnapshot = (key: string): void => {
    statuses.delete(key)
    seenToolUseIds.delete(key)
    scrollAnchors.delete(key)
  }

  const clear = (): void => {
    statuses.clear()
    seenToolUseIds.clear()
    scrollAnchors.clear()
  }

  return {
    readSnapshot,
    readStatus,
    writeStatus,
    readSeenToolUseIds,
    writeSeenToolUseIds,
    readScrollAnchor,
    writeScrollAnchor,
    deleteSnapshot,
    clear,
  }
}

const statusSnapshotStore = createAgentStatusSnapshotStore()

export const readStatusSnapshot = (key: string): AgentStatus | null =>
  statusSnapshotStore.readStatus(key)

export const writeStatusSnapshot = (
  key: string,
  status: AgentStatus
): AgentStatusSnapshot => statusSnapshotStore.writeStatus(key, status)

export const readStatusSeenToolUseIds = (key: string): Set<string> =>
  statusSnapshotStore.readSeenToolUseIds(key)

export const writeStatusSeenToolUseIds = (
  key: string,
  toolUseIds: Iterable<string>
): void => {
  statusSnapshotStore.writeSeenToolUseIds(key, toolUseIds)
}

export const readStatusScrollAnchor = (key: string): number =>
  statusSnapshotStore.readScrollAnchor(key)

export const writeStatusScrollAnchor = (
  key: string,
  scrollTop: number
): void => {
  statusSnapshotStore.writeScrollAnchor(key, scrollTop)
}

export const clearStatusSnapshots = (): void => {
  statusSnapshotStore.clear()
}
