import { describe, test, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useFeedbackBatch,
  useFeedbackBatchStore,
  makeBatchKey,
  parseBatchKey,
  isAgentReviewAnnotation,
  isPendingReviewAnnotation,
  reviewCommentCategory,
} from './useFeedbackBatch'
import type { ReviewComment } from './useFeedbackBatch'
import type { DiffLineAnnotation } from '@pierre/diffs'

const makeAnnotation = (
  id: string,
  text = 'comment',
  lineNumber = 1,
  side: 'additions' | 'deletions' = 'additions'
): DiffLineAnnotation<ReviewComment> => ({
  side,
  lineNumber,
  metadata: {
    id,
    text,
    author: 'self',
    createdAt: 1000,
  },
})

describe('useFeedbackBatch', () => {
  test('empty initial state: totalAnnotations === 0 and annotationsForFile returns []', () => {
    const { result } = renderHook(() => useFeedbackBatch())

    expect(result.current.totalAnnotations()).toBe(0)
    expect(result.current.annotationsForFile('/r', 'a.ts', false)).toEqual([])
  })

  test('add one annotation: annotationsForFile returns it; totalAnnotations === 1', () => {
    const { result } = renderHook(() => useFeedbackBatch())
    const annotation = makeAnnotation('ann-1')

    act(() => {
      result.current.addAnnotation('/repo', 'src/a.ts', false, annotation)
    })

    expect(result.current.totalAnnotations()).toBe(1)
    const list = result.current.annotationsForFile('/repo', 'src/a.ts', false)
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual(annotation)
  })

  test('annotationsForFile returns STABLE reference for absent file across two calls', () => {
    const { result } = renderHook(() => useFeedbackBatch())

    const first = result.current.annotationsForFile(
      '/repo',
      'missing.ts',
      false
    )

    const second = result.current.annotationsForFile(
      '/repo',
      'missing.ts',
      false
    )

    // Both calls must return the exact same array object (module-level EMPTY)
    expect(first).toBe(second)
  })

  test('batched 51st addAnnotation returns cap-reached and totalAnnotations stays 50', () => {
    const { result } = renderHook(() => useFeedbackBatch())
    const returnValues: ('ok' | 'cap-reached')[] = []

    // Add 51 annotations in one React batch to exercise the stale-closure
    // window that can otherwise let the soft cap drift past 50.
    act(() => {
      for (let i = 0; i < 51; i++) {
        returnValues.push(
          result.current.addAnnotation(
            '/repo',
            `file-${i}.ts`,
            false,
            makeAnnotation(`id-${i}`, 'x', i + 1)
          )
        )
      }
    })

    expect(returnValues.slice(0, 50)).toEqual(Array(50).fill('ok'))
    expect(returnValues[50]).toBe('cap-reached')
    expect(result.current.totalAnnotations()).toBe(50)
  })

  test('agent replies bypass the pending soft cap', () => {
    const { result } = renderHook(() => useFeedbackBatch())

    act(() => {
      for (let i = 0; i < 50; i++) {
        result.current.addAnnotation(
          '/repo',
          `file-${i}.ts`,
          false,
          makeAnnotation(`id-${i}`, 'x', i + 1)
        )
      }
    })

    let addResult: 'ok' | 'cap-reached' = 'cap-reached'
    act(() => {
      addResult = result.current.addAnnotation('/repo', 'reply.ts', false, {
        side: 'additions',
        lineNumber: 1,
        metadata: {
          id: 'agent-1',
          text: 'reply',
          author: 'agent',
          createdAt: 1000,
        },
      })
    })

    expect(addResult).toBe('ok')
    expect(result.current.totalAnnotations()).toBe(51)
    expect(result.current.pendingAnnotations()).toBe(50)
  })

  test('dispatched comments do not count against the pending soft cap', () => {
    const { result } = renderHook(() => useFeedbackBatch())
    const dispatchedIds = new Set<string>()

    act(() => {
      for (let i = 0; i < 50; i++) {
        const id = `sent-${i}`
        dispatchedIds.add(id)
        result.current.addAnnotation(
          '/repo',
          `file-${i}.ts`,
          false,
          makeAnnotation(id, 'x', i + 1)
        )
      }
    })

    act(() => {
      result.current.markDispatched(4242, dispatchedIds)
    })

    let addResult: 'ok' | 'cap-reached' = 'cap-reached'
    act(() => {
      addResult = result.current.addAnnotation(
        '/repo',
        'next.ts',
        false,
        makeAnnotation('next')
      )
    })

    expect(addResult).toBe('ok')
    expect(result.current.totalAnnotations()).toBe(51)
    expect(result.current.pendingAnnotations()).toBe(1)
  })

  test('updateAnnotation patches text; preserves createdAt, author, side, lineNumber', () => {
    const { result } = renderHook(() => useFeedbackBatch())

    const original = makeAnnotation('upd-1', 'original text', 5, 'deletions')

    act(() => {
      result.current.addAnnotation('/repo', 'b.ts', false, original)
    })

    act(() => {
      result.current.updateAnnotation('/repo', 'b.ts', false, 'upd-1', {
        text: 'updated text',
      })
    })

    const [updated] = result.current.annotationsForFile('/repo', 'b.ts', false)
    expect(updated.metadata.text).toBe('updated text')
    expect(updated.metadata.createdAt).toBe(1000)
    expect(updated.metadata.author).toBe('self')
    expect(updated.side).toBe('deletions')
    expect(updated.lineNumber).toBe(5)
  })

  test('remove the only annotation for a file deletes the Map key entirely', () => {
    const { result } = renderHook(() => useFeedbackBatch())
    const cwd = '/repo'
    const filePath = 'solo.ts'
    const key = makeBatchKey(cwd, filePath, false)

    act(() => {
      result.current.addAnnotation(
        cwd,
        filePath,
        false,
        makeAnnotation('solo-1')
      )
    })

    expect(result.current.batch.has(key)).toBe(true)

    act(() => {
      result.current.removeAnnotation(cwd, filePath, false, 'solo-1')
    })

    expect(result.current.batch.has(key)).toBe(false)
  })

  test('remove one of two annotations leaves key with list length 1', () => {
    const { result } = renderHook(() => useFeedbackBatch())
    const cwd = '/repo'
    const filePath = 'duo.ts'

    act(() => {
      result.current.addAnnotation(
        cwd,
        filePath,
        false,
        makeAnnotation('duo-1', 'first', 1)
      )

      result.current.addAnnotation(
        cwd,
        filePath,
        false,
        makeAnnotation('duo-2', 'second', 2)
      )
    })

    act(() => {
      result.current.removeAnnotation(cwd, filePath, false, 'duo-1')
    })

    const list = result.current.annotationsForFile(cwd, filePath, false)
    expect(list).toHaveLength(1)
    expect(list[0].metadata.id).toBe('duo-2')
    expect(result.current.batch.has(makeBatchKey(cwd, filePath, false))).toBe(
      true
    )
  })

  test('clearBatch empties the Map', () => {
    const { result } = renderHook(() => useFeedbackBatch())

    act(() => {
      result.current.addAnnotation(
        '/repo',
        'a.ts',
        false,
        makeAnnotation('c-1')
      )

      result.current.addAnnotation(
        '/repo',
        'b.ts',
        false,
        makeAnnotation('c-2')
      )
    })

    expect(result.current.totalAnnotations()).toBe(2)

    act(() => {
      result.current.clearBatch()
    })

    expect(result.current.totalAnnotations()).toBe(0)
    expect(result.current.batch.size).toBe(0)
  })

  test('markDispatched stamps pending comments and keeps them in the batch', () => {
    const { result } = renderHook(() => useFeedbackBatch())

    act(() => {
      result.current.addAnnotation(
        '/repo',
        'a.ts',
        false,
        makeAnnotation('m-1')
      )

      result.current.addAnnotation(
        '/repo',
        'b.ts',
        false,
        makeAnnotation('m-2')
      )
    })

    expect(result.current.pendingAnnotations()).toBe(2)

    act(() => {
      result.current.markDispatched(4242, new Set(['m-1', 'm-2']))
    })

    // Comments persist as thread anchors, but none are pending anymore.
    expect(result.current.totalAnnotations()).toBe(2)
    expect(result.current.pendingAnnotations()).toBe(0)
    expect(
      result.current.annotationsForFile('/repo', 'a.ts', false)[0].metadata
        .dispatchedAt
    ).toBe(4242)
  })

  test('markDispatched leaves already-dispatched comments untouched', () => {
    const { result } = renderHook(() => useFeedbackBatch())

    act(() => {
      result.current.addAnnotation(
        '/repo',
        'a.ts',
        false,
        makeAnnotation('first')
      )
    })

    act(() => {
      result.current.markDispatched(100, new Set(['first']))
    })

    act(() => {
      result.current.addAnnotation(
        '/repo',
        'a.ts',
        false,
        makeAnnotation('second')
      )
    })

    act(() => {
      result.current.markDispatched(200, new Set(['second']))
    })

    const [first, second] = result.current.annotationsForFile(
      '/repo',
      'a.ts',
      false
    )
    expect(first.metadata.dispatchedAt).toBe(100)
    expect(second.metadata.dispatchedAt).toBe(200)
  })

  test('markDispatched stamps only the dispatched snapshot ids', () => {
    const { result } = renderHook(() => useFeedbackBatch())

    act(() => {
      result.current.addAnnotation(
        '/repo',
        'a.ts',
        false,
        makeAnnotation('sent')
      )

      result.current.addAnnotation(
        '/repo',
        'a.ts',
        false,
        makeAnnotation('late')
      )
    })

    act(() => {
      result.current.markDispatched(100, new Set(['sent']))
    })

    const [sent, late] = result.current.annotationsForFile(
      '/repo',
      'a.ts',
      false
    )
    expect(sent.metadata.dispatchedAt).toBe(100)
    expect(late.metadata.dispatchedAt).toBeUndefined()
    expect(result.current.pendingAnnotations()).toBe(1)
  })

  test('clearPending drops pending comments but keeps dispatched thread anchors', () => {
    const { result } = renderHook(() => useFeedbackBatch())

    act(() => {
      result.current.addAnnotation(
        '/repo',
        'a.ts',
        false,
        makeAnnotation('kept')
      )
    })

    act(() => {
      result.current.markDispatched(100, new Set(['kept']))
    })

    act(() => {
      result.current.addAnnotation(
        '/repo',
        'a.ts',
        false,
        makeAnnotation('dropped')
      )
    })

    expect(result.current.totalAnnotations()).toBe(2)

    act(() => {
      result.current.clearPending()
    })

    const list = result.current.annotationsForFile('/repo', 'a.ts', false)
    expect(list).toHaveLength(1)
    expect(list[0].metadata.id).toBe('kept')
    expect(result.current.pendingAnnotations()).toBe(0)
  })

  test('clearPending removes the file key when only pending comments existed', () => {
    const { result } = renderHook(() => useFeedbackBatch())
    const key = makeBatchKey('/repo', 'a.ts', false)

    act(() => {
      result.current.addAnnotation(
        '/repo',
        'a.ts',
        false,
        makeAnnotation('p-1')
      )
    })

    expect(result.current.batch.has(key)).toBe(true)

    act(() => {
      result.current.clearPending()
    })

    expect(result.current.batch.has(key)).toBe(false)
    expect(result.current.totalAnnotations()).toBe(0)
  })

  test('clearBatch identity is stable across a re-render (add does not change clearBatch ref)', () => {
    const { result } = renderHook(() => useFeedbackBatch())

    // Capture clearBatch before any state change
    const clearBatchBefore = result.current.clearBatch

    // Trigger a state change via add — batch updates, so many callbacks change
    act(() => {
      result.current.addAnnotation(
        '/repo',
        'a.ts',
        false,
        makeAnnotation('stab-1')
      )
    })

    // clearBatch must be the same function reference ([] dep array)
    expect(result.current.clearBatch).toBe(clearBatchBefore)
  })

  test('staged and unstaged annotations for the same path are stored separately', () => {
    const { result } = renderHook(() => useFeedbackBatch())
    const stagedAnnotation = makeAnnotation('staged-1', 'staged comment')
    const unstagedAnnotation = makeAnnotation('unstaged-1', 'unstaged comment')

    act(() => {
      result.current.addAnnotation('/repo', 'x.ts', true, stagedAnnotation)
      result.current.addAnnotation('/repo', 'x.ts', false, unstagedAnnotation)
    })

    const stagedList = result.current.annotationsForFile('/repo', 'x.ts', true)

    const unstagedList = result.current.annotationsForFile(
      '/repo',
      'x.ts',
      false
    )

    expect(stagedList).toHaveLength(1)
    expect(stagedList[0].metadata.text).toBe('staged comment')
    expect(unstagedList).toHaveLength(1)
    expect(unstagedList[0].metadata.text).toBe('unstaged comment')
  })

  test('makeBatchKey / parseBatchKey round-trip — including a cwd containing "::"', () => {
    const cases = [
      { cwd: '/repo/a', filePath: 'src/x.ts', staged: true },
      { cwd: '/repo/a', filePath: 'src/x.ts', staged: false },
      // A cwd containing the old "::" separator must still round-trip; the NUL
      // separator can't appear in a path, so it parses unambiguously.
      { cwd: '/home/user::special/p', filePath: 'src/y.ts', staged: false },
    ]

    for (const expected of cases) {
      const key = makeBatchKey(expected.cwd, expected.filePath, expected.staged)
      expect(parseBatchKey(key)).toEqual(expected)
    }
  })
})

