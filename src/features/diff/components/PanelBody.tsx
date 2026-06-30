import { type ReactElement, type RefObject } from 'react'
import { MultiFileDiff } from '@pierre/diffs/react'
import type {
  AnnotationSide,
  DiffLineAnnotation,
  FileDiffOptions,
  SelectedLineRange,
} from '@pierre/diffs'
import { IconButton } from '@/components/IconButton'
import { DRAFT_ID, type ReviewComment } from '../hooks/useFeedbackBatch'
import type { AnnotationTarget } from '../hooks/useReviewCommentDraft'
import type { PierreFileInputs } from '../services/pierreAdapter'
import { DiffNarrowPlaceholder } from './DiffNarrowPlaceholder'
import { DIFF_MIN_WIDTH_PX } from './toolbar'
import { ReviewCommentEditor } from './ReviewCommentEditor'
import { ReviewCommentRow } from './ReviewCommentRow'

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
  onPointerMove: () => void
  onAddComment: (lineNumber: number, side: AnnotationSide) => void
  onEditComment: (annotation: DiffLineAnnotation<ReviewComment>) => void
  onDeleteComment: (id: string) => void
  onCommentTextChange: (text: string) => void
  onConfirmComment: (text: string) => void
  onCancelComment: () => void
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
  onPointerMove,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onCommentTextChange,
  onConfirmComment,
  onCancelComment,
}: PanelBodyProps): ReactElement => (
  <div
    ref={scrollBodyRef}
    data-testid="diff-scroll-body"
    className="min-h-0 flex-1 overflow-auto"
    onPointerMove={onPointerMove}
  >
    {diffError ? (
      <ErrorCard message={diffError.message} />
    ) : pierreInputs ? (
      tooNarrow ? (
        <DiffNarrowPlaceholder min={DIFF_MIN_WIDTH_PX} />
      ) : (
        <MultiFileDiff<ReviewComment>
          key={renderKey}
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
                  value={commentDraftText}
                  onTextChange={onCommentTextChange}
                  onConfirm={onConfirmComment}
                  onCancel={onCancelComment}
                />
              )
            }

            return (
              <ReviewCommentRow
                comment={annotation.metadata}
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
