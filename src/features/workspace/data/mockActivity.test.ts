import { describe, test, expect } from 'vitest'
import { mockAgentActivity } from './mockActivity'

describe('mockAgentActivity', () => {
  test('contains activity data for multiple sessions', () => {
    expect(mockAgentActivity.length).toBeGreaterThan(0)
  })

  test('all activities have required fields', () => {
    mockAgentActivity.forEach((activity) => {
      expect(activity.fileChanges).toBeDefined()
      expect(activity.toolCalls).toBeDefined()
      expect(activity.testResults).toBeDefined()
      expect(activity.contextWindow).toBeDefined()
      expect(activity.usage).toBeDefined()
    })
  })

  test('file changes have valid types', () => {
    mockAgentActivity.forEach((activity) => {
      activity.fileChanges.forEach((change) => {
        expect(['new', 'modified', 'deleted']).toContain(change.type)
        expect(change.path).toBeTruthy()
        expect(change.timestamp).toBeTruthy()
      })
    })
  })

  test('tool calls have valid statuses', () => {
    mockAgentActivity.forEach((activity) => {
      activity.toolCalls.forEach((call) => {
        expect(['running', 'done', 'failed']).toContain(call.status)
        expect(call.tool).toBeTruthy()
        expect(call.timestamp).toBeTruthy()
      })
    })
  })

  test('results have valid counts', () => {
    mockAgentActivity.forEach((activity) => {
      activity.testResults.forEach((result) => {
        expect(result.total).toBe(result.passed + result.failed)
        expect(result.passed).toBeGreaterThanOrEqual(0)
        expect(result.failed).toBeGreaterThanOrEqual(0)
      })
    })
  })

  test('context window percentage matches used/total ratio', () => {
    mockAgentActivity.forEach((activity) => {
      const { contextWindow } = activity

      const expectedPercentage = Math.round(
        (contextWindow.used / contextWindow.total) * 100
      )

      // Allow 1% tolerance for rounding differences
      expect(contextWindow.percentage).toBeGreaterThanOrEqual(
        expectedPercentage - 1
      )

      expect(contextWindow.percentage).toBeLessThanOrEqual(
        expectedPercentage + 1
      )
    })
  })

  test('context window emoji matches percentage ranges', () => {
    mockAgentActivity.forEach((activity) => {
      const { contextWindow } = activity
      const { percentage, emoji } = contextWindow

      if (percentage < 50) {
        expect(emoji).toBe('😊')
      } else if (percentage < 75) {
        expect(emoji).toBe('😐')
      } else if (percentage < 90) {
        expect(emoji).toBe('😟')
      } else {
        expect(emoji).toBe('🥵')
      }
    })
  })

  test('usage metrics are consistent', () => {
    mockAgentActivity.forEach((activity) => {
      const { usage } = activity

      expect(usage.sessionDuration).toBeGreaterThan(0)
      expect(usage.turnCount).toBeGreaterThan(0)
      expect(usage.messages.sent).toBeGreaterThan(0)
      expect(usage.messages.sent).toBeLessThanOrEqual(usage.messages.limit)

      expect(usage.tokens.total).toBe(usage.tokens.input + usage.tokens.output)
    })
  })

  test('active session (first) has running tool calls', () => {
    const activeActivity = mockAgentActivity[0]

    const runningCalls = activeActivity.toolCalls.filter(
      (c) => c.status === 'running'
    )

    expect(runningCalls.length).toBeGreaterThan(0)
  })

  test('completed sessions have no running tool calls', () => {
    // Session indices 2 and 4 are completed
    ;[mockAgentActivity[2], mockAgentActivity[4]].forEach((activity) => {
      const runningCalls = activity.toolCalls.filter(
        (c) => c.status === 'running'
      )

      expect(runningCalls.length).toBe(0)
    })
  })
})