describe('useFeedbackBatchStore', () => {
  test('addAnnotationForOwner targets a specific owner, not the active one', () => {
    const { result, rerender } = renderHook(
      ({ ownerKey, cwd }) => useFeedbackBatchStore(ownerKey, cwd),
      { initialProps: { ownerKey: 'sess:p0', cwd: '/repo' } }
    )

    act(() => {
      result.current.feedbackBatch.addAnnotationForOwner(
        'sess:p0',
        '/repo',
        'a.ts',
        false,
        makeAnnotation('reply-1')
      )
    })

    // Switch the active owner away and back — the annotation stayed on sess:p0.
    rerender({ ownerKey: 'sess:p1', cwd: '/repo' })
    rerender({ ownerKey: 'sess:p0', cwd: '/repo' })

    expect(
      result.current.feedbackBatch.annotationsForFile('/repo', 'a.ts', false)
    ).toHaveLength(1)
  })

  test('stores unfinished reviews separately per owner key', () => {
    const { result, rerender } = renderHook(
      ({ ownerKey, cwd }) => useFeedbackBatchStore(ownerKey, cwd),
      { initialProps: { ownerKey: 'session-a:p0', cwd: '/repo-a' } }
    )

    act(() => {
      result.current.feedbackBatch.addAnnotation(
        '/repo-a',
        'src/a.ts',
        false,
        makeAnnotation('owner-a')
      )
    })

    expect(result.current.feedbackBatch.totalAnnotations()).toBe(1)
    rerender({ ownerKey: 'session-b:p0', cwd: '/repo-b' })

    expect(result.current.feedbackBatch.totalAnnotations()).toBe(0)

    act(() => {
      result.current.feedbackBatch.addAnnotation(
        '/repo-b',
        'src/b.ts',
        false,
        makeAnnotation('owner-b')
      )
    })

    expect(result.current.feedbackBatch.totalAnnotations()).toBe(1)
    rerender({ ownerKey: 'session-a:p0', cwd: '/repo-a' })

    expect(result.current.feedbackBatch.totalAnnotations()).toBe(1)
    expect(
      result.current.feedbackBatch.annotationsForFile(
        '/repo-a',
        'src/a.ts',
        false
      )[0].metadata.id
    ).toBe('owner-a')
  })

  test('keeps an owner batch when the same terminal changes cwd', () => {
    const { result, rerender } = renderHook(
      ({ cwd }) => useFeedbackBatchStore('session-a:p0', cwd),
      { initialProps: { cwd: '/repo-a' } }
    )

    act(() => {
      result.current.feedbackBatch.addAnnotation(
        '/repo-a',
        'src/a.ts',
        false,
        makeAnnotation('cwd-a')
      )
    })

    rerender({ cwd: '/repo-b' })

    expect(result.current.feedbackBatch.totalAnnotations()).toBe(1)
    expect(
      result.current.feedbackBatch.annotationsForFile(
        '/repo-a',
        'src/a.ts',
        false
      )[0].metadata.id
    ).toBe('cwd-a')
  })

  test('tracks repo roots per owner and cwd', () => {
    const { result, rerender } = renderHook(
      ({ ownerKey, cwd }) => useFeedbackBatchStore(ownerKey, cwd),
      { initialProps: { ownerKey: 'session-a:p0', cwd: '/repo-a' } }
    )

    act(() => {
      result.current.feedbackRepoRootRef.current = '/repo-a-root'
    })

    rerender({ ownerKey: 'session-a:p0', cwd: '/repo-b' })

    expect(result.current.feedbackRepoRootRef.current).toBe('')

    act(() => {
      result.current.feedbackRepoRootRef.current = '/repo-b-root'
    })

    expect(result.current.feedbackRepoRootRef.repoRootForCwd('/repo-a')).toBe(
      '/repo-a-root'
    )

    expect(result.current.feedbackRepoRootRef.repoRootForCwd('/repo-b')).toBe(
      '/repo-b-root'
    )

    rerender({ ownerKey: 'session-b:p0', cwd: '/repo-a' })

    expect(result.current.feedbackRepoRootRef.current).toBe('')
  })

  test('prunes batches and repo roots for closed owners', () => {
    const { result, rerender } = renderHook(
      ({ ownerKey, cwd }) => useFeedbackBatchStore(ownerKey, cwd),
      { initialProps: { ownerKey: 'session-a:p0', cwd: '/repo-a' } }
    )

    act(() => {
      result.current.feedbackBatch.addAnnotation(
        '/repo-a',
        'src/a.ts',
        false,
        makeAnnotation('owner-a')
      )
      result.current.feedbackRepoRootRef.current = '/repo-a-root'
    })

    rerender({ ownerKey: 'session-b:p0', cwd: '/repo-b' })

    act(() => {
      result.current.feedbackBatch.addAnnotation(
        '/repo-b',
        'src/b.ts',
        false,
        makeAnnotation('owner-b')
      )
      result.current.feedbackRepoRootRef.current = '/repo-b-root'
    })

    expect(result.current.summaries.map((summary) => summary.ownerKey)).toEqual(
      ['session-a:p0', 'session-b:p0']
    )

    act(() => {
      result.current.pruneOwners(new Set(['session-b:p0']))
    })

    expect(result.current.summaries.map((summary) => summary.ownerKey)).toEqual(
      ['session-b:p0']
    )

    rerender({ ownerKey: 'session-a:p0', cwd: '/repo-a' })

    expect(result.current.feedbackBatch.totalAnnotations()).toBe(0)
    expect(result.current.feedbackRepoRootRef.current).toBe('')
  })

  test('stores comment drafts separately per owner key', () => {
    const { result, rerender } = renderHook(
      ({ ownerKey, cwd }) => useFeedbackBatchStore(ownerKey, cwd),
      { initialProps: { ownerKey: 'session-a:p0', cwd: '/repo-a' } }
    )

    act(() => {
      result.current.feedbackDraft.setDraft({
        cwd: '/repo-a',
        filePath: 'src/a.ts',
        staged: false,
        side: 'additions',
        lineNumber: 7,
        text: 'draft a',
      })
    })

    rerender({ ownerKey: 'session-b:p0', cwd: '/repo-b' })

    expect(result.current.feedbackDraft.draft).toBeNull()

    act(() => {
      result.current.feedbackDraft.setDraft({
        cwd: '/repo-b',
        filePath: 'src/b.ts',
        staged: true,
        side: 'deletions',
        lineNumber: 3,
        text: 'draft b',
      })
    })

    expect(result.current.feedbackDraft.draft?.text).toBe('draft b')

    rerender({ ownerKey: 'session-a:p0', cwd: '/repo-a' })

    expect(result.current.feedbackDraft.draft).toEqual({
      cwd: '/repo-a',
      filePath: 'src/a.ts',
      staged: false,
      side: 'additions',
      lineNumber: 7,
      text: 'draft a',
    })
  })

  test('summaries include draft-only unfinished reviews', () => {
    const { result } = renderHook(() =>
      useFeedbackBatchStore('session-a:p0', '/repo-a')
    )

    act(() => {
      result.current.feedbackDraft.setDraft({
        cwd: '/repo-a',
        filePath: 'src/a.ts',
        staged: false,
        side: 'additions',
        lineNumber: 7,
        text: 'draft a',
      })
    })

    expect(result.current.summaries).toEqual([
      {
        ownerKey: 'session-a:p0',
        fileCount: 1,
        commentCount: 0,
        draftCount: 1,
      },
    ])
  })

  test('clearBatch clears the current owner draft', () => {
    const { result } = renderHook(() =>
      useFeedbackBatchStore('session-a:p0', '/repo-a')
    )

    act(() => {
      result.current.feedbackDraft.setDraft({
        cwd: '/repo-a',
        filePath: 'src/a.ts',
        staged: false,
        side: 'additions',
        lineNumber: 7,
        text: 'draft a',
      })

      result.current.feedbackBatch.addAnnotation(
        '/repo-a',
        'src/a.ts',
        false,
        makeAnnotation('owner-a')
      )
    })

    expect(result.current.feedbackDraft.draft?.text).toBe('draft a')

    act(() => {
      result.current.feedbackBatch.clearBatch()
    })

    expect(result.current.feedbackDraft.draft).toBeNull()
    expect(result.current.feedbackBatch.totalAnnotations()).toBe(0)
  })

  test('markDispatched keeps the comment but clears the owner draft', () => {
    const { result } = renderHook(() =>
      useFeedbackBatchStore('session-a:p0', '/repo-a')
    )

    act(() => {
      result.current.feedbackDraft.setDraft({
        cwd: '/repo-a',
        filePath: 'src/a.ts',
        staged: false,
        side: 'additions',
        lineNumber: 7,
        text: 'draft a',
      })

      result.current.feedbackBatch.addAnnotation(
        '/repo-a',
        'src/a.ts',
        false,
        makeAnnotation('owner-a')
      )
    })

    act(() => {
      result.current.feedbackBatch.markDispatched(999, new Set(['owner-a']))
    })

    expect(result.current.feedbackDraft.draft).toBeNull()
    // The dispatched comment stays in the hunk as a thread anchor.
    expect(result.current.feedbackBatch.totalAnnotations()).toBe(1)
    expect(result.current.feedbackBatch.pendingAnnotations()).toBe(0)
  })

  test('a fully dispatched owner drops out of unfinished-review summaries', () => {
    const { result } = renderHook(() =>
      useFeedbackBatchStore('session-a:p0', '/repo-a')
    )

    act(() => {
      result.current.feedbackBatch.addAnnotation(
        '/repo-a',
        'src/a.ts',
        false,
        makeAnnotation('owner-a')
      )
    })

    expect(result.current.summaries).toHaveLength(1)

    act(() => {
      result.current.feedbackBatch.markDispatched(1, new Set(['owner-a']))
    })

    // The comment still renders in the hunk, but it is no longer "unfinished".
    expect(result.current.summaries).toEqual([])
    expect(
      result.current.feedbackBatch.annotationsForFile(
        '/repo-a',
        'src/a.ts',
        false
      )
    ).toHaveLength(1)
  })

  test('prunes drafts for closed owners', () => {
    const { result, rerender } = renderHook(
      ({ ownerKey, cwd }) => useFeedbackBatchStore(ownerKey, cwd),
      { initialProps: { ownerKey: 'session-a:p0', cwd: '/repo-a' } }
    )

    act(() => {
      result.current.feedbackDraft.setDraft({
        cwd: '/repo-a',
        filePath: 'src/a.ts',
        staged: false,
        side: 'additions',
        lineNumber: 7,
        text: 'draft a',
      })
    })

    rerender({ ownerKey: 'session-b:p0', cwd: '/repo-b' })

    act(() => {
      result.current.feedbackDraft.setDraft({
        cwd: '/repo-b',
        filePath: 'src/b.ts',
        staged: false,
        side: 'additions',
        lineNumber: 3,
        text: 'draft b',
      })
      result.current.pruneOwners(new Set(['session-b:p0']))
    })

    rerender({ ownerKey: 'session-a:p0', cwd: '/repo-a' })

    expect(result.current.feedbackDraft.draft).toBeNull()

    rerender({ ownerKey: 'session-b:p0', cwd: '/repo-b' })

    expect(result.current.feedbackDraft.draft?.text).toBe('draft b')
  })
})

