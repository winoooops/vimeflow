import { describe, test, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useFeedbackBatch,
  makeBatchKey,
  parseBatchKey,
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
