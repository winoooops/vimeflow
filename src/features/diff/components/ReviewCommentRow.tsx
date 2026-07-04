import type { ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import type { ReviewComment } from '../hooks/useFeedbackBatch'

interface ReviewCommentRowProps {
  comment: ReviewComment
  editShortcut?: 'u' | 'Shift+U'
  deleteShortcut?: 'x' | null
  /** Range/line reference shown above the text (e.g. "lines R4-R6"); the diff
   * itself shows the code, so this only names the span. Omitted for plain line
   * comments. */
  targetLabel?: string
  onEdit: () => void
  onDelete: () => void
}

export const ReviewCommentRow = ({
  comment,
  editShortcut = 'u',
  deleteShortcut = 'x',
  targetLabel = undefined,
  onEdit,
  onDelete,
}: ReviewCommentRowProps): ReactElement => (
  <div className="mx-2 my-1 flex items-start gap-2 rounded-md bg-surface-container-high/60 px-3 py-2">
    <div className="min-w-0 flex-1">
      {targetLabel !== undefined ? (
        <span className="mb-1 inline-block rounded bg-surface-container-highest/70 px-1.5 py-px font-mono text-[10px] text-on-surface-variant">
          {targetLabel}
        </span>
      ) : null}
      <p className="break-words whitespace-pre-wrap text-xs text-on-surface">
        {comment.text}
      </p>
    </div>
    <div className="flex shrink-0 items-center gap-1">
      <IconButton
        icon="edit"
        label="Edit comment"
        size="sm"
        shortcut={editShortcut === 'Shift+U' ? ['Shift', 'U'] : 'u'}
        aria-keyshortcuts={editShortcut}
        onClick={(): void => onEdit()}
      />
      <IconButton
        icon="delete"
        label="Delete comment"
        variant="danger"
        size="sm"
        shortcut={deleteShortcut ?? undefined}
        aria-keyshortcuts={deleteShortcut ?? undefined}
        onClick={(): void => onDelete()}
      />
    </div>
  </div>
)
