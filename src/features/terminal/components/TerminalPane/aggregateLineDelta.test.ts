import { describe, expect, test } from 'vitest'
import { aggregateLineDelta } from './aggregateLineDelta'
import type { ChangedFile } from '../../../diff/types'

describe('aggregateLineDelta', () => {
  test('empty array returns zero counts', () => {
    expect(aggregateLineDelta([])).toEqual({ added: 0, removed: 0 })
  })

  test('sums insertions and deletions across files', () => {
    const files: ChangedFile[] = [
      {
        path: 'a.ts',
        status: 'modified',
        insertions: 10,
        deletions: 3,
        staged: false,
      },
      {
        path: 'b.ts',
        status: 'modified',
        insertions: 5,
        deletions: 1,
        staged: true,
      },
      {
        path: 'c.ts',
        status: 'untracked',
        insertions: 20,
        deletions: 0,
        staged: false,
      },
    ]

    expect(aggregateLineDelta(files)).toEqual({ added: 35, removed: 4 })
  })

  test('treats missing insertions and deletions as zero', () => {
    const files: ChangedFile[] = [
      { path: 'a.ts', status: 'modified', staged: false },
      { path: 'b.ts', status: 'modified', insertions: 7, staged: true },
    ]

    expect(aggregateLineDelta(files)).toEqual({ added: 7, removed: 0 })
  })
})
