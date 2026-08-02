import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import {
  hasUnreadAlert,
  notificationCategory,
  notificationCenterInitialState,
  notificationCenterReducer,
  sessionUnreadCategory,
  unreadNotificationCount,
  useNotificationCenter,
  type NotificationInput,
  type NotificationRecord,
} from './useNotificationCenter'

const input = (
  overrides: Partial<NotificationInput> = {}
): NotificationInput => ({
  sessionId: 'session-1',
  ptyId: 'pty-1',
  reason: 'turn-complete',
  title: 'Turn complete',
  occurredAt: 1,
  ...overrides,
})

const record = (
  id: string,
  overrides: Partial<NotificationRecord> = {}
): NotificationRecord => ({
  ...input(),
  id,
  read: false,
  ...overrides,
})

describe('notification center domain', () => {
  test('derives the two accepted UI categories from reason', () => {
    expect(notificationCategory('turn-complete')).toBe('need')
    expect(notificationCategory('approval-requested')).toBe('need')
    expect(notificationCategory('question-requested')).toBe('need')
    expect(notificationCategory('terminal-attention')).toBe('need')
    expect(notificationCategory('agent-error')).toBe('err')
  })

  test('publishes newest first and ignores a duplicate producer key', () => {
    const first = notificationCenterReducer(notificationCenterInitialState, {
      type: 'publish',
      record: record('first', { dedupeKey: 'turn-1' }),
    })

    const second = notificationCenterReducer(first, {
      type: 'publish',
      record: record('second', {
        occurredAt: 2,
        dedupeKey: 'turn-2',
      }),
    })

    expect(second.records.map(({ id }) => id)).toEqual(['second', 'first'])
    expect(
      notificationCenterReducer(second, {
        type: 'publish',
        record: record('duplicate', {
          title: 'Duplicate delivery',
          dedupeKey: 'turn-2',
        }),
      })
    ).toBe(second)
  })

  test('scopes producer dedupe keys to their PTY', () => {
    const first = notificationCenterReducer(notificationCenterInitialState, {
      type: 'publish',
      record: record('first', { dedupeKey: 'turn-1' }),
    })

    const second = notificationCenterReducer(first, {
      type: 'publish',
      record: record('second', {
        sessionId: 'session-2',
        ptyId: 'pty-2',
        dedupeKey: 'turn-1',
      }),
    })

    expect(second.records).toHaveLength(2)
  })

  test('keeps only the fifty newest records', () => {
    const state = Array.from({ length: 51 }, (_, index) => index).reduce(
      (current, index) =>
        notificationCenterReducer(current, {
          type: 'publish',
          record: record(`record-${String(index)}`, { occurredAt: index }),
        }),
      notificationCenterInitialState
    )

    expect(state.records).toHaveLength(50)
    expect(state.records[0]?.id).toBe('record-50')
    expect(state.records[state.records.length - 1]?.id).toBe('record-1')
  })

  test('marks one record read without changing its siblings', () => {
    const state = {
      records: [record('second'), record('first')],
    }

    expect(
      notificationCenterReducer(state, { type: 'mark-read', id: 'first' })
        .records
    ).toEqual([record('second'), record('first', { read: true })])
  })

  test('dismisses one record and prunes explicitly closed scopes', () => {
    const state = {
      records: [
        record('third', { sessionId: 'session-2', ptyId: 'pty-2' }),
        record('second'),
        record('first'),
        record('pane-sibling', { ptyId: 'pty-sibling' }),
      ],
    }

    const dismissed = notificationCenterReducer(state, {
      type: 'dismiss',
      id: 'second',
    })

    expect(dismissed.records.map(({ id }) => id)).toEqual([
      'third',
      'first',
      'pane-sibling',
    ])

    expect(
      notificationCenterReducer(state, {
        type: 'prune-pane',
        sessionId: 'session-1',
        ptyId: 'pty-1',
      }).records.map(({ id }) => id)
    ).toEqual(['third', 'pane-sibling'])

    expect(
      notificationCenterReducer(dismissed, {
        type: 'prune-session',
        sessionId: 'session-1',
      }).records.map(({ id }) => id)
    ).toEqual(['third'])
  })

  test('marks all read and clears every record', () => {
    const state = {
      records: [record('second'), record('first')],
    }
    const read = notificationCenterReducer(state, { type: 'mark-all-read' })

    expect(read.records.every(({ read: isRead }) => isRead)).toBe(true)
    expect(notificationCenterReducer(read, { type: 'clear' })).toEqual(
      notificationCenterInitialState
    )
  })

  test('derives unread count, alert priority, and per-session category', () => {
    const records = [
      record('read-error', { reason: 'agent-error', read: true }),
      record('need'),
      record('error', { reason: 'agent-error' }),
      record('other', {
        sessionId: 'session-2',
        ptyId: 'pty-2',
        reason: 'question-requested',
      }),
    ]

    expect(unreadNotificationCount(records)).toBe(3)
    expect(hasUnreadAlert(records)).toBe(true)
    expect(
      sessionUnreadCategory(records, {
        id: 'session-1',
        panes: [{ ptyId: 'pty-1' }],
      })
    ).toBe('err')

    expect(
      sessionUnreadCategory(records, {
        id: 'session-2',
        panes: [{ ptyId: 'pty-2' }],
      })
    ).toBe('need')

    expect(
      sessionUnreadCategory(records, { id: 'missing', panes: [] })
    ).toBeNull()
  })

  test('publishes inputs through the hook and exposes reducer actions', () => {
    const { result } = renderHook(() => useNotificationCenter())

    act(() => {
      result.current.publish(
        input({
          body: 'Review the completed work',
          dedupeKey: 'turn-1',
        })
      )
    })

    expect(result.current.records).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        ptyId: 'pty-1',
        reason: 'turn-complete',
        body: 'Review the completed work',
        dedupeKey: 'turn-1',
        read: false,
      }),
    ])
    expect(result.current.records[0]?.id).toEqual(expect.any(String))

    act(() => {
      result.current.markRead(result.current.records[0]?.id ?? '')
    })
    expect(result.current.records[0]?.read).toBe(true)

    act(() => {
      result.current.clear()
    })
    expect(result.current.records).toEqual([])
  })
})
