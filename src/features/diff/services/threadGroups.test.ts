import { describe, expect, test } from 'vitest'
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from '../hooks/useFeedbackBatch'
import { DRAFT_ID } from '../hooks/useFeedbackBatch'
import {
  buildThreadGroups,
  threadAnchorLabel,
  threadGroupKey,
  threadRollup,
} from './threadGroups'

const LOCATION = { cwd: '/repo', filePath: 'src/foo.ts', staged: false }

const annotation = (
  metadata: Partial<ReviewComment> & { id: string },
  lineNumber = 5
): DiffLineAnnotation<ReviewComment> => ({
  side: 'additions',
  lineNumber,
  metadata: {
    text: 't',
    author: 'self',
    createdAt: 1,
    ...metadata,
  } as ReviewComment,
})

describe('threadGroupKey', () => {
  test('pending self comments and the draft sentinel have no key', () => {
    expect(threadGroupKey(annotation({ id: 'p1' }))).toBeUndefined()
    expect(threadGroupKey(annotation({ id: DRAFT_ID }))).toBeUndefined()
  })

  test('threadId wins; dispatched and non-self fall back to own id', () => {
    expect(threadGroupKey(annotation({ id: 'a1', threadId: 'root-1' }))).toBe(
      'root-1'
    )

    expect(threadGroupKey(annotation({ id: 'c1', dispatchedAt: 1000 }))).toBe(
      'c1'
    )
    expect(threadGroupKey(annotation({ id: 'g1', author: 'agent' }))).toBe('g1')
    expect(threadGroupKey(annotation({ id: 'r1', author: 'reviewer' }))).toBe(
      'r1'
    )
  })
})

describe('buildThreadGroups', () => {
  test('collapses a thread to one anchor and passes pending through', () => {
    const root = annotation({ id: 'c1', dispatchedAt: 1000, threadId: 'c1' })
    const reply = annotation({ id: 'g1', author: 'agent', threadId: 'c1' })
    const pending = annotation({ id: 'p1' })

    const { collapsed, groups } = buildThreadGroups(
      [root, reply, pending],
      LOCATION
    )

    expect(collapsed).toEqual([root, pending])
    expect(groups.get('c1')?.turns).toEqual([root, reply])
    expect(groups.get('c1')).toMatchObject(LOCATION)
  })

  test('two roots on one line stay two groups', () => {
    const { groups } = buildThreadGroups(
      [
        annotation({ id: 'c1', dispatchedAt: 1, threadId: 'c1' }),
        annotation({ id: 'c2', dispatchedAt: 2, threadId: 'c2' }),
      ],
      LOCATION
    )

    expect(groups.size).toBe(2)
  })

  test('resolved derives from the root comment', () => {
    const { groups } = buildThreadGroups(
      [
        annotation({
          id: 'c1',
          dispatchedAt: 1,
          threadId: 'c1',
          resolvedAt: 2000,
        }),
        annotation({ id: 'g1', author: 'agent', threadId: 'c1' }),
      ],
      LOCATION
    )

    expect(groups.get('c1')?.resolved).toBe(true)
    expect(groups.get('c1')?.rollup.label).toBe('Resolved')
  })
})

describe('threadRollup', () => {
  test('is total over the latest turn (full outcome matrix)', () => {
    const agent = (
      outcome?: ReviewComment['outcome']
    ): DiffLineAnnotation<ReviewComment> =>
      annotation({ id: 'g', author: 'agent', ...(outcome ? { outcome } : {}) })

    expect(threadRollup([agent('reply')], false).label).toBe('Replied')
    expect(threadRollup([agent('clarify')], false).label).toBe('Awaiting you')
    expect(threadRollup([agent('resolved')], false).label).toBe('Resolved')
    expect(threadRollup([agent('deferred')], false).label).toBe('Deferred')
    expect(threadRollup([agent('rejected')], false).label).toBe('Rejected')
    expect(threadRollup([agent()], false).label).toBe('Replied')
    expect(
      threadRollup(
        [agent('clarify'), annotation({ id: 'f', dispatchedAt: 3 })],
        false
      ).label
    ).toBe('Sent')

    expect(
      threadRollup([annotation({ id: 'r', author: 'reviewer' })], false).label
    ).toBe('Open')
    // Local resolve overrides every derived state.
    expect(threadRollup([agent('rejected')], true).label).toBe('Resolved')
  })

  test('non-agent states carry their THREAD_ROLLUP_META chip classes', () => {
    expect(
      threadRollup([annotation({ id: 'f', dispatchedAt: 3 })], false).chip
    ).toBe('text-primary')

    expect(
      threadRollup([annotation({ id: 'r', author: 'reviewer' })], false).chip
    ).toBe('text-on-surface-variant')

    expect(threadRollup([annotation({ id: 'c' })], true).chip).toBe(
      'text-success'
    )
  })
})

describe('threadAnchorLabel', () => {
  test('labels line, range, and file anchors', () => {
    expect(threadAnchorLabel(annotation({ id: 'a' }, 40))).toBe('line R40')
    expect(
      threadAnchorLabel(
        annotation({
          id: 'b',
          target: {
            scope: 'range',
            side: 'additions',
            startLine: 88,
            endLine: 94,
          },
        })
      )
    ).toBe('lines R88-R94')

    expect(
      threadAnchorLabel(
        annotation({
          id: 'b2',
          target: {
            scope: 'range',
            side: 'additions',
            startLine: 88,
            endLine: 88,
          },
        })
      )
    ).toBe('line R88')

    expect(
      threadAnchorLabel(annotation({ id: 'c', target: { scope: 'file' } }, 0))
    ).toBe('file')
  })
})
