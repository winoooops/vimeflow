import { describe, test, expect } from 'vitest'
import { lineDelta } from './lineDelta'
import type { Session } from '../types'

const sessionWith = (
  fileChanges: Session['activity']['fileChanges']
): Session =>
  ({
    activity: { fileChanges } as Session['activity'],
  }) as unknown as Session

describe('lineDelta', () => {
  test('empty fileChanges → { added: 0, removed: 0 }', () => {
    expect(lineDelta(sessionWith([]))).toEqual({ added: 0, removed: 0 })
  })

  test('single change sums linesAdded and linesRemoved', () => {
    expect(
      lineDelta(
        sessionWith([
          {
            path: 'a.ts',
            linesAdded: 10,
            linesRemoved: 3,
          } as Session['activity']['fileChanges'][number],
        ])
      )
    ).toEqual({ added: 10, removed: 3 })
  })

  test('multiple changes sum across all entries', () => {
    expect(
      lineDelta(
        sessionWith([
          { path: 'a.ts', linesAdded: 10, linesRemoved: 3 },
          { path: 'b.ts', linesAdded: 5, linesRemoved: 0 },
          { path: 'c.ts', linesAdded: 0, linesRemoved: 7 },
        ] as unknown as Session['activity']['fileChanges'])
      )
    ).toEqual({ added: 15, removed: 10 })
  })

  test('negative values pass through unchanged (no clamping)', () => {
    expect(
      lineDelta(
        sessionWith([
          { path: 'a.ts', linesAdded: -2, linesRemoved: -1 },
        ] as unknown as Session['activity']['fileChanges'])
      )
    ).toEqual({ added: -2, removed: -1 })
  })
})
