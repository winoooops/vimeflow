import type { AnnotationSide } from '@pierre/diffs'

/**
 * Where a dispatched `[#n]` handle points: the comment it addressed, keyed by
 * the annotation BATCH KEY — the original `(cwd, repo-relative filePath, staged)`
 * the feedback store uses, NOT the resolved absolute agent-facing path from the
 * prompt. An agent reply attaches back onto this so it renders co-located with
 * the comment (VIM-249).
 */
export interface PendingReviewHandle {
  cwd: string
  filePath: string
  staged: boolean
  commentId: string
  lineNumber: number
  side: AnnotationSide
}

export interface PendingReview {
  ptyId: string
  /** The feedback owner (sessionId:paneId) at dispatch — replies route here even
   * after the active pane changes. */
  ownerKey: string
  /** The token the agent must echo; a superseded dispatch mints a new one. */
  nonce: string
  dispatchedAt: number
  /** `[#n]` → the comment it addressed, in the order the dispatch numbered them. */
  byHandle: Map<number, PendingReviewHandle>
}

// ponytail: module-singleton keyed by ptyId — correlation state, not persisted
// review data (comments persist via the feedback store). One in-flight review
// per pty; a new dispatch replaces it.
const store = new Map<string, PendingReview>()

export const setPendingReview = (review: PendingReview): void => {
  store.set(review.ptyId, review)
}

export const getPendingReview = (ptyId: string): PendingReview | undefined =>
  store.get(ptyId)

export const clearPendingReview = (ptyId: string): void => {
  store.delete(ptyId)
}
