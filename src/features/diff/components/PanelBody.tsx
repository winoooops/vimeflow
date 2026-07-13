import {
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'
import { MultiFileDiff, useWorkerPool } from '@pierre/diffs/react'
import type {
  AnnotationSide,
  DiffLineAnnotation,
  FileDiffOptions,
  SelectedLineRange,
} from '@pierre/diffs'
import { IconButton } from '@/components/IconButton'
import {
  DRAFT_ID,
  type ReviewComment,
  type ReviewCommentCategory,
} from '../hooks/useFeedbackBatch'
import type { AnnotationTarget } from '../hooks/useReviewCommentDraft'
import type { PierreFileInputs } from '../services/pierreAdapter'
import {
  threadAnchorLabel,
  threadGroupKey,
  type ThreadGroup,
} from '../services/threadGroups'
import { DiffNarrowPlaceholder } from './DiffNarrowPlaceholder'
import { DIFF_MIN_WIDTH_PX } from './toolbar'
import { ReviewCommentEditor } from './ReviewCommentEditor'
import { ReviewCommentRow } from './ReviewCommentRow'
import {
  ReviewThreadCard,
  type ReviewThreadCardActions,
} from './ReviewThreadCard'

const ErrorCard = ({ message }: { message: string }): ReactElement => (
  <div
    className="flex h-full w-full items-center justify-center text-error"
    role="alert"
  >
    <div className="text-center space-y-2">
      <p className="text-sm font-semibold">Failed to load diff</p>
      <p className="text-xs opacity-80">{message}</p>
    </div>
  </div>
)

const LoadingCard = (): ReactElement => (
  <div
    className="flex h-full w-full items-center justify-center text-on-surface-variant"
    role="status"
    aria-live="polite"
  >
    <div className="text-center space-y-2">
      <p className="text-sm">Loading diff…</p>
    </div>
  </div>
)

const annotationTargetLabel = (
  annotation: DiffLineAnnotation<ReviewComment>
): string | undefined => {
  const target = annotation.metadata.target
  if (target?.scope !== 'range') {
    return undefined
  }

  const prefix = target.side === 'deletions' ? 'L' : 'R'

  return target.startLine === target.endLine
    ? `line ${prefix}${target.startLine}`
    : `lines ${prefix}${target.startLine}-${prefix}${target.endLine}`
}

interface DiffCacheLike {
  has: (cacheKey: string) => boolean
}

interface HighlightCacheWorkerPool {
  inspectCaches: () => { diffCache: DiffCacheLike }
  subscribeToStatChanges: (callback: () => void) => () => void
}

const isHighlightCacheWorkerPool = (
  value: unknown
): value is HighlightCacheWorkerPool =>
  typeof value === 'object' &&
  value !== null &&
  'inspectCaches' in value &&
  'subscribeToStatChanges' in value &&
  typeof value.inspectCaches === 'function' &&
  typeof value.subscribeToStatChanges === 'function'

const useHighlightCacheRevision = (diffCacheKey: string | null): number => {
  const workerPool = useWorkerPool()

  const cacheWorkerPool = isHighlightCacheWorkerPool(workerPool)
    ? workerPool
    : null

  const [revision, setRevision] = useState(0)
  const seenCacheKeyRef = useRef<string | null>(null)

  const cacheReadyDuringRender =
    diffCacheKey !== null &&
    (cacheWorkerPool?.inspectCaches().diffCache.has(diffCacheKey) ?? false)

  useEffect(() => {
    if (cacheWorkerPool === null || diffCacheKey === null) {
      seenCacheKeyRef.current = null

      return
    }

    const markReady = (): void => {
      if (seenCacheKeyRef.current === diffCacheKey) {
        return
      }

      seenCacheKeyRef.current = diffCacheKey
      setRevision((current) => current + 1)
    }

    if (cacheWorkerPool.inspectCaches().diffCache.has(diffCacheKey)) {
      if (!cacheReadyDuringRender) {
        markReady()
      } else {
        seenCacheKeyRef.current = diffCacheKey
      }

      return
    }

    return cacheWorkerPool.subscribeToStatChanges(() => {
      if (cacheWorkerPool.inspectCaches().diffCache.has(diffCacheKey)) {
        markReady()
      }
    })
  }, [cacheReadyDuringRender, cacheWorkerPool, diffCacheKey])

  return revision
}

export interface PanelThreadActions {
  /** threadId whose reply editor is open; null = none. */
  replyingThreadId: string | null
  replyDraft: string
  onStartReply: (threadId: string) => void
  onReplyDraftChange: (text: string) => void
  onSubmitReply: (threadId: string, text: string) => void
  onCancelReply: () => void
  onResolve: (threadId: string) => void
  onReopen: (threadId: string) => void
}

export interface PanelThreadProps {
  groups: Map<string, ThreadGroup>
  /** Omitted → footer-less cards (no dispatch capability, spec Section 3). */
  actions?: PanelThreadActions
}

/**
 * Curries a thread's id into the Panel-level action bundle, producing the
 * per-card actions ReviewThreadCard expects. Shared by the line-level card
 * branch below and Panel's file-comments strip so the two sites cannot drift.
 */
export const bindThreadCardActions = (
  actions: PanelThreadActions,
  threadId: string
): ReviewThreadCardActions => ({
  replying: actions.replyingThreadId === threadId,
  replyDraft: actions.replyDraft,
  onStartReply: (): void => actions.onStartReply(threadId),
  onReplyDraftChange: actions.onReplyDraftChange,
  onSubmitReply: (text): void => actions.onSubmitReply(threadId, text),
  onCancelReply: actions.onCancelReply,
  onResolve: (): void => actions.onResolve(threadId),
  onReopen: (): void => actions.onReopen(threadId),
})

interface PanelBodyProps {
  scrollBodyRef: RefObject<HTMLDivElement | null>
  diffError: Error | null
  diffLoading: boolean
  pierreInputs: PierreFileInputs | null
  tooNarrow: boolean
  renderKey: string
  options: FileDiffOptions<ReviewComment>
  selectedLines: SelectedLineRange | null
  lineAnnotations: DiffLineAnnotation<ReviewComment>[]
  annotationTarget: AnnotationTarget | null
  commentDraftText: string
  commentCategory: ReviewCommentCategory
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerLeave?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onAddComment: (lineNumber: number, side: AnnotationSide) => void
  onEditComment: (annotation: DiffLineAnnotation<ReviewComment>) => void
  onDeleteComment: (id: string) => void
  /** Dispatch one pending comment to the agent now (VIM-297). */
  onSendComment?: (id: string) => void
  onCommentTextChange: (text: string) => void
  onCommentCategoryChange: (category: ReviewCommentCategory) => void
  onConfirmComment: (text: string, category: ReviewCommentCategory) => void
  onCancelComment: () => void
  /** Thread grouping data for VIM-298 card rendering. */
  thread?: PanelThreadProps
}

export const PanelBody = ({
  scrollBodyRef,
  diffError,
  diffLoading,
  pierreInputs,
  tooNarrow,
  renderKey,
  options,
  selectedLines,
  lineAnnotations,
  annotationTarget,
  commentDraftText,
  commentCategory,
  onPointerDown = undefined,
  onPointerMove,
  onPointerUp = undefined,
  onPointerLeave = undefined,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onSendComment = undefined,
  onCommentTextChange,
  onCommentCategoryChange,
  onConfirmComment,
  onCancelComment,
  thread = undefined,
}: PanelBodyProps): ReactElement => {
  const highlightCacheRevision = useHighlightCacheRevision(
    pierreInputs?.diffCacheKey ?? null
  )
  const effectiveRenderKey = `${renderKey}:${highlightCacheRevision}`

  return (
    <div
      ref={scrollBodyRef}
      data-testid="diff-scroll-body"
      className="min-h-0 flex-1 overflow-auto"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      {diffError ? (
        <ErrorCard message={diffError.message} />
      ) : pierreInputs ? (
        tooNarrow ? (
          <DiffNarrowPlaceholder min={DIFF_MIN_WIDTH_PX} />
        ) : (
          <MultiFileDiff<ReviewComment>
            key={effectiveRenderKey}
            oldFile={pierreInputs.oldFile}
            newFile={pierreInputs.newFile}
            selectedLines={selectedLines}
            lineAnnotations={lineAnnotations}
            options={options}
            renderGutterUtility={(getHoveredLine): ReactElement => (
              <IconButton
                icon="add"
                label="Add comment on this line"
                size="sm"
                shortcut="i"
                className="h-5 w-5 translate-x-3/4 rounded-full bg-primary text-on-primary shadow-md hover:bg-primary/90"
                onClick={(): void => {
                  const hovered = getHoveredLine()
                  if (hovered) {
                    onAddComment(hovered.lineNumber, hovered.side)
                  }
                }}
              />
            )}
            renderAnnotation={(
              annotation: DiffLineAnnotation<ReviewComment>
            ): ReactElement => {
              const isDraft = annotation.metadata.id === DRAFT_ID

              const isEditing =
                annotationTarget?.editId !== undefined &&
                annotationTarget.editId === annotation.metadata.id

              if (isDraft || isEditing) {
                return (
                  <ReviewCommentEditor
                    key={`${annotation.lineNumber}:${annotation.side}:${
                      isEditing ? annotation.metadata.id : 'draft'
                    }`}
                    lineNumber={annotation.lineNumber}
                    side={annotation.side}
                    targetLabel={annotationTargetLabel(annotation)}
                    value={commentDraftText}
                    category={commentCategory}
                    onTextChange={onCommentTextChange}
                    onCategoryChange={onCommentCategoryChange}
                    onConfirm={onConfirmComment}
                    onCancel={onCancelComment}
                  />
                )
              }

              const groupKey = threadGroupKey(annotation)

              const group =
                groupKey === undefined
                  ? undefined
                  : thread?.groups.get(groupKey)
              if (group !== undefined) {
                const threadActions = thread?.actions

                return (
                  <ReviewThreadCard
                    key={`thread:${group.threadId}`}
                    group={group}
                    anchorLabel={threadAnchorLabel(
                      group.turns[0] ?? annotation
                    )}
                    actions={
                      threadActions === undefined
                        ? undefined
                        : bindThreadCardActions(threadActions, group.threadId)
                    }
                  />
                )
              }

              return (
                <ReviewCommentRow
                  comment={annotation.metadata}
                  targetLabel={annotationTargetLabel(annotation)}
                  onSendNow={
                    onSendComment === undefined
                      ? undefined
                      : (): void => onSendComment(annotation.metadata.id)
                  }
                  onEdit={(): void => onEditComment(annotation)}
                  onDelete={(): void => onDeleteComment(annotation.metadata.id)}
                />
              )
            }}
            style={{ display: 'block', width: '100%' }}
          />
        )
      ) : diffLoading ? (
        <LoadingCard />
      ) : null}
    </div>
  )
}
