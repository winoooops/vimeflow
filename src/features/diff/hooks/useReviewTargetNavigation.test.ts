import { act, renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { DiffLineAnnotation } from '@pierre/diffs'
import { useReviewTargetNavigation } from './useReviewTargetNavigation'
import type { FileDiff } from '../types'
import type { ReviewComment } from './useFeedbackBatch'

const fileDiff: FileDiff = {
  filePath: 'src/foo.ts',
  oldPath: 'src/foo.ts',
  newPath: 'src/foo.ts',
  hunks: [
    {
      id: 'hunk-0',
      header: '@@ -1,2 +1,2 @@',
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2,
      lines: [
        { type: 'context', oldLineNumber: 1, newLineNumber: 1, content: 'a' },
        { type: 'added', newLineNumber: 2, content: 'b' },
      ],
    },
  ],
}

const annotation: DiffLineAnnotation<ReviewComment> = {
  lineNumber: 2,
  side: 'additions',
  metadata: {
    id: 'comment-1',
    text: 'Check this',
    author: 'self',
    createdAt: 100,
  },
}

describe('useReviewTargetNavigation', () => {
  test('tracks one active review target for selection and comments', () => {
    const onHunkIndexChange = vi.fn()
    const clearTransientSelection = vi.fn()
    const scrollBodyRef = { current: document.createElement('div') }

    const { result, rerender } = renderHook(
      ({ fileKey }) =>
        useReviewTargetNavigation({
          annotations: [annotation],
          clearTransientSelection,
          diffStyle: 'split',
          fileDiff,
          fileKey,
          onHunkIndexChange,
          scrollBodyRef,
        }),
      { initialProps: { fileKey: 'src/foo.ts:unstaged' } }
    )

    expect(result.current.selectedLines).toBeNull()
    expect(result.current.currentTarget).toEqual({
      lineNumber: 1,
      side: 'additions',
      hunkIndex: 0,
      splitRowIndex: 0,
      changed: false,
    })
    expect(result.current.activeTarget).toBeNull()

    act(() => {
      result.current.activateTarget(1)
    })

    expect(result.current.selectedLines).toEqual({
      start: 2,
      end: 2,
      side: 'additions',
    })

    expect(result.current.activeTarget).toEqual({
      lineNumber: 2,
      side: 'additions',
      hunkIndex: 0,
      splitRowIndex: 1,
      changed: true,
    })
    expect(result.current.currentTargetComment).toEqual(annotation)

    expect(onHunkIndexChange).toHaveBeenCalledWith(0)
    expect(clearTransientSelection).toHaveBeenCalledOnce()

    rerender({ fileKey: 'src/bar.ts:unstaged' })

    expect(result.current.selectedLines).toBeNull()
    expect(result.current.activeTarget).toBeNull()
  })
})
