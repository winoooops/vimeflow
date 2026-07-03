import { describe, test, expect } from 'vitest'
import { matchDiffLines, type DiffSearchLine } from './matchDiffLines'

const line = (
  side: 'deletions' | 'additions',
  rawIndex: string,
  order: number,
  text: string
): DiffSearchLine => ({
  key: `${side}:${rawIndex}`,
  side,
  order,
  text,
})

describe('matchDiffLines', () => {
  test('returns empty for empty query', () => {
    expect(
      matchDiffLines([line('additions', '0,0', 0, 'const search = 1')], '')
    ).toEqual([])
  })

  test('matches case-insensitively with column offsets', () => {
    expect(
      matchDiffLines(
        [line('additions', '0,0', 0, 'const Search = search')],
        'search'
      )
    ).toEqual([
      {
        key: 'additions:0,0',
        side: 'additions',
        order: 0,
        start: 6,
        end: 12,
      },
      {
        key: 'additions:0,0',
        side: 'additions',
        order: 0,
        start: 15,
        end: 21,
      },
    ])
  })

  test('scans non-overlapping single-number fallback lines', () => {
    expect(matchDiffLines([line('additions', '7', 7, 'aaaa')], 'aa')).toEqual([
      {
        key: 'additions:7',
        side: 'additions',
        order: 7,
        start: 0,
        end: 2,
      },
      {
        key: 'additions:7',
        side: 'additions',
        order: 7,
        start: 2,
        end: 4,
      },
    ])
  })

  test('orders split multi-line replacements row by row', () => {
    const matches = matchDiffLines(
      [
        line('deletions', '1,1', 1, 'old-a1: foo'),
        line('deletions', '2,2', 2, 'old-a2: foo'),
        line('additions', '3,1', 1, 'new-a1: foo'),
        line('additions', '4,2', 2, 'new-a2: foo'),
      ],
      'foo'
    )
    expect(matches.map((m) => m.key)).toEqual([
      'deletions:1,1',
      'additions:3,1',
      'deletions:2,2',
      'additions:4,2',
    ])
  })

  test('orders unified pairs by the first component', () => {
    const matches = matchDiffLines(
      [
        line('additions', '4,2', 4, 'foo'),
        line('deletions', '3,1', 3, 'foo'),
        line('additions', '5,3', 5, 'foo'),
      ],
      'foo'
    )

    expect(matches.map((m) => m.key)).toEqual([
      'deletions:3,1',
      'additions:4,2',
      'additions:5,3',
    ])
  })
})
