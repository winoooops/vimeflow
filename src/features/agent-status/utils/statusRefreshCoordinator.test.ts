import { describe, expect, test, vi } from 'vitest'
import type { AgentDetectedEvent, AgentStatus } from '../types'
import { createDefaultAgentStatus } from './agentStatusModel'
import {
  createAgentStatusRefreshCoordinator,
  MAX_VISIBLE_STATUS_REFRESH_PANES,
  planVisibleStatusRefreshes,
} from './statusRefreshCoordinator'

const createDetectedEvent = (
  ptyId: string,
  agentType: AgentDetectedEvent['agentType'] = 'claudeCode'
): AgentDetectedEvent => ({
  sessionId: ptyId,
  agentType,
  pid: 123,
})

const createDeferred = <Value>(): {
  promise: Promise<Value>
  resolve: (value: Value) => void
} => {
  let resolvePromise: ((value: Value) => void) | undefined

  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve: (value): void => {
      resolvePromise?.(value)
    },
  }
}

describe('statusRefreshCoordinator', () => {
  test('plans the active pane before visible sibling prefetch', () => {
    expect(
      planVisibleStatusRefreshes({
        activePtyId: 'pty-b',
        visiblePtyIds: ['pty-a', 'pty-b', 'pty-c'],
      })
    ).toEqual(['pty-b', 'pty-a', 'pty-c'])
  })

  test('deduplicates visible panes and applies the explicit pane limit', () => {
    expect(
      planVisibleStatusRefreshes({
        activePtyId: 'pty-3',
        visiblePtyIds: ['pty-1', 'pty-2', 'pty-2', 'pty-3', 'pty-4', 'pty-5'],
      })
    ).toEqual(['pty-3', 'pty-1', 'pty-2', 'pty-4'])

    expect(MAX_VISIBLE_STATUS_REFRESH_PANES).toBe(4)
  })

  test('prefetches visible siblings once and leaves hidden panes untouched', async () => {
    const detectAgent = vi.fn((ptyId: string) =>
      Promise.resolve(createDetectedEvent(ptyId))
    )

    const writeStatus = vi.fn((_ptyId: string, status: AgentStatus) => ({
      status,
      scrollTop: 0,
      updatedAt: 100,
    }))

    const coordinator = createAgentStatusRefreshCoordinator({
      detectAgent,
      writeStatus,
    })

    await coordinator.refreshVisiblePanes({
      activePtyId: 'pty-active',
      visiblePtyIds: ['pty-active', 'pty-sibling', 'pty-sibling'],
    })

    expect(detectAgent).toHaveBeenCalledTimes(2)
    expect(detectAgent).toHaveBeenNthCalledWith(1, 'pty-active')
    expect(detectAgent).toHaveBeenNthCalledWith(2, 'pty-sibling')
    expect(detectAgent).not.toHaveBeenCalledWith('pty-hidden')
    expect(writeStatus).toHaveBeenCalledTimes(2)
  })

  test('coalesces duplicate requests for the same pane while in flight', async () => {
    const deferred = createDeferred<AgentDetectedEvent | null>()
    const detectAgent = vi.fn(() => deferred.promise)
    const coordinator = createAgentStatusRefreshCoordinator({ detectAgent })

    void coordinator.refreshVisiblePanes({
      activePtyId: 'pty-a',
      visiblePtyIds: ['pty-a'],
    })

    const first = coordinator.refreshPane('pty-a')
    const second = coordinator.refreshPane('pty-a')

    expect(first).toBe(second)
    expect(detectAgent).toHaveBeenCalledTimes(1)

    deferred.resolve(createDetectedEvent('pty-a'))

    await expect(first).resolves.toMatchObject({
      sessionId: 'pty-a',
      agentType: 'claude-code',
      isActive: true,
    })
  })

  test('drops stale responses for panes outside the current visible set', async () => {
    const requests = new Map<
      string,
      ReturnType<typeof createDeferred<AgentDetectedEvent | null>>
    >()
    const writes: string[] = []

    const coordinator = createAgentStatusRefreshCoordinator({
      detectAgent: (ptyId) => {
        const deferred = createDeferred<AgentDetectedEvent | null>()
        requests.set(ptyId, deferred)

        return deferred.promise
      },
      writeStatus: (ptyId, status) => {
        writes.push(ptyId)

        return {
          status,
          scrollTop: 0,
          updatedAt: writes.length,
        }
      },
    })

    const oldRefresh = coordinator.refreshVisiblePanes({
      activePtyId: 'pty-old',
      visiblePtyIds: ['pty-old'],
    })

    const currentRefresh = coordinator.refreshVisiblePanes({
      activePtyId: 'pty-current',
      visiblePtyIds: ['pty-current'],
    })

    requests.get('pty-current')?.resolve(createDetectedEvent('pty-current'))
    requests.get('pty-old')?.resolve(createDetectedEvent('pty-old'))

    await Promise.all([oldRefresh, currentRefresh])

    expect(writes).toEqual(['pty-current'])
  })

  test('preserves rich snapshot fields when detection warms an existing pane', async () => {
    const richStatus: AgentStatus = {
      ...createDefaultAgentStatus('pty-a'),
      contextWindow: {
        usedPercentage: 42,
        contextWindowSize: 200000,
        totalInputTokens: 1000,
        totalOutputTokens: 200,
        currentUsage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheCreationInputTokens: 4,
          cacheReadInputTokens: 80,
        },
      },
      toolCalls: { total: 7, byType: { Read: 7 }, active: null },
    }

    let storedStatus = richStatus

    const coordinator = createAgentStatusRefreshCoordinator({
      detectAgent: () => Promise.resolve(createDetectedEvent('pty-a', 'codex')),
      readStatus: () => storedStatus,
      writeStatus: (_ptyId, status) => {
        storedStatus = status

        return {
          status,
          scrollTop: 0,
          updatedAt: 1,
        }
      },
    })

    await coordinator.refreshVisiblePanes({
      activePtyId: 'pty-a',
      visiblePtyIds: ['pty-a'],
    })

    expect(storedStatus).toMatchObject({
      sessionId: 'pty-a',
      agentType: 'codex',
      isActive: true,
      contextWindow: richStatus.contextWindow,
      toolCalls: richStatus.toolCalls,
    })
  })

  test('does not preserve stale active tool calls when detection warms a pane', async () => {
    const staleRunningStatus: AgentStatus = {
      ...createDefaultAgentStatus('pty-a'),
      toolCalls: {
        total: 12,
        byType: { exec_command: 12 },
        active: {
          tool: 'exec_command',
          args: 'nl -ba scripts/qa-runner/lib/worker-instance.mjs',
          startedAt: '2026-06-15T19:50:00Z',
          toolUseId: 'call-stale',
        },
      },
    }

    let storedStatus = staleRunningStatus

    const coordinator = createAgentStatusRefreshCoordinator({
      detectAgent: () => Promise.resolve(createDetectedEvent('pty-a', 'codex')),
      readStatus: () => storedStatus,
      writeStatus: (_ptyId, status) => {
        storedStatus = status

        return {
          status,
          scrollTop: 0,
          updatedAt: 1,
        }
      },
    })

    await coordinator.refreshVisiblePanes({
      activePtyId: 'pty-a',
      visiblePtyIds: ['pty-a'],
    })

    expect(storedStatus.toolCalls).toEqual({
      total: 12,
      byType: { exec_command: 12 },
      active: null,
    })
  })

  test('writes a default snapshot when detection returns null for a previously active pane', async () => {
    const previousStatus: AgentStatus = {
      ...createDefaultAgentStatus('pty-a'),
      isActive: true,
      agentType: 'claude-code',
    }

    const writeStatus = vi.fn((_ptyId: string, status: AgentStatus) => ({
      status,
      scrollTop: 0,
      updatedAt: 1,
    }))

    const coordinator = createAgentStatusRefreshCoordinator({
      detectAgent: () => Promise.resolve(null),
      readStatus: () => previousStatus,
      writeStatus,
    })

    await coordinator.refreshVisiblePanes({
      activePtyId: 'pty-a',
      visiblePtyIds: ['pty-a'],
    })

    expect(writeStatus).toHaveBeenCalledTimes(1)
    expect(writeStatus).toHaveBeenCalledWith(
      'pty-a',
      expect.objectContaining({
        sessionId: 'pty-a',
        isActive: false,
        agentType: null,
      })
    )
  })
})
