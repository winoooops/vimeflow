import { describe, test, expect } from 'vitest'
import { mediateReorder } from './mediateReorder'
import type { Session } from '../../workspace/types'

const session = (id: string): Session => ({ id }) as unknown as Session

describe('mediateReorder', () => {
  test('empty active + empty recent → empty array', () => {
    expect(mediateReorder([], [])).toEqual([])
  })

  test('reordered active is the prefix; recent is the suffix', () => {
    const a = session('a')
    const b = session('b')
    const c = session('c')
    expect(mediateReorder([b, a], [c])).toEqual([b, a, c])
  })

  test('does not deduplicate (correctness depends on caller mirroring recent synchronously)', () => {
    const a = session('a')
    const b = session('b')
    expect(mediateReorder([a, b], [a])).toEqual([a, b, a])
  })
})
