import type { ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
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
      <IconButton
        icon="edit"
        label="Edit comment"
        size="sm"
        onClick={(): void => onEdit()}
      />
      <IconButton
        icon="delete"
        label="Delete comment"
        variant="danger"
        size="sm"
        onClick={(): void => onDelete()}
      />
    </div>
  </div>
)
