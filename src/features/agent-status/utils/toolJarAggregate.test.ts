import { describe, expect, test } from 'vitest'
import { toolJarAggregate } from './toolJarAggregate'
import type { ToolCount } from '../types'

const names = (tools: { name: string }[]): string[] => tools.map((t) => t.name)

describe('toolJarAggregate', () => {
  test('does not fold at or below TJ_MIN_TILES tools', () => {
    // 8 tools incl. several trivial ones — too few tiles to be crowded.
    const tools: ToolCount[] = [
      { name: 'a', count: 50 },
      { name: 'b', count: 40 },
      { name: 'c', count: 30 },
      { name: 'd', count: 3 },
      { name: 'e', count: 2 },
      { name: 'f', count: 2 },
      { name: 'g', count: 1 },
      { name: 'h', count: 1 },
    ]

    const out = toolJarAggregate(tools)

    expect(out).toEqual(tools)
    expect(names(out)).not.toContain('others')
  })

  test('does not fold when fewer than TJ_MIN_FOLD trivial tools', () => {
    // 9 tools but only 2 are trivial (count <= 3 and < 5% share).
    const tools: ToolCount[] = [
      { name: 'a', count: 50 },
      { name: 'b', count: 40 },
      { name: 'c', count: 30 },
      { name: 'd', count: 20 },
      { name: 'e', count: 10 },
      { name: 'f', count: 8 },
      { name: 'g', count: 6 },
      { name: 'h', count: 2 },
      { name: 'i', count: 1 },
    ]

    expect(names(toolJarAggregate(tools))).not.toContain('others')
  })

  test('folds trivial tools into "others" when crowded enough', () => {
    const tools: ToolCount[] = [
      { name: 'exec_command', count: 542 },
      { name: 'write_stdin', count: 32 },
      { name: 'apply_patch', count: 28 },
      { name: 't1', count: 3 },
      { name: 't2', count: 3 },
      { name: 't3', count: 2 },
      { name: 't4', count: 2 },
      { name: 't5', count: 1 },
      { name: 't6', count: 1 },
    ]

    const out = toolJarAggregate(tools)
    const others = out[out.length - 1]

    expect(names(out.slice(0, 3))).toEqual([
      'exec_command',
      'write_stdin',
      'apply_patch',
    ])
    expect(others.name).toBe('others')
    expect(others.count).toBe(12) // 3+3+2+2+1+1
    expect(others.others?.map((t) => t.count)).toEqual([3, 3, 2, 2, 1, 1])
  })

  test('a small-count tool with a large share is NOT trivial', () => {
    // 9 tools each count 3: count <= 3 but every share (3/27 ≈ 11%) exceeds
    // TJ_TRIVIAL_SHARE, so none fold.
    const tools: ToolCount[] = Array.from({ length: 9 }, (_, i) => ({
      name: `t${i}`,
      count: 3,
    }))

    expect(names(toolJarAggregate(tools))).not.toContain('others')
  })
})
