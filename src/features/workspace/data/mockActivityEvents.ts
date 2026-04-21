import type { ActivityEvent } from '../types'

/**
 * Mock activity events for testing ActivityFeed component.
 * Covers all five event types (edit, bash, read, think, user)
 * and all four badge kinds (live, ok, failed, diff).
 */
export const mockActivityEvents: ActivityEvent[] = [
  // EDIT events
  {
    id: 'evt-1',
    type: 'edit',
    body: 'src/features/workspace/types/index.ts',
    at: '2026-04-21T01:20:00Z',
    badge: {
      kind: 'diff',
      text: '+12 -2',
    },
  },
  {
    id: 'evt-2',
    type: 'edit',
    body: 'src/features/workspace/components/AgentActivity/StatusCard.tsx',
    at: '2026-04-21T01:18:30Z',
    badge: {
      kind: 'diff',
      text: '+45 -18',
    },
  },
  {
    id: 'evt-3',
    type: 'edit',
    body: 'src/features/workspace/data/mockSessions.ts',
    at: '2026-04-21T01:15:00Z',
    badge: {
      kind: 'ok',
      text: 'OK',
    },
  },

  // BASH events
  {
    id: 'evt-4',
    type: 'bash',
    body: 'npm test -- src/features/workspace/types/index.test.ts',
    at: '2026-04-21T01:22:00Z',
    badge: {
      kind: 'live',
      text: 'LIVE',
    },
  },
  {
    id: 'evt-5',
    type: 'bash',
    body: 'npm run type-check',
    at: '2026-04-21T01:19:45Z',
    badge: {
      kind: 'ok',
      text: 'OK',
    },
  },
  {
    id: 'evt-6',
    type: 'bash',
    body: 'npm run lint',
    at: '2026-04-21T01:14:20Z',
    badge: {
      kind: 'failed',
      text: 'FAILED 2/8',
    },
  },

  // READ events
  {
    id: 'evt-7',
    type: 'read',
    body: 'docs/design/UNIFIED.md',
    at: '2026-04-21T01:12:00Z',
  },
  {
    id: 'evt-8',
    type: 'read',
    body: 'src/features/workspace/types/index.ts',
    at: '2026-04-21T01:10:30Z',
  },
  {
    id: 'evt-9',
    type: 'read',
    body: 'docs/design/tokens.ts',
    at: '2026-04-21T01:08:15Z',
    badge: {
      kind: 'ok',
      text: 'OK',
    },
  },

  // THINK events - rendered in italic with curly quotes per UNIFIED.md §5.2
  {
    id: 'evt-10',
    type: 'think',
    body: 'I need to update all SessionStatus references to support the new five-state model',
    at: '2026-04-21T01:17:00Z',
  },
  {
    id: 'evt-11',
    type: 'think',
    body: 'The StatusCard component should use the StatusDot once implemented',
    at: '2026-04-21T01:11:45Z',
  },
  {
    id: 'evt-12',
    type: 'think',
    body: 'Mock data needs examples of all five states: running, awaiting, completed, errored, idle',
    at: '2026-04-21T01:09:00Z',
  },

  // USER events
  {
    id: 'evt-13',
    type: 'user',
    body: 'Extend SessionStatus to five-state model',
    at: '2026-04-21T01:05:00Z',
  },
  {
    id: 'evt-14',
    type: 'user',
    body: 'Update all tests to cover the new states',
    at: '2026-04-21T01:16:30Z',
  },
]

/**
 * Get events by type for testing specific event rendering
 */
export const getEventsByType = (type: ActivityEvent['type']): ActivityEvent[] =>
  mockActivityEvents.filter((e) => e.type === type)

/**
 * Get events with badges for testing badge rendering
 */
export const getEventsWithBadges = (): ActivityEvent[] =>
  mockActivityEvents.filter((e) => e.badge !== undefined)

/**
 * Get events by badge kind for testing specific badge styles
 */
export const getEventsByBadgeKind = (
  kind: NonNullable<ActivityEvent['badge']>['kind']
): ActivityEvent[] => mockActivityEvents.filter((e) => e.badge?.kind === kind)
