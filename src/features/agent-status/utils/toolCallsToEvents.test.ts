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
  ...overrides,
})

describe('toolCallsToEvents', () => {
  test('null active + empty recent → empty array', () => {
    expect(toolCallsToEvents(null, [])).toEqual([])
  })

  test('active only → one running event with startedAt as timestamp', () => {
    const active: ActiveToolCall = {
      tool: 'Edit',
      args: 'src/foo.ts',
      startedAt: '2026-04-22T10:30:00Z',
    }
    const events = toolCallsToEvents(active, [])

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'edit',
      tool: 'Edit',
      body: 'src/foo.ts',
      status: 'running',
      timestamp: '2026-04-22T10:30:00Z',
      durationMs: null,
    })
  })

  test('recent only → events in given order', () => {
    const events = toolCallsToEvents(null, [
      recent({ id: 'a', tool: 'Bash', args: 'ls' }),
      recent({ id: 'b', tool: 'Read', args: 'x.ts' }),
    ])

    expect(events.map((e) => e.id)).toEqual(['a', 'b'])
  })

  test('active is prepended to recent', () => {
    const events = toolCallsToEvents(
      {
        tool: 'Edit',
        args: 'src/foo.ts',
        startedAt: '2026-04-22T10:30:00Z',
      },
      [recent({ id: 'a' })]
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
