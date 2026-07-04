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

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * Compact "time since sent" for the Sent badge: `just now`, `5m ago`, `3h ago`,
 * `2d ago`. Takes an explicit `now` so it stays pure and testable; the row
 * passes `Date.now()`.
 */
export const formatSentAgo = (dispatchedAt: number, now: number): string => {
  const delta = now - dispatchedAt

  if (delta < MINUTE_MS) {
    return 'just now'
  }

  if (delta < HOUR_MS) {
    return `${Math.floor(delta / MINUTE_MS)}m ago`
  }

  if (delta < DAY_MS) {
    return `${Math.floor(delta / HOUR_MS)}h ago`
  }

  return `${Math.floor(delta / DAY_MS)}d ago`
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
  // anchor (VIM-282); label it "Sent <time ago>" so it reads as sent — with how
  // long ago — rather than an unsent draft.
  const { dispatchedAt } = comment
  const isDispatched = dispatchedAt !== undefined

  return (
    <div className="mx-2 my-1 flex items-start gap-2 rounded-md bg-surface-container-high/60 px-3 py-2">
      <div className="min-w-0 flex-1">
        {isDispatched || targetLabel !== undefined ? (
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {isDispatched ? (
              <span className="inline-flex items-center rounded bg-surface-container-highest/70 px-1.5 py-px text-[10px] font-medium text-primary">
                Sent {formatSentAgo(dispatchedAt, Date.now())}
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
      {isDispatched ? null : (
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
      )}
    </div>
  )
}
