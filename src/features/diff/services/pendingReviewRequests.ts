/**
 * Correlation state for a dispatched "Request review" (VIM-304), parallel to
 * `pendingReviews` (the reply-correlation store). Keyed by the per-dispatch
 * nonce so multiple review requests can be in flight on one pty (forward-
 * compatible with VIM-297). Not persisted — the placed reviewer annotations
 * persist via the feedback store (VIM-282); this is just the routing + snapshot.
 */
import type { FileDiff } from '../types'

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

/**
 * Build the diff snapshot handed to the reviewer, from a parsed file diff — the
 * new-file line span of each hunk (additions) and the old-file span
 * (deletions). This is both the payload the review is scoped to and the
 * placement resolver: a finding's line anchors only if it falls in one of these
 * ranges (else it degrades to file-level). Returns an array because a snapshot
 * is a list of files; today a review always covers exactly the one active file.
 */
export const buildDiffSnapshot = (fileDiff: FileDiff): ReviewedFile[] => [
  {
    path: fileDiff.filePath,
    additions: fileDiff.hunks
      .filter((hunk) => hunk.newLines > 0)
      .map((hunk) => ({
        start: hunk.newStart,
        end: hunk.newStart + hunk.newLines - 1,
      })),
    deletions: fileDiff.hunks
      .filter((hunk) => hunk.oldLines > 0)
      .map((hunk) => ({
        start: hunk.oldStart,
        end: hunk.oldStart + hunk.oldLines - 1,
      })),
  },
]

export interface PendingReviewRequest {
  /**
   * The per-dispatch random token. It is the whole gate: an incoming
   * `agent-review` is accepted only if its nonce matches one we minted, so it
   * works the same whether the review was delegated to a pane or copied and
   * pasted into any agent (the nonce is unguessable — no session check needed).
   */
  nonce: string
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
 * Findings that cannot be anchored (path not in the reviewed diff) and
 * malformed reviewer notes have no `(path, staged)` row; they live here,
 * grouped by owner, for the review-level surface (never dropped — the spec's
 * "keep it visible").
 */
export interface ReviewLevelNote {
  commentId: string
  reviewer: string
  text: string
  nonce: string
}

const reviewLevelByOwner = new Map<string, ReviewLevelNote[]>()

// Stable empty reference — `useSyncExternalStore` compares snapshots by identity,
// so a fresh `[]` each read would loop forever.
const EMPTY_NOTES: readonly ReviewLevelNote[] = []

const noteListeners = new Set<() => void>()

const emitNotes = (): void => {
  for (const listener of noteListeners) {
    listener()
  }
}

export const subscribeReviewLevelNotes = (
  listener: () => void
): (() => void) => {
  noteListeners.add(listener)

  return (): void => {
    noteListeners.delete(listener)
  }
}

export const addReviewLevelNote = (
  ownerKey: string,
  note: ReviewLevelNote
): void => {
  reviewLevelByOwner.set(ownerKey, [
    ...(reviewLevelByOwner.get(ownerKey) ?? []),
    note,
  ])
  emitNotes()
}

export const reviewLevelNotes = (
  ownerKey: string | undefined
): readonly ReviewLevelNote[] =>
  ownerKey === undefined
    ? EMPTY_NOTES
    : (reviewLevelByOwner.get(ownerKey) ?? EMPTY_NOTES)

export const clearReviewLevelNotes = (ownerKey: string): void => {
  reviewLevelByOwner.delete(ownerKey)
  emitNotes()
}

export const prunePendingReviewRequestOwners = (
  liveOwnerKeys: ReadonlySet<string>
): void => {
  for (const [nonce, request] of store) {
    if (!liveOwnerKeys.has(request.ownerKey)) {
      store.delete(nonce)
    }
  }

  let notesChanged = false
  for (const ownerKey of reviewLevelByOwner.keys()) {
    if (!liveOwnerKeys.has(ownerKey)) {
      reviewLevelByOwner.delete(ownerKey)
      notesChanged = true
    }
  }

  if (notesChanged) {
    emitNotes()
  }
}
