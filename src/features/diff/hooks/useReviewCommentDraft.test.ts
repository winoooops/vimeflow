import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { FileDiff } from '../types'
import {
  DRAFT_ID,
  type FeedbackDraft,
  type ReviewComment,
} from './useFeedbackBatch'
import {
  isSameAnnotationTarget,
  useReviewCommentDraft,
  type AnnotationTarget,
  type UseReviewCommentDraftReturn,
} from './useReviewCommentDraft'

const fileDiff: FileDiff = {
  filePath: 'src/foo.ts',
  oldPath: 'src/foo.ts',
  newPath: 'src/foo.ts',
  hunks: [
    {
      id: 'hunk-0',
      header: '@@ -1,3 +1,3 @@',
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
      lines: [
        { type: 'context', content: 'alpha' },
        { type: 'added', content: 'beta' },
        { type: 'context', content: 'gamma' },
      ],
    },
  ],
}

const existingAnnotation: DiffLineAnnotation<ReviewComment> = {
  side: 'additions',
  lineNumber: 3,
  metadata: {
    id: 'comment-1',
    text: 'Existing',
    author: 'self',
    createdAt: 1,
  },
}

const target: AnnotationTarget = {
  lineNumber: 2,
  side: 'additions',
  filePath: 'src/foo.ts',
  staged: false,
}

const fileTarget: AnnotationTarget = {
  scope: 'file',
  filePath: 'src/foo.ts',
  staged: false,
}

interface DraftHookRender {
  result: {
    current: UseReviewCommentDraftReturn & { draft: FeedbackDraft | null }
  }
}

const renderDraftHook = (
  initialDraft: FeedbackDraft | null = null
): DraftHookRender =>
  renderHook(() => {
    const [draft, setDraft] = useState<FeedbackDraft | null>(initialDraft)

    const state = useReviewCommentDraft({
      cwd: '/repo',
      feedbackDraft: { draft, setDraft },
      selectedFilePath: 'src/foo.ts',
      selectedFileStaged: false,
      activeFileDiff: fileDiff,
      realAnnotations: [existingAnnotation],
      focusDiffRoot: vi.fn(),
    })

    return { ...state, draft }
  })

