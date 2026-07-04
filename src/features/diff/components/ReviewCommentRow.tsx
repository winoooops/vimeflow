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
}: ReviewCommentRowProps): ReactElement => {
  // A dispatched comment was sent to an agent and now persists as a thread
  // anchor (VIM-282); label it "Sent" so it reads as sent rather than an unsent
  // draft.
  const dispatched = comment.dispatchedAt !== undefined

  return (
    <div className="mx-2 my-1 flex items-start gap-2 rounded-md bg-surface-container-high/60 px-3 py-2">
      <div className="min-w-0 flex-1">
        {dispatched || targetLabel !== undefined ? (
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {dispatched ? (
              <span className="inline-flex items-center rounded bg-surface-container-highest/70 px-1.5 py-px text-[10px] font-medium text-primary">
                Sent
              </span>
            ) : null}
            {targetLabel !== undefined ? (
              <span className="inline-block rounded bg-surface-container-highest/70 px-1.5 py-px font-mono text-[10px] text-on-surface-variant">
                {targetLabel}
              </span>
            ) : null}
          </div>
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
}
