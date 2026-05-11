import { describe, expect, test } from 'vitest'
import { emptyActivity } from './constants'

describe('emptyActivity', () => {
  test('produces a fresh AgentActivity skeleton with zeroed counters', () => {
    expect(emptyActivity.fileChanges).toEqual([])
    expect(emptyActivity.toolCalls).toEqual([])
    expect(emptyActivity.testResults).toEqual([])
    expect(emptyActivity.contextWindow.percentage).toBe(0)
    expect(emptyActivity.usage.turnCount).toBe(0)
  })

  test('returns the same reference (not a factory)', () => {
    const a = emptyActivity
    const b = emptyActivity
    expect(a).toBe(b)
  })
})
