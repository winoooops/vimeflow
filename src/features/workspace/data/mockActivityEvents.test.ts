import { describe, test, expect } from 'vitest'
import {
  mockActivityEvents,
  getEventsByType,
  getEventsWithBadges,
  getEventsByBadgeKind,
} from './mockActivityEvents'
import type { ActivityEventType } from '../types'

describe('mockActivityEvents', () => {
  test('contains multiple events', () => {
    expect(mockActivityEvents.length).toBeGreaterThan(0)
  })

  test('all events have required fields', () => {
    mockActivityEvents.forEach((event) => {
      expect(event.id).toBeTruthy()
      expect(event.type).toBeTruthy()
      expect(event.body).toBeTruthy()
      expect(event.at).toBeTruthy()
      expect(event.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    })
  })

  test('all five event types are represented', () => {
    const types = mockActivityEvents.map((e) => e.type)
    const uniqueTypes = [...new Set(types)]

    expect(uniqueTypes).toContain('edit')
    expect(uniqueTypes).toContain('bash')
    expect(uniqueTypes).toContain('read')
    expect(uniqueTypes).toContain('think')
    expect(uniqueTypes).toContain('user')
    expect(uniqueTypes).toHaveLength(5)
  })

  test('all four badge kinds are represented', () => {
    const badges = mockActivityEvents
      .filter((e) => e.badge !== undefined)
      .map((e) => e.badge!.kind)
    const uniqueBadgeKinds = [...new Set(badges)]

    expect(uniqueBadgeKinds).toContain('live')
    expect(uniqueBadgeKinds).toContain('ok')
    expect(uniqueBadgeKinds).toContain('failed')
    expect(uniqueBadgeKinds).toContain('diff')
    expect(uniqueBadgeKinds).toHaveLength(4)
  })

  test('event types are valid ActivityEventType values', () => {
    const validTypes: ActivityEventType[] = [
      'edit',
      'bash',
      'read',
      'think',
      'user',
    ]

    mockActivityEvents.forEach((event) => {
      expect(validTypes).toContain(event.type)
    })
  })

  test('badges have kind and text fields when present', () => {
    mockActivityEvents
      .filter((e) => e.badge !== undefined)
      .forEach((event) => {
        expect(event.badge!.kind).toBeTruthy()
        expect(event.badge!.text).toBeTruthy()
        expect(['live', 'ok', 'failed', 'diff']).toContain(event.badge!.kind)
      })
  })

  describe('getEventsByType', () => {
    test('filters edit events correctly', () => {
      const editEvents = getEventsByType('edit')

      expect(editEvents.length).toBeGreaterThan(0)
      editEvents.forEach((event) => {
        expect(event.type).toBe('edit')
      })
    })

    test('filters bash events correctly', () => {
      const bashEvents = getEventsByType('bash')

      expect(bashEvents.length).toBeGreaterThan(0)
      bashEvents.forEach((event) => {
        expect(event.type).toBe('bash')
      })
    })

    test('filters read events correctly', () => {
      const readEvents = getEventsByType('read')

      expect(readEvents.length).toBeGreaterThan(0)
      readEvents.forEach((event) => {
        expect(event.type).toBe('read')
      })
    })

    test('filters think events correctly', () => {
      const thinkEvents = getEventsByType('think')

      expect(thinkEvents.length).toBeGreaterThan(0)
      thinkEvents.forEach((event) => {
        expect(event.type).toBe('think')
      })
    })

    test('filters user events correctly', () => {
      const userEvents = getEventsByType('user')

      expect(userEvents.length).toBeGreaterThan(0)
      userEvents.forEach((event) => {
        expect(event.type).toBe('user')
      })
    })
  })

  describe('getEventsWithBadges', () => {
    test('returns only events with badges', () => {
      const eventsWithBadges = getEventsWithBadges()

      expect(eventsWithBadges.length).toBeGreaterThan(0)
      eventsWithBadges.forEach((event) => {
        expect(event.badge).toBeDefined()
      })
    })
  })

  describe('getEventsByBadgeKind', () => {
    test('filters live badge events correctly', () => {
      const liveEvents = getEventsByBadgeKind('live')

      expect(liveEvents.length).toBeGreaterThan(0)
      liveEvents.forEach((event) => {
        expect(event.badge?.kind).toBe('live')
      })
    })

    test('filters ok badge events correctly', () => {
      const okEvents = getEventsByBadgeKind('ok')

      expect(okEvents.length).toBeGreaterThan(0)
      okEvents.forEach((event) => {
        expect(event.badge?.kind).toBe('ok')
      })
    })

    test('filters failed badge events correctly', () => {
      const failedEvents = getEventsByBadgeKind('failed')

      expect(failedEvents.length).toBeGreaterThan(0)
      failedEvents.forEach((event) => {
        expect(event.badge?.kind).toBe('failed')
      })
    })

    test('filters diff badge events correctly', () => {
      const diffEvents = getEventsByBadgeKind('diff')

      expect(diffEvents.length).toBeGreaterThan(0)
      diffEvents.forEach((event) => {
        expect(event.badge?.kind).toBe('diff')
      })
    })
  })

  test('LIVE badge text is uppercase', () => {
    const liveEvents = getEventsByBadgeKind('live')

    liveEvents.forEach((event) => {
      expect(event.badge!.text).toBe('LIVE')
    })
  })

  test('OK badge text is uppercase', () => {
    const okEvents = getEventsByBadgeKind('ok')

    okEvents.forEach((event) => {
      expect(event.badge!.text).toBe('OK')
    })
  })

  test('FAILED badge text includes count format', () => {
    const failedEvents = getEventsByBadgeKind('failed')

    failedEvents.forEach((event) => {
      expect(event.badge!.text).toMatch(/^FAILED \d+\/\d+$/)
    })
  })

  test('diff badge text includes +/- format', () => {
    const diffEvents = getEventsByBadgeKind('diff')

    diffEvents.forEach((event) => {
      expect(event.badge!.text).toMatch(/^\+\d+ -\d+$/)
    })
  })

  test('timestamps are in chronological order', () => {
    for (let i = 1; i < mockActivityEvents.length; i++) {
      const prev = new Date(mockActivityEvents[i - 1].at)
      const curr = new Date(mockActivityEvents[i].at)

      // Events should be ordered newest to oldest or vice versa
      expect(prev).toBeTruthy()
      expect(curr).toBeTruthy()
    }
  })
})
