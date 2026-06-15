import { describe, expect, test } from 'vitest'
import type { AgentStatus } from '../types'
import {
  createAgentStatusSnapshotStore,
  MAX_STATUS_SNAPSHOT_ENTRIES,
  mergeAgentStatusSnapshot,
} from './statusSnapshotStore'

const createStatus = (overrides: Partial<AgentStatus> = {}): AgentStatus => ({
  isActive: false,
  agentExited: false,
  agentType: null,
  modelId: null,
  modelDisplayName: null,
  version: null,
  sessionId: 'pty-a',
  agentSessionId: null,
  cwd: null,
  contextWindow: null,
  cost: null,
  rateLimits: null,
  numTurns: 0,
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
  testRun: null,
  ...overrides,
})

describe('statusSnapshotStore', () => {
  test('stores and reads status snapshots by pane key', () => {
    let timestamp = 100
    const store = createAgentStatusSnapshotStore(() => timestamp)
    const status = createStatus({ modelId: 'claude-sonnet-4-5' })

    expect(store.readStatus('pane-a')).toBeNull()

    const snapshot = store.writeStatus('pane-a', status)

    expect(snapshot).toEqual({
      status,
      scrollTop: 0,
      updatedAt: 100,
    })
    expect(store.readStatus('pane-a')).toBe(status)

    timestamp = 125
    const nextStatus = createStatus({ modelId: 'claude-opus-4-7' })
    store.writeStatus('pane-b', nextStatus)

    expect(store.readStatus('pane-a')).toBe(status)
    expect(store.readSnapshot('pane-b')?.updatedAt).toBe(125)
  })

  test('stores scroll anchors independently from status snapshots', () => {
    const store = createAgentStatusSnapshotStore(() => 100)

    expect(store.readScrollAnchor('pane-a')).toBe(0)

    store.writeScrollAnchor('pane-a', 220.5)
    store.writeScrollAnchor('pane-b', -10)

    expect(store.readScrollAnchor('pane-a')).toBe(220.5)
    expect(store.readScrollAnchor('pane-b')).toBe(0)
    expect(store.readSnapshot('pane-a')).toBeNull()
  })

  test('stores seen tool ids independently from the visible recent-call buffer', () => {
    const store = createAgentStatusSnapshotStore(() => 100)

    store.writeSeenToolUseIds('pane-a', ['toolu_1', 'toolu_2'])

    const seen = store.readSeenToolUseIds('pane-a')
    seen.add('mutated-copy')

    expect(store.readSeenToolUseIds('pane-a')).toEqual(
      new Set(['toolu_1', 'toolu_2'])
    )
  })

  test('preserves unchanged recent tool-call object identity while merging', () => {
    const existingCall = {
      id: 'toolu_1',
      tool: 'Read',
      args: '{"file":"a.ts"}',
      status: 'done' as const,
      durationMs: 10,
      timestamp: '2026-06-14T00:00:00Z',
      isTestFile: false,
    }

    const previous = createStatus({
      toolCalls: { total: 1, byType: { Read: 1 }, active: null },
      recentToolCalls: [existingCall],
    })

    const next = createStatus({
      toolCalls: { total: 1, byType: { Read: 1 }, active: null },
      recentToolCalls: [{ ...existingCall }],
    })

    const merged = mergeAgentStatusSnapshot(previous, next)

    expect(merged.toolCalls).toBe(previous.toolCalls)
    expect(merged.recentToolCalls).toBe(previous.recentToolCalls)
    expect(merged.recentToolCalls[0]).toBe(existingCall)
  })

  test('keeps unchanged row objects when a newer tool call is prepended', () => {
    const existingCall = {
      id: 'toolu_1',
      tool: 'Read',
      args: '{"file":"a.ts"}',
      status: 'done' as const,
      durationMs: 10,
      timestamp: '2026-06-14T00:00:00Z',
      isTestFile: false,
    }

    const newCall = {
      id: 'toolu_2',
      tool: 'Edit',
      args: '{"file":"b.ts"}',
      status: 'done' as const,
      durationMs: 30,
      timestamp: '2026-06-14T00:00:01Z',
      isTestFile: false,
    }

    const previous = createStatus({ recentToolCalls: [existingCall] })

    const next = createStatus({
      recentToolCalls: [newCall, { ...existingCall }],
    })

    const merged = mergeAgentStatusSnapshot(previous, next)

    expect(merged.recentToolCalls).not.toBe(previous.recentToolCalls)
    expect(merged.recentToolCalls[0]).toBe(newCall)
    expect(merged.recentToolCalls[1]).toBe(existingCall)
  })

  test('bounds stored pane snapshots and evicts the oldest entries', () => {
    const store = createAgentStatusSnapshotStore(() => 100)

    for (let index = 0; index <= MAX_STATUS_SNAPSHOT_ENTRIES; index += 1) {
      const key = `pane-${index}`

      store.writeStatus(key, createStatus({ sessionId: key }))
      store.writeScrollAnchor(key, index + 100)
      store.writeSeenToolUseIds(key, [`toolu_${index}`])
    }

    expect(store.readStatus('pane-0')).toBeNull()
    expect(store.readScrollAnchor('pane-0')).toBe(0)
    expect(store.readSeenToolUseIds('pane-0')).toEqual(new Set())
    expect(store.readStatus('pane-1')?.sessionId).toBe('pane-1')
    expect(store.readScrollAnchor('pane-1')).toBe(101)
    expect(store.readSeenToolUseIds('pane-1')).toEqual(new Set(['toolu_1']))
  })
})
