/**
 * Owns the open inline-review editor for the diff panel.
 *
 * The submitted comments live in `useFeedbackBatch`; this hook only manages the
 * active draft comment and where that editor should appear. It translates the
 * persisted draft shape into the UI's annotation target, restores that draft
 * when a pane/dock remounts, clears drafts that belong to another cwd, and
 * injects Pierre's temporary draft annotation so the editor renders inline.
 *
 * Keeping this here leaves DiffPanelContent responsible for rendering and user
 * commands, while this hook owns the draft storage and recovery rules.
 */
import {
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { AnnotationSide, DiffLineAnnotation } from '@pierre/diffs'
import type { FileDiff } from '../types'
import {
  DRAFT_ID,
  type FeedbackDraft,
  type FeedbackDraftStore,
  type ReviewComment,
} from './useFeedbackBatch'

interface LineAnnotationTarget {
  lineNumber: number
  side: AnnotationSide
  filePath: string
  staged: boolean
  scope?: 'line'
  rangeEndLine?: number
  editId?: string
}

interface FileAnnotationTarget {
  scope: 'file'
  filePath: string
  staged: boolean
  editId?: string
}

export type AnnotationTarget = LineAnnotationTarget | FileAnnotationTarget

export const isFileAnnotationTarget = (
  target: AnnotationTarget
): target is FileAnnotationTarget => target.scope === 'file'

interface UseReviewCommentDraftArgs {
  cwd: string
  feedbackDraft?: FeedbackDraftStore
  selectedFilePath: string | null
  selectedFileStaged: boolean
  activeFileDiff: FileDiff | null
  realAnnotations: DiffLineAnnotation<ReviewComment>[]
  focusDiffRoot: () => void
}

export interface UseReviewCommentDraftReturn {
  annotationTarget: AnnotationTarget | null
  commentDraftText: string
  annotationTargetIsCurrentFile: boolean
  annotationTargetLineExists: boolean
  commentDraftIsRecoverable: boolean
  lineAnnotations: DiffLineAnnotation<ReviewComment>[]
  setAnnotationTarget: (
    next: SetStateAction<AnnotationTarget | null>,
    focusDiff?: boolean
  ) => void
  setCommentDraftText: (
    next: SetStateAction<string>,
    focusDiff?: boolean
  ) => void
  closeCommentDraft: (focusDiff?: boolean) => void
}

const resolveStateAction = <T>(next: SetStateAction<T>, current: T): T =>
  typeof next === 'function' ? (next as (value: T) => T)(current) : next

// Persisted drafts use the storage model; the renderer wants an annotation
// target. Keep that translation in one place so component code stays declarative.
const draftToAnnotationTarget = (draft: FeedbackDraft): AnnotationTarget => {
  if (draft.scope === 'file') {
    const target: AnnotationTarget = {
      scope: 'file',
      filePath: draft.filePath,
      staged: draft.staged,
    }

    if (draft.editId !== undefined) {
      target.editId = draft.editId
    }

    return target
  }

  const target: AnnotationTarget = {
    lineNumber: draft.lineNumber,
    side: draft.side,
    filePath: draft.filePath,
    staged: draft.staged,
  }

  if (draft.rangeEndLine !== undefined) {
    target.rangeEndLine = draft.rangeEndLine
  }

  if (draft.editId !== undefined) {
    target.editId = draft.editId
  }

  return target
}

const annotationTargetToDraft = (
  cwd: string,
  target: AnnotationTarget,
  text: string
): FeedbackDraft => {
  if (isFileAnnotationTarget(target)) {
    const draft: FeedbackDraft = {
      cwd,
      filePath: target.filePath,
      staged: target.staged,
      scope: 'file',
      text,
    }

    if (target.editId !== undefined) {
      draft.editId = target.editId
    }

    return draft
  }

  const draft: FeedbackDraft = {
    cwd,
    filePath: target.filePath,
    staged: target.staged,
    side: target.side,
    lineNumber: target.lineNumber,
    text,
  }

  if (target.rangeEndLine !== undefined) {
    draft.rangeEndLine = target.rangeEndLine
  }

  if (target.editId !== undefined) {
    draft.editId = target.editId
  }

  return draft
}

// This is intentionally not object identity: callers rebuild target objects
// from keyboard navigation, gutter hover, and restored drafts.
const annotationTargetKey = (target: AnnotationTarget): string => {
  if (isFileAnnotationTarget(target)) {
    return `${target.filePath}:${target.staged}:file:${
      target.editId ?? 'draft'
    }`
  }

  return `${target.filePath}:${target.staged}:line:${target.side}:${
    target.lineNumber
  }:${target.rangeEndLine ?? target.lineNumber}:${target.editId ?? 'draft'}`
}

export const isSameAnnotationTarget = (
  left: AnnotationTarget,
  right: AnnotationTarget
): boolean => annotationTargetKey(left) === annotationTargetKey(right)

const diffContainsAnnotationTarget = (
  fileDiff: FileDiff,
  target: AnnotationTarget
): boolean => {
  if (isFileAnnotationTarget(target)) {
    return true
  }

  for (const hunk of fileDiff.hunks) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart

    for (const line of hunk.lines) {
      const oldLineNumber =
        line.oldLineNumber ?? (line.type === 'added' ? undefined : oldLine)

      const newLineNumber =
        line.newLineNumber ?? (line.type === 'removed' ? undefined : newLine)

      if (
        target.side === 'deletions' &&
        line.type !== 'added' &&
        oldLineNumber === target.lineNumber
      ) {
        return true
      }

      if (
        target.side === 'additions' &&
        line.type !== 'removed' &&
        newLineNumber === target.lineNumber
      ) {
        return true
      }

      if (line.type !== 'added') {
        oldLine += 1
      }

      if (line.type !== 'removed') {
        newLine += 1
      }
    }
  }

  return false
}

