import { describe, test, expect } from 'vitest'
import {
  mockSessions,
  getSessionById,
  getActiveSession,
  getSessionsByProject,
} from './mockSessions'

describe('mockSessions', () => {
  test('contains multiple sessions', () => {
    expect(mockSessions.length).toBeGreaterThan(0)
  })

  test('all sessions have required fields', () => {
    mockSessions.forEach((session) => {
      expect(session.id).toBeTruthy()
      expect(session.projectId).toBeTruthy()
      expect(session.name).toBeTruthy()
      expect(session.status).toBeTruthy()
      expect(session.workingDirectory).toBeTruthy()
      expect(session.agentType).toBeTruthy()
      expect(session.createdAt).toBeTruthy()
      expect(session.lastActivityAt).toBeTruthy()
      expect(session.activity).toBeDefined()
    })
  })

  test('session statuses are valid', () => {
    const validStatuses = ['running', 'paused', 'completed', 'errored']

    mockSessions.forEach((session) => {
      expect(validStatuses).toContain(session.status)
    })
  })

  test('getSessionById returns correct session', () => {
    const session = getSessionById('sess-1')

    expect(session).toBeDefined()
    expect(session?.id).toBe('sess-1')
    expect(session?.name).toBe('auth middleware')
  })

  test('getSessionById returns undefined for non-existent id', () => {
    const session = getSessionById('non-existent')

    expect(session).toBeUndefined()
  })

  test('getActiveSession returns first session', () => {
    const active = getActiveSession()

    expect(active).toBeDefined()
    expect(active.id).toBe(mockSessions[0].id)
    expect(active.status).toBe('running')
  })

  test('getSessionsByProject filters correctly', () => {
    const proj1Sessions = getSessionsByProject('proj-1')

    expect(proj1Sessions.length).toBeGreaterThan(0)
    proj1Sessions.forEach((session) => {
      expect(session.projectId).toBe('proj-1')
    })
  })

  test('getSessionsByProject returns empty array for non-existent project', () => {
    const sessions = getSessionsByProject('non-existent')

    expect(sessions).toEqual([])
  })

  test('running sessions have terminalPid', () => {
    mockSessions
      .filter((s) => s.status === 'running')
      .forEach((session) => {
        expect(session.terminalPid).toBeDefined()
        expect(session.terminalPid).toBeGreaterThan(0)
      })
  })

  test('session activity has valid structure', () => {
    mockSessions.forEach((session) => {
      const { activity } = session

      expect(activity.fileChanges).toBeDefined()
      expect(Array.isArray(activity.fileChanges)).toBe(true)

      expect(activity.toolCalls).toBeDefined()
      expect(Array.isArray(activity.toolCalls)).toBe(true)

      expect(activity.testResults).toBeDefined()
      expect(Array.isArray(activity.testResults)).toBe(true)

      expect(activity.contextWindow).toBeDefined()
      expect(activity.contextWindow.emoji).toMatch(/😊|😐|😟|🥵/)

      expect(activity.usage).toBeDefined()
      expect(activity.usage.sessionDuration).toBeGreaterThan(0)
      expect(activity.usage.turnCount).toBeGreaterThan(0)
    })
  })
})
