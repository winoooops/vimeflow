import { describe, expect, test } from 'vitest'
import { classifyToolCall } from './toolCallProfiles'

describe('base tool-call profile', () => {
  test('keeps shared canonical tools available to every agent', () => {
    expect(classifyToolCall('kimi', 'Read')).toMatchObject({
      kind: 'read',
      label: 'READ',
    })
  })

  test('recognizes dynamic MCP names without an exhaustive registry', () => {
    expect(
      classifyToolCall('claude-code', 'mcp__github__get_issue')
    ).toMatchObject({
      kind: 'external',
      label: 'GITHUB · GET ISSUE',
    })
  })

  test('preserves unknown tools as visible meta traces', () => {
    expect(classifyToolCall('claude-code', 'Zeta')).toMatchObject({
      kind: 'meta',
      label: 'ZETA',
    })
  })

  test.each(['toString', 'constructor', '__proto__'])(
    'preserves inherited-key tool %s as a visible meta trace',
    (tool) => {
      expect(classifyToolCall('claude-code', tool)).toMatchObject({
        kind: 'meta',
        label: tool.toUpperCase(),
      })
    }
  )
})