export const useReviewCommentDraft = ({
  cwd,
  feedbackDraft = undefined,
  selectedFilePath,
  selectedFileStaged,
  activeFileDiff,
  realAnnotations,
  focusDiffRoot,
}: UseReviewCommentDraftArgs): UseReviewCommentDraftReturn => {
  const [localFeedbackDraft, setLocalFeedbackDraft] =
    useState<FeedbackDraft | null>(null)

  const activeDraft =
    feedbackDraft === undefined ? localFeedbackDraft : feedbackDraft.draft

  const setActiveDraft =
    feedbackDraft === undefined ? setLocalFeedbackDraft : feedbackDraft.setDraft

  const initialFeedbackDraft = activeDraft?.cwd === cwd ? activeDraft : null

  // Refs mirror state so the setter helpers can resolve React updater
  // functions and write the persisted draft during the same event.
  const [annotationTarget, setAnnotationTargetState] =
    useState<AnnotationTarget | null>(() =>
      initialFeedbackDraft !== null
        ? draftToAnnotationTarget(initialFeedbackDraft)
        : null
    )

  const [commentDraftText, setCommentDraftTextState] = useState(
    () => initialFeedbackDraft?.text ?? ''
  )
  const annotationTargetRef = useRef(annotationTarget)
  const commentDraftTextRef = useRef(commentDraftText)

  const setAnnotationTarget = useCallback(
    (next: SetStateAction<AnnotationTarget | null>, focusDiff = true): void => {
      if (focusDiff) {
        focusDiffRoot()
      }

      const resolved = resolveStateAction(next, annotationTargetRef.current)
      annotationTargetRef.current = resolved
      // A target without text is still an open editor, so persist it as a draft.
      setActiveDraft(
        resolved === null
          ? null
          : annotationTargetToDraft(cwd, resolved, commentDraftTextRef.current)
      )
      setAnnotationTargetState(resolved)
    },
    [cwd, focusDiffRoot, setActiveDraft]
  )

  const setCommentDraftText = useCallback(
    (next: SetStateAction<string>, focusDiff = true): void => {
      if (focusDiff) {
        focusDiffRoot()
      }

      const resolved = resolveStateAction(next, commentDraftTextRef.current)
      commentDraftTextRef.current = resolved
      // Text without a target is not a valid inline review draft.
      setActiveDraft(
        annotationTargetRef.current === null
          ? null
          : annotationTargetToDraft(cwd, annotationTargetRef.current, resolved)
      )
      setCommentDraftTextState(resolved)
    },
    [cwd, focusDiffRoot, setActiveDraft]
  )

  useEffect(() => {
    // The parent store is authoritative. If it clears the draft, clear the local
    // editor state too; do not revive old local fallback state.
    if (activeDraft === null) {
      if (
        annotationTargetRef.current !== null ||
        commentDraftTextRef.current.length > 0
      ) {
        annotationTargetRef.current = null
        commentDraftTextRef.current = ''
        setAnnotationTargetState(null)
        setCommentDraftTextState('')
      }

      return
    }

    if (activeDraft.cwd !== cwd) {
      // Drafts are terminal/repo scoped. A cwd mismatch means the old target
      // cannot safely be rendered against the current file list.
      setActiveDraft(null)

      return
    }

    const nextTarget = draftToAnnotationTarget(activeDraft)
    const currentTarget = annotationTargetRef.current

    const targetChanged =
      currentTarget === null ||
      !isSameAnnotationTarget(currentTarget, nextTarget)

    if (targetChanged) {
      annotationTargetRef.current = nextTarget
      setAnnotationTargetState(nextTarget)
    }

    if (commentDraftTextRef.current !== activeDraft.text) {
      commentDraftTextRef.current = activeDraft.text
      setCommentDraftTextState(activeDraft.text)
    }
  }, [activeDraft, cwd, setActiveDraft])

  const annotationTargetIsCurrentFile =
    annotationTarget !== null &&
    annotationTarget.filePath === selectedFilePath &&
    annotationTarget.staged === selectedFileStaged

  const annotationTargetLineExists = useMemo((): boolean => {
    if (
      annotationTarget === null ||
      !annotationTargetIsCurrentFile ||
      activeFileDiff === null
    ) {
      return false
    }

    if (isFileAnnotationTarget(annotationTarget)) {
      return true
    }

    return diffContainsAnnotationTarget(activeFileDiff, annotationTarget)
  }, [activeFileDiff, annotationTarget, annotationTargetIsCurrentFile])

  const commentDraftIsRecoverable =
    annotationTarget !== null &&
    commentDraftText.trim().length > 0 &&
    (isFileAnnotationTarget(annotationTarget)
      ? !annotationTargetIsCurrentFile
      : activeFileDiff !== null &&
        (!annotationTargetIsCurrentFile || !annotationTargetLineExists))

  const lineAnnotations = useMemo((): DiffLineAnnotation<ReviewComment>[] => {
    if (
      annotationTarget !== null &&
      !isFileAnnotationTarget(annotationTarget) &&
      annotationTarget.editId === undefined &&
      annotationTargetIsCurrentFile &&
      (activeFileDiff === null || annotationTargetLineExists)
    ) {
      // Pierre renders annotations, not arbitrary child rows. A synthetic
      // annotation reserves the exact line slot for the unsent comment editor.
      const draft: DiffLineAnnotation<ReviewComment> = {
        side: annotationTarget.side,
        lineNumber: annotationTarget.lineNumber,
        metadata: {
          id: DRAFT_ID,
          text: '',
          author: 'self',
          createdAt: 0,
          ...(annotationTarget.rangeEndLine === undefined
            ? {}
            : {
                target: {
                  scope: 'range' as const,
                  side: annotationTarget.side,
                  startLine: annotationTarget.lineNumber,
                  endLine: annotationTarget.rangeEndLine,
                },
              }),
        },
      }

      return [...realAnnotations, draft]
    }

    return realAnnotations
  }, [
    realAnnotations,
    annotationTarget,
    annotationTargetIsCurrentFile,
    annotationTargetLineExists,
    activeFileDiff,
  ])

  const closeCommentDraft = useCallback(
    (focusDiff = true): void => {
      setAnnotationTarget(null, focusDiff)
      setCommentDraftText('', false)
    },
    [setCommentDraftText, setAnnotationTarget]
  )

  return {
    annotationTarget,
    commentDraftText,
    annotationTargetIsCurrentFile,
    annotationTargetLineExists,
    commentDraftIsRecoverable,
    lineAnnotations,
    setAnnotationTarget,
    setCommentDraftText,
    closeCommentDraft,
  }
}
