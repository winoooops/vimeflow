/**
 * Correlation state for a dispatched "Request review" (VIM-304), parallel to
 * `pendingReviews` (the reply-correlation store). Keyed by the per-dispatch
 * nonce so multiple review requests can be in flight on one pty (forward-
 * compatible with VIM-297). Not persisted — the placed reviewer annotations
 * persist via the feedback store (VIM-282); this is just the routing + snapshot.
 */

/** A diff-side line range (inclusive) from the reviewed hunks. */
export interface HunkRange {
  start: number
  end: number
}

/** One reviewed file's hunk line ranges, per side, captured at dispatch. */
export interface ReviewedFile {
  path: string
  additions: HunkRange[]
  deletions: HunkRange[]
}

export interface PendingReviewRequest {
  nonce: string
  ptyId: string
  /** The feedback owner (sessionId:paneId) at dispatch — findings route here. */
  ownerKey: string
  cwd: string
  /** The invoked diff view's staged axis; findings inherit it. */
  staged: boolean
  /**
   * The diff the reviewer was given, captured at dispatch. Both the scope named
   * in the dispatch instruction AND the placement resolver — a finding resolves
   * against exactly what the reviewer saw, immune to edits after dispatch.
   */
  diffSnapshot: ReviewedFile[]
  dispatchedAt: number
}

// ponytail: module-singleton keyed by nonce. One entry per in-flight request.
const store = new Map<string, PendingReviewRequest>()

export const setPendingReviewRequest = (
  request: PendingReviewRequest
): void => {
  store.set(request.nonce, request)
}

export const getPendingReviewRequest = (
  nonce: string
): PendingReviewRequest | undefined => store.get(nonce)

export const clearPendingReviewRequest = (nonce: string): void => {
  store.delete(nonce)
}

/**
 * Unplaceable findings (path not in the reviewed diff) and malformed reviewer
 * notes have no `(path, staged)` row; they live here, grouped by owner, for the
 * review-level surface (never dropped — the spec's "keep it visible").
 */
export interface ReviewLevelNote {
  commentId: string
  reviewer: string
  text: string
  nonce: string
}

const reviewLevelByOwner = new Map<string, ReviewLevelNote[]>()

export const addReviewLevelNote = (
  ownerKey: string,
  note: ReviewLevelNote
): void => {
  reviewLevelByOwner.set(ownerKey, [
    ...(reviewLevelByOwner.get(ownerKey) ?? []),
    note,
  ])
}

export const reviewLevelNotes = (ownerKey: string): ReviewLevelNote[] =>
  reviewLevelByOwner.get(ownerKey) ?? []

export const clearReviewLevelNotes = (ownerKey: string): void => {
  reviewLevelByOwner.delete(ownerKey)
}
