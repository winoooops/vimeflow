import type { ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import {
  reviewCommentCategory,
  type ReviewComment,
} from '../hooks/useFeedbackBatch'
import { REVIEW_CATEGORY_META } from '../reviewCategoryMeta'

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
  // The category chip is the face value of the comment's structured category
  // (VIM-256/253). Agent replies render distinctly and read-only; a dispatched
  // user comment also shows "Sent <time ago>" (VIM-282).
  const { author, dispatchedAt } = comment
  const isAgent = author === 'agent'
  const isReviewer = author === 'reviewer'
  // Agent replies and delegated reviewer findings are agent output — read-only,
  // never dispatched, rendered on an elevated card (VIM-256 / VIM-304).
  const isAgentOutput = isAgent || isReviewer
  const isDispatched = dispatchedAt !== undefined
  const readOnly = isAgentOutput || isDispatched
  const categoryMeta = REVIEW_CATEGORY_META[reviewCommentCategory(comment)]

  return (
    <div
      className={`mx-2 my-1 flex items-start gap-2 rounded-md px-3 py-2 ${
        isAgentOutput
          ? 'bg-primary-container/15'
          : 'bg-surface-container-high/60'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1">
          {isReviewer ? (
            <>
              <span className="inline-flex items-center rounded bg-surface-container-highest/70 px-1.5 py-px text-[10px] font-medium text-primary">
                {comment.reviewer ?? 'Reviewer'}
              </span>
              <span
                className={`inline-flex items-center rounded bg-surface-container-highest/70 px-1.5 py-px text-[10px] font-medium ${categoryMeta.chip}`}
              >
                {categoryMeta.label}
              </span>
            </>
          ) : isAgent ? (
            <span className="inline-flex items-center rounded bg-surface-container-highest/70 px-1.5 py-px text-[10px] font-medium text-success">
              Agent reply
            </span>
          ) : (
            <span
              className={`inline-flex items-center rounded bg-surface-container-highest/70 px-1.5 py-px text-[10px] font-medium ${categoryMeta.chip}`}
            >
              {categoryMeta.label}
            </span>
          )}
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
        <p className="break-words whitespace-pre-wrap text-xs text-on-surface">
          {comment.text}
        </p>
      </div>
      {readOnly ? null : (
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
