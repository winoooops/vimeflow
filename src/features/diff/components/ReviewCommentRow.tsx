import type { ReactElement } from 'react'
import type { ReviewComment } from '../hooks/useFeedbackBatch'

interface ReviewCommentRowProps {
  comment: ReviewComment
  onEdit: () => void
  onDelete: () => void
}

export const ReviewCommentRow = ({
  comment,
  onEdit,
  onDelete,
}: ReviewCommentRowProps): ReactElement => (
  <div className="mx-2 my-1 flex items-start gap-2 rounded-md bg-surface-container-high/60 px-3 py-2">
    <p className="flex-1 break-words whitespace-pre-wrap text-xs text-on-surface">
      {comment.text}
    </p>
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={(): void => onEdit()}
        className="rounded p-1 text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
        aria-label="Edit comment"
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-base"
        >
          edit
        </span>
      </button>
      <button
        type="button"
        onClick={(): void => onDelete()}
        className="rounded p-1 text-on-surface-variant hover:bg-error-container/30 hover:text-error"
        aria-label="Delete comment"
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-base"
        >
          delete
        </span>
      </button>
    </div>
  </div>
)
