import { describe, test, expect } from 'vitest'
import { toolCallsToEvents } from './toolCallsToEvents'
import type { ActiveToolCall, RecentToolCall } from '../types'

const recent = (overrides: Partial<RecentToolCall> = {}): RecentToolCall => ({
  id: 'r-1',
  tool: 'Read',
  args: 'src/foo.ts',
  status: 'done',
  durationMs: 100,
  timestamp: '2026-04-22T10:00:00Z',
  isTestFile: false,
  ...overrides,
})

describe('toolCallsToEvents', () => {
  test('null active + empty recent → empty array', () => {
    expect(toolCallsToEvents(null, [])).toEqual([])
  })

  test('active only → one running event with startedAt as timestamp and toolUseId as id', () => {
    const active: ActiveToolCall = {
      tool: 'Edit',
      args: 'src/foo.ts',
      startedAt: '2026-04-22T10:30:00Z',
      toolUseId: 'toolu_ACTIVE',
    }
    const events = toolCallsToEvents(active, [])

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      id: 'toolu_ACTIVE',
      kind: 'edit',
      tool: 'Edit',
      body: 'src/foo.ts',
      status: 'running',
      timestamp: '2026-04-22T10:30:00Z',
      durationMs: null,
    })
  })

  test('recent events are sorted by timestamp descending regardless of input order', () => {
    const events = toolCallsToEvents(null, [
      recent({
        id: 'old',
        tool: 'Bash',
        args: 'ls',
        timestamp: '2026-04-22T10:00:00Z',
      }),
      recent({
        id: 'newest',
        tool: 'Read',
        args: 'x.ts',
        timestamp: '2026-04-22T12:00:00Z',
      }),
      recent({
        id: 'middle',
        tool: 'Edit',
        args: 'y.ts',
        timestamp: '2026-04-22T11:00:00Z',
      }),
    ])

    expect(events.map((e) => e.id)).toEqual(['newest', 'middle', 'old'])
  })

  test('active is always first, even when a recent event has a newer timestamp', () => {
    const events = toolCallsToEvents(
      {
        tool: 'Edit',
        args: 'src/foo.ts',
        // Deliberately older than the recent event below.
        startedAt: '2026-04-22T10:00:00Z',
        toolUseId: 'toolu_ACTIVE',
      },
      [
        recent({
          id: 'a',
          timestamp: '2026-04-22T11:00:00Z',
        }),
      ]
    )

    expect(events[0].status).toBe('running')
    expect(events[1].id).toBe('a')
  })

  test.each([
    ['Edit', 'edit'],
    ['MultiEdit', 'edit'],
    ['Write', 'write'],
    ['NotebookEdit', 'write'],
    ['Read', 'read'],
    ['Bash', 'bash'],
    ['Grep', 'grep'],
    ['Glob', 'glob'],
    ['WebFetch', 'meta'],
    ['Task', 'meta'],
    ['NotARealTool', 'meta'],
  ])('tool %s → kind %s', (tool, expectedKind) => {
    const events = toolCallsToEvents(null, [recent({ tool })])

    expect(events[0].kind).toBe(expectedKind)
  })

  test('malformed timestamps sink to the bottom without scrambling the rest', () => {
    // A stray unparseable timestamp shouldn't let Array.sort's NaN-comparator
    // behavior scramble the whole feed. Other entries stay in timestamp-desc
    // order; the malformed entry lands last.
    const events = toolCallsToEvents(null, [
      recent({ id: 'old', timestamp: '2026-04-22T10:00:00Z' }),
      recent({ id: 'bad', timestamp: 'not-an-iso-string' }),
      recent({ id: 'new', timestamp: '2026-04-22T12:00:00Z' }),
    ])

    expect(events.map((e) => e.id)).toEqual(['new', 'old', 'bad'])
  })

  test('passes through status, duration, id, timestamp', () => {
    const events = toolCallsToEvents(null, [
      recent({
        id: 'xyz',
        status: 'failed',
        durationMs: 5400,
        timestamp: '2026-04-22T09:00:00Z',
      }),
    ])

    expect(events[0]).toMatchObject({
      id: 'xyz',
      status: 'failed',
      durationMs: 5400,
      timestamp: '2026-04-22T09:00:00Z',
    })
  })
})
