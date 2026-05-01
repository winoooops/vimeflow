import { describe, expect, test } from 'vitest'
import type { ChangedFile } from '../types'
import { sumLines } from './sumLines'

const file = (overrides: Partial<ChangedFile>): ChangedFile => ({
  path: 'src/x.ts',
  status: 'modified',
  staged: false,
  ...overrides,
})

describe('sumLines', () => {
  test('returns zeros for an empty list', () => {
    expect(sumLines([])).toEqual({ added: 0, removed: 0 })
  })

  test('sums insertions and deletions across files', () => {
    const files: ChangedFile[] = [
      file({ insertions: 12, deletions: 3 }),
      file({ insertions: 0, deletions: 8 }),
      file({ insertions: 4, deletions: 4 }),
    ]
    expect(sumLines(files)).toEqual({ added: 16, removed: 15 })
  })

  test('treats undefined insertions / deletions as zero', () => {
    const files: ChangedFile[] = [
      file({ insertions: 5, deletions: 2 }),
      file({}), // both stat counts absent (untracked file with no diff stat)
      file({ insertions: undefined, deletions: 7 }),
    ]
    expect(sumLines(files)).toEqual({ added: 5, removed: 9 })
  })

  test('handles a single file', () => {
    expect(sumLines([file({ insertions: 9, deletions: 1 })])).toEqual({
      added: 9,
      removed: 1,
    })
  })

  test('large counts sum without precision issues', () => {
    const files: ChangedFile[] = Array.from({ length: 200 }, () =>
      file({ insertions: 10_000, deletions: 5_000 })
    )
    expect(sumLines(files)).toEqual({ added: 2_000_000, removed: 1_000_000 })
  })
})
