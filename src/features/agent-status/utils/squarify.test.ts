import { describe, expect, test } from 'vitest'
import { packTiles } from './squarify'
import type { ToolJarEntry } from '../types'

const tools: ToolJarEntry[] = [
  { name: 'exec_command', count: 542 },
  { name: 'write_stdin', count: 32 },
  { name: 'apply_patch', count: 28 },
  { name: 'get_issue', count: 7 },
  { name: '_fetch', count: 7 },
]

const W = 248
const H = 180

describe('packTiles', () => {
  test('returns one cell per tool', () => {
    expect(packTiles(tools, W, H, 0.3, 2600)).toHaveLength(tools.length)
  })

  test('rounds geometry to whole pixels (stable boxes, no jitter)', () => {
    for (const c of packTiles(tools, W, H, 0.3, 2600)) {
      expect(Number.isInteger(c.x)).toBe(true)
      expect(Number.isInteger(c.y)).toBe(true)
      expect(Number.isInteger(c.w)).toBe(true)
      expect(Number.isInteger(c.h)).toBe(true)
    }
  })

  test('keeps every cell within the box bounds', () => {
    for (const c of packTiles(tools, W, H, 0.3, 2600)) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeGreaterThanOrEqual(0)
      expect(c.x + c.w).toBeLessThanOrEqual(W + 1)
      expect(c.y + c.h).toBeLessThanOrEqual(H + 1)
    }
  })

  test('fills the box edge-to-edge (covered area ≈ full area)', () => {
    const area = packTiles(tools, W, H, 0.3, 2600).reduce(
      (acc, c) => acc + c.w * c.h,
      0
    )

    expect(area).toBeGreaterThan(W * H * 0.9)
    expect(area).toBeLessThanOrEqual(W * H * 1.05)
  })

  test('gives the heaviest tool the largest tile', () => {
    const cells = packTiles(tools, W, H, 0.3, 2600)
    const largest = cells.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b))

    expect(largest.data.name).toBe('exec_command')
  })

  test('keeps even the smallest tool above a readable floor', () => {
    const cells = packTiles(tools, W, H, 0.3, 2600)
    const smallest = Math.min(...cells.map((c) => c.w * c.h))

    expect(smallest).toBeGreaterThan(1500)
  })

  test('returns an empty layout for no tools or a zero-size box', () => {
    expect(packTiles([], W, H, 0.3, 2600)).toEqual([])
    expect(packTiles(tools, 0, H, 0.3, 2600)).toEqual([])
  })
})