describe('review annotation category + agent predicates (VIM-256)', () => {
  const annotation = (
    overrides: Partial<ReviewComment>
  ): DiffLineAnnotation<ReviewComment> => ({
    side: 'additions',
    lineNumber: 1,
    metadata: {
      id: 'x',
      text: 't',
      author: 'self',
      createdAt: 1,
      ...overrides,
    },
  })

  test('isAgentReviewAnnotation is true only for agent-authored comments', () => {
    expect(isAgentReviewAnnotation(annotation({ author: 'agent' }))).toBe(true)
    expect(isAgentReviewAnnotation(annotation({ author: 'self' }))).toBe(false)
  })

  test('an agent reply is never pending, even without a dispatchedAt', () => {
    expect(isPendingReviewAnnotation(annotation({ author: 'agent' }))).toBe(
      false
    )
    expect(isPendingReviewAnnotation(annotation({ author: 'self' }))).toBe(true)
  })

  test('reviewCommentCategory defaults an untagged comment to change', () => {
    expect(
      reviewCommentCategory({
        id: 'x',
        text: 't',
        author: 'self',
        createdAt: 1,
      })
    ).toBe('change')

    expect(
      reviewCommentCategory({
        id: 'x',
        text: 't',
        author: 'self',
        createdAt: 1,
        category: 'question',
      })
    ).toBe('question')
  })

  test('an agent annotation in the batch is not counted as pending', () => {
    const { result } = renderHook(() => useFeedbackBatch())

    act(() => {
      result.current.addAnnotation(
        '/repo',
        'a.ts',
        false,
        makeAnnotation('user-1')
      )

      result.current.addAnnotation('/repo', 'a.ts', false, {
        side: 'additions',
        lineNumber: 2,
        metadata: {
          id: 'agent-1',
          text: 'reply',
          author: 'agent',
          createdAt: 1,
        },
      })
    })

    expect(result.current.totalAnnotations()).toBe(2)
    // Only the user comment is pending; the agent reply is excluded.
    expect(result.current.pendingAnnotations()).toBe(1)
  })
})
