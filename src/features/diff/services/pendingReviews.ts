import type { AnnotationSide } from '@pierre/diffs'
import type { ReviewComment } from '../hooks/useFeedbackBatch'

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
  lineNumber: number
  side: AnnotationSide
  /**
   * The original comment's scope target, carried so the agent reply inherits it
   * — a file-level comment's reply stays file-scoped (renders in the file panel,
   * not as a line-0 annotation); a range comment's reply keeps its span.
   */
  target: ReviewComment['target']
  /**
   * The thread the addressed comment roots or belongs to (VIM-298):
   * `comment.threadId ?? comment.id`, captured at handle registration so the
   * agent's reply lands in the same thread group.
   */
  threadId?: string
}

export interface PendingReview {
  ptyId: string
  /** The feedback owner (sessionId:paneId) at dispatch — replies route here even
   * after the active pane changes. */
  ownerKey: string
  /** The token the agent must echo; each dispatch mints its own. */
  nonce: string
  dispatchedAt: number
  /** `[#n]` → the comment it addressed, in the order the dispatch numbered them. */
  byHandle: Map<number, PendingReviewHandle>
}

// Module-singleton keyed by (ptyId, nonce) — correlation state, not persisted
// review data (comments persist via the feedback store). Multiple dispatches
// can be in flight on one pty at once (VIM-297: a single comment sent now must
// not clobber the batch's correlation, and vice versa); each reply resolves by
// the nonce it echoes. Records are consumed when their replies land and are
// pruned with their owner.
const reviewKey = (ptyId: string, nonce: string): string =>
  `${ptyId}\u0000${nonce}`

const store = new Map<string, PendingReview>()

export const setPendingReview = (review: PendingReview): void => {
  store.set(reviewKey(review.ptyId, review.nonce), review)
}

export const getPendingReview = (
  ptyId: string,
  nonce: string
): PendingReview | undefined => store.get(reviewKey(ptyId, nonce))

export const clearPendingReview = (ptyId: string, nonce: string): void => {
  store.delete(reviewKey(ptyId, nonce))
}

export const pendingNoncesForPty = (ptyId: string): string[] =>
  [...store.values()]
    .filter((review) => review.ptyId === ptyId)
    .map((review) => review.nonce)

const RECOVERY_NONCE_BATCH_SIZE = 50

export const recoveryNonceBatches = (nonces: readonly string[]): string[][] =>
  Array.from(
    { length: Math.ceil(nonces.length / RECOVERY_NONCE_BATCH_SIZE) },
    (_, index) =>
      nonces.slice(
        index * RECOVERY_NONCE_BATCH_SIZE,
        (index + 1) * RECOVERY_NONCE_BATCH_SIZE
      )
  )

export const prunePendingReviewOwners = (
  liveOwnerKeys: ReadonlySet<string>
): void => {
  for (const [key, review] of store) {
    if (!liveOwnerKeys.has(review.ownerKey)) {
      store.delete(key)
    }
  }
}
