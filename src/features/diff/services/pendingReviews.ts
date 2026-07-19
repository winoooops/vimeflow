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
  /** Handles already attached, retained while sibling handles remain pending. */
  consumedHandles?: Set<number>
}

export interface PersistedPendingReviewHandle extends Omit<
  PendingReviewHandle,
  'cwd'
> {
  id: number
}

export interface PersistedPendingReview extends Omit<
  PendingReview,
  'ownerKey' | 'byHandle' | 'consumedHandles'
> {
  handles: PersistedPendingReviewHandle[]
  consumedHandleIds?: number[]
}

// Module-singleton keyed by (ptyId, nonce). The workspace review snapshot also
// persists these records so correlation survives restart. Multiple dispatches
// can be in flight on one pty at once (VIM-297: a single comment sent now must
// not clobber the batch's correlation, and vice versa); each reply resolves by
// the nonce it echoes. Records are consumed when their replies land and are
// pruned with their owner.
const reviewKey = (ptyId: string, nonce: string): string =>
  `${ptyId}\u0000${nonce}`

const store = new Map<string, PendingReview>()
const listeners = new Set<() => void>()
let revision = 0

const emit = (): void => {
  revision += 1
  listeners.forEach((listener) => listener())
}

export const subscribePendingReviews = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return (): void => {
    listeners.delete(listener)
  }
}

export const pendingReviewsRevision = (): number => revision

export const setPendingReview = (review: PendingReview): void => {
  store.set(reviewKey(review.ptyId, review.nonce), review)
  emit()
}

export const getPendingReview = (
  ptyId: string,
  nonce: string
): PendingReview | undefined => store.get(reviewKey(ptyId, nonce))

export const clearPendingReview = (ptyId: string, nonce: string): void => {
  if (store.delete(reviewKey(ptyId, nonce))) {
    emit()
  }
}

export const persistedPendingReviews = (
  ownerKey: string
): PersistedPendingReview[] =>
  [...store.values()]
    .filter((review) => review.ownerKey === ownerKey)
    .map((review) => ({
      ptyId: review.ptyId,
      nonce: review.nonce,
      dispatchedAt: review.dispatchedAt,
      consumedHandleIds: [...(review.consumedHandles ?? [])],
      handles: [...review.byHandle.entries()].map(([id, handle]) => ({
        id,
        filePath: handle.filePath,
        staged: handle.staged,
        lineNumber: handle.lineNumber,
        side: handle.side,
        target: handle.target,
        threadId: handle.threadId,
      })),
    }))

export const restorePendingReviews = (
  ownerKey: string,
  cwd: string,
  currentPtyId: string | undefined,
  reviews: readonly PersistedPendingReview[]
): void => {
  for (const [key, review] of store) {
    if (review.ownerKey === ownerKey) {
      store.delete(key)
    }
  }

  for (const review of reviews) {
    const ptyId = currentPtyId ?? review.ptyId
    store.set(reviewKey(ptyId, review.nonce), {
      ptyId,
      ownerKey,
      nonce: review.nonce,
      dispatchedAt: review.dispatchedAt,
      consumedHandles: new Set(review.consumedHandleIds ?? []),
      byHandle: new Map(
        review.handles.map(({ id, ...handle }) => [id, { cwd, ...handle }])
      ),
    })
  }
  emit()
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
  let changed = false
  for (const [key, review] of store) {
    if (!liveOwnerKeys.has(review.ownerKey)) {
      store.delete(key)
      changed = true
    }
  }
  if (changed) {
    emit()
  }
}