describe('useReviewCommentDraft', () => {
  test('stores annotation target and draft text in the provided draft store', () => {
    const { result } = renderDraftHook()

    act(() => {
      result.current.setAnnotationTarget(target, false)
    })

    expect(result.current.draft).toMatchObject({
      cwd: '/repo',
      filePath: 'src/foo.ts',
      staged: false,
      side: 'additions',
      lineNumber: 2,
      text: '',
    })

    act(() => {
      result.current.setCommentDraftText('Please update this', false)
    })

    expect(result.current.commentDraftText).toBe('Please update this')
    expect(result.current.draft?.text).toBe('Please update this')
  })

  test('restores an existing draft into target state and draft text', () => {
    const { result } = renderDraftHook({
      cwd: '/repo',
      filePath: 'src/foo.ts',
      staged: false,
      side: 'additions',
      lineNumber: 2,
      text: 'Restored text',
    })

    expect(result.current.annotationTarget).toMatchObject(target)
    expect(result.current.commentDraftText).toBe('Restored text')
  })

  test('clears a stored draft that belongs to another cwd', async () => {
    const setDraft = vi.fn()

    renderHook(() =>
      useReviewCommentDraft({
        cwd: '/repo',
        feedbackDraft: {
          draft: {
            cwd: '/other',
            filePath: 'src/foo.ts',
            staged: false,
            side: 'additions',
            lineNumber: 2,
            text: 'Wrong repo',
          },
          setDraft,
        },
        selectedFilePath: 'src/foo.ts',
        selectedFileStaged: false,
        activeFileDiff: fileDiff,
        realAnnotations: [],
        focusDiffRoot: vi.fn(),
      })
    )

    await waitFor(() => {
      expect(setDraft).toHaveBeenCalledWith(null)
    })
  })

  test('treats parent-provided null draft as authoritative', async () => {
    const setDraft = vi.fn()

    const { result, rerender } = renderHook(
      ({ controlled }: { controlled: boolean }) =>
        useReviewCommentDraft({
          cwd: '/repo',
          feedbackDraft: controlled ? { draft: null, setDraft } : undefined,
          selectedFilePath: 'src/foo.ts',
          selectedFileStaged: false,
          activeFileDiff: fileDiff,
          realAnnotations: [],
          focusDiffRoot: vi.fn(),
        }),
      {
        initialProps: { controlled: false },
      }
    )

    act(() => {
      result.current.setAnnotationTarget(target, false)
      result.current.setCommentDraftText('Local draft', false)
    })

    expect(result.current.commentDraftText).toBe('Local draft')

    rerender({ controlled: true })

    await waitFor(() => {
      expect(result.current.annotationTarget).toBeNull()
    })
    expect(result.current.commentDraftText).toBe('')
  })

  test('adds a transient draft annotation only for a current-file new comment', () => {
    const { result } = renderDraftHook()

    act(() => {
      result.current.setAnnotationTarget(target, false)
    })

    expect(result.current.lineAnnotations).toHaveLength(2)
    expect(result.current.lineAnnotations[1]?.metadata.id).toBe(DRAFT_ID)
  })

  test('keeps range drafts current only when both endpoints exist', () => {
    const { result } = renderDraftHook()

    act(() => {
      result.current.setAnnotationTarget(
        { ...target, lineNumber: 1, rangeEndLine: 3 },
        false
      )
      result.current.setCommentDraftText('Range draft', false)
    })

    expect(result.current.annotationTargetLineExists).toBe(true)
    expect(result.current.commentDraftIsRecoverable).toBe(false)
    expect(result.current.lineAnnotations).toHaveLength(2)
    expect(result.current.lineAnnotations[1]?.metadata).toMatchObject({
      id: DRAFT_ID,
      target: {
        scope: 'range',
        side: 'additions',
        startLine: 1,
        endLine: 3,
      },
    })
    // The draft anchors at the range's LAST line so the editor renders below the
    // selection (VIM-273); the span stays in target.
    expect(result.current.lineAnnotations[1]?.lineNumber).toBe(3)
  })

  test('treats a range draft as stale when the end line is missing', () => {
    const { result } = renderDraftHook()

    act(() => {
      result.current.setAnnotationTarget(
        { ...target, lineNumber: 1, rangeEndLine: 20 },
        false
      )
      result.current.setCommentDraftText('Range draft', false)
    })

    expect(result.current.annotationTargetLineExists).toBe(false)
    expect(result.current.commentDraftIsRecoverable).toBe(true)
    expect(result.current.lineAnnotations).toEqual([existingAnnotation])
  })

  test('stores file-level drafts without creating a Pierre line annotation', () => {
    const { result } = renderDraftHook()

    act(() => {
      result.current.setAnnotationTarget(fileTarget, false)
    })

    expect(result.current.draft).toEqual({
      cwd: '/repo',
      filePath: 'src/foo.ts',
      staged: false,
      scope: 'file',
      text: '',
      category: 'change',
    })
    expect(result.current.lineAnnotations).toEqual([existingAnnotation])
  })

  test('setCommentCategory persists the category into the draft (VIM-256)', () => {
    const { result } = renderDraftHook()

    act(() => {
      result.current.setAnnotationTarget(target, false)
      result.current.setCommentCategory('question')
    })

    expect(result.current.commentCategory).toBe('question')
    expect(result.current.draft?.category).toBe('question')
  })

  test('closeCommentDraft resets the next draft to the default category', () => {
    const { result } = renderDraftHook()

    act(() => {
      result.current.setAnnotationTarget(target, false)
      result.current.setCommentCategory('question')
      result.current.closeCommentDraft(false)
      result.current.setAnnotationTarget(fileTarget, false)
    })

    expect(result.current.commentCategory).toBe('change')
    expect(result.current.draft?.category).toBe('change')
  })

  test('restores the category from a stored draft (survives a restore)', () => {
    const { result } = renderDraftHook({
      cwd: '/repo',
      filePath: 'src/foo.ts',
      staged: false,
      side: 'additions',
      lineNumber: 2,
      text: 'Restored text',
      category: 'bug',
    })

    expect(result.current.commentCategory).toBe('bug')
  })

  test('compares target identity by file, side, line, staged state, and edit id', () => {
    expect(isSameAnnotationTarget(target, { ...target })).toBe(true)
    expect(
      isSameAnnotationTarget(target, {
        ...target,
        editId: 'comment-1',
      })
    ).toBe(false)
    expect(isSameAnnotationTarget(fileTarget, target)).toBe(false)
  })
})
