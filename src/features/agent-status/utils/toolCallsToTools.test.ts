import { describe, expect, test } from 'vitest'
import { toolCallsToTools } from './toolCallsToTools'

describe('toolCallsToTools', () => {
  test('maps a byType record into name/count entries', () => {
    expect(toolCallsToTools({ Read: 3, Bash: 1 })).toEqual([
      { name: 'Read', count: 3 },
      { name: 'Bash', count: 1 },
    ])
  })

  test('preserves insertion order — never sorts by count', () => {
    const tools = toolCallsToTools({ Read: 1, Bash: 99, Grep: 2 })

    expect(tools.map((t) => t.name)).toEqual(['Read', 'Bash', 'Grep'])
  })

  test('returns an empty array for an empty record', () => {
    expect(toolCallsToTools({})).toEqual([])
  })
})
