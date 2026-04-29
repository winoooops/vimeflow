import { describe, test, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useActivityEvents } from './useActivityEvents'
import type { AgentStatus } from '../types'

const baseStatus: AgentStatus = {
  isActive: true,
  agentType: 'claude-code',
  modelId: null,
  modelDisplayName: null,
  version: null,
  sessionId: 'session-1',
  agentSessionId: null,
  contextWindow: null,
  cost: null,
  rateLimits: null,
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
  testRun: null,
}

describe('useActivityEvents', () => {
  test('returns empty array when there are no tool calls', () => {
    const { result } = renderHook(() => useActivityEvents(baseStatus))

    expect(result.current).toEqual([])
  })

  test('returns the same array reference when the status is unchanged', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: AgentStatus }) => useActivityEvents(status),
      { initialProps: { status: baseStatus } }
    )
    const first = result.current

    rerender({ status: baseStatus })

    expect(result.current).toBe(first)
  })

  test('returns the same array reference when only unrelated slices change', () => {
    const s1: AgentStatus = { ...baseStatus, cost: null }

    const s2: AgentStatus = {
      ...baseStatus,
      cost: {
        totalCostUsd: 1,
        totalDurationMs: 0,
        totalApiDurationMs: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
      },
    }

    const { result, rerender } = renderHook(
      ({ status }: { status: AgentStatus }) => useActivityEvents(status),
      { initialProps: { status: s1 } }
    )
    const first = result.current

    rerender({ status: s2 })

    expect(result.current).toBe(first)
  })

  test('returns a new array reference when active changes', () => {
    const s2: AgentStatus = {
      ...baseStatus,
      toolCalls: {
        total: 0,
        byType: {},
        active: {
          tool: 'Edit',
          args: 'src/foo.ts',
          startedAt: '2026-04-22T10:00:00Z',
          toolUseId: 'toolu_active',
        },
      },
    }

    const { result, rerender } = renderHook(
      ({ status }: { status: AgentStatus }) => useActivityEvents(status),
      { initialProps: { status: baseStatus } }
    )
    const first = result.current

    rerender({ status: s2 })

    expect(result.current).not.toBe(first)
    expect(result.current).toHaveLength(1)
  })
})
