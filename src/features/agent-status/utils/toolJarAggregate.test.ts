import { describe, expect, test } from 'vitest'
import { TJ_MAX_TILES, toolJarAggregate } from './toolJarAggregate'
import type { ToolCount } from '../types'

const names = (tools: { name: string }[]): string[] => tools.map((t) => t.name)

describe('toolJarAggregate', () => {
  test('leaves a session at or under the cap fully expanded, in order', () => {
    const tools: ToolCount[] = Array.from({ length: TJ_MAX_TILES }, (_, i) => ({
      name: `t${i}`,
      count: TJ_MAX_TILES - i,
    }))

    const out = toolJarAggregate(tools)

    expect(out).toEqual(tools)
    expect(names(out)).not.toContain('others')
  })

  test('caps the jar at TJ_MAX_TILES tiles, folding the tail into "others"', () => {
    const tools: ToolCount[] = Array.from(
      { length: TJ_MAX_TILES + 5 },
      (_, i) => ({ name: `t${i}`, count: 100 - i })
    )

    const out = toolJarAggregate(tools)
    const others = out[out.length - 1]

    expect(out).toHaveLength(TJ_MAX_TILES)
    expect(others.name).toBe('others')
    expect(others.others).toHaveLength(6) // (TJ_MAX_TILES + 5) - (TJ_MAX_TILES - 1)
  })

  test('folds the lowest-count tools regardless of insertion order', () => {
    // A heavy tool placed last must stay a major; the two smallest fold even
    // though one of them was inserted first. (Assumes the default cap of 8.)
    const tools: ToolCount[] = [
      { name: 'a', count: 2 },
      { name: 'b', count: 1 },
      { name: 'c', count: 5 },
      { name: 'd', count: 4 },
      { name: 'e', count: 3 },
      { name: 'f', count: 6 },
      { name: 'g', count: 7 },
      { name: 'h', count: 8 },
      { name: 'big', count: 999 },
    ]

    const out = toolJarAggregate(tools)
    const others = out[out.length - 1]

    // Majors keep insertion order (a, b folded out); "others" appended last.
    expect(names(out).slice(0, -1)).toEqual([
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'big',
    ])
    expect(others.name).toBe('others')
    expect(others.count).toBe(3) // 2 + 1
    expect(others.others?.map((t) => t.count)).toEqual([2, 1]) // sorted desc
  })

  test('is deterministic', () => {
    const tools: ToolCount[] = Array.from(
      { length: TJ_MAX_TILES + 3 },
      (_, i) => ({ name: `t${i}`, count: 50 - i })
    )

    expect(toolJarAggregate(tools)).toEqual(toolJarAggregate(tools))
  })
})
