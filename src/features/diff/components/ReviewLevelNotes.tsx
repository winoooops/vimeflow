import { useSyncExternalStore, type ReactElement } from 'react'
import {
  reviewLevelNotes,
  subscribeReviewLevelNotes,
} from '../services/pendingReviewRequests'
import { AGENT_OUTCOME_META } from '../reviewCategoryMeta'

interface ReviewLevelNotesProps {
  /** The active file's review; comments for other files are not shown. */
  ownerKey: string | undefined
}

/**
 * A short list of review comments that don't line up with any line in the
 * current diff — for example the reviewer commented on a file that isn't part
 * of this review, or the reply came back garbled. We show them here instead of
 * dropping them, so nothing the reviewer said is silently lost.
 *
 * Rendered inside the diff panel, just below the active file's own comments,
 * and scoped to that file's review. Shows nothing when there are none.
 */
export const ReviewLevelNotes = ({
  ownerKey,
}: ReviewLevelNotesProps): ReactElement | null => {
  const notes = useSyncExternalStore(subscribeReviewLevelNotes, () =>
    reviewLevelNotes(ownerKey)
  )

  if (notes.length === 0) {
    return null
  }

  return (
    <div
      data-testid="review-level-notes-panel"
      className="flex max-h-56 shrink-0 flex-col gap-1 px-4 pb-3 pt-2"
    >
      <div className="px-2 text-xs font-medium text-on-surface-variant">
        Review — {notes.length} off-file
      </div>
      <div
        data-testid="review-level-notes-list"
        className="flex min-h-0 flex-col gap-1 overflow-y-auto pr-1"
      >
        {notes.map((note) => (
          <div
            key={note.commentId}
            className="flex flex-col gap-1 rounded-md bg-surface-container-high/70 px-3 py-2"
          >
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-[0.625rem] font-semibold uppercase tracking-wide text-on-surface-variant">
                {note.reviewer}
              </span>
              {note.outcome !== undefined ? (
                <span
                  className={`inline-flex items-center rounded bg-surface-container-highest/70 px-1.5 py-px text-[10px] font-medium ${AGENT_OUTCOME_META[note.outcome].chip}`}
                >
                  {AGENT_OUTCOME_META[note.outcome].label}
                </span>
              ) : null}
            </span>
            <span className="whitespace-pre-wrap text-xs leading-5 text-on-surface">
              {note.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
