/**
 * Loads and saves diff-review work through the desktop backend.
 *
 * Review comments, drafts, and pending replies must survive app restarts without
 * trusting whatever happens to be in the saved file. This module validates data
 * as it is loaded and queues saves in order so a slower write cannot overwrite a
 * newer one.
 */

import type { AnnotationSide, DiffLineAnnotation } from '@pierre/diffs'
import type { AgentReplyStatus } from '@/bindings'
import { invoke } from '@/lib/backend'
import { isDesktop } from '@/lib/environment'
import type {
  FeedbackDraft,
  ReviewComment,
  ReviewCommentCategory,
} from '../hooks/useFeedbackBatch'
import type {
  PersistedPendingReview,
  PersistedPendingReviewHandle,
} from './pendingReviews'
import type {
  PersistedFindingThreadRecord,
  PersistedPendingReviewRequest,
  ReviewLevelNote,
} from './pendingReviewRequests'

export const REVIEW_STATE_VERSION = 1

export interface PersistedReviewAnnotation {
  filePath: string
  staged: boolean
  annotation: DiffLineAnnotation<ReviewComment>
}

type OmitCwd<T> = T extends unknown ? Omit<T, 'cwd'> : never

export type PersistedFeedbackDraft = OmitCwd<FeedbackDraft>

export interface PersistedReviewState {
  version: typeof REVIEW_STATE_VERSION
  annotations: PersistedReviewAnnotation[]
  draft: PersistedFeedbackDraft | null
  threadDrafts: [string, string][]
  pendingReviews: PersistedPendingReview[]
  pendingReviewRequests: PersistedPendingReviewRequest[]
  findingThreads: PersistedFindingThreadRecord[]
  reviewLevelNotes: ReviewLevelNote[]
}

const COMMENT_CATEGORIES: readonly ReviewCommentCategory[] = [
  'question',
  'change',
  'bug',
  'suggestion',
]

const REPLY_STATUSES: readonly AgentReplyStatus[] = [
  'reply',
  'clarify',
  'resolved',
  'deferred',
  'rejected',
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string'

const isSide = (value: unknown): value is AnnotationSide =>
  value === 'additions' || value === 'deletions'

const isRepoRelativePath = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(value)
  ) {
    return false
  }

  return !value.split(/[\\/]/).includes('..')
}

const isCategory = (
  value: unknown
): value is ReviewCommentCategory | undefined =>
  value === undefined ||
  COMMENT_CATEGORIES.includes(value as ReviewCommentCategory)

const isOutcome = (value: unknown): value is AgentReplyStatus | undefined =>
  value === undefined || REPLY_STATUSES.includes(value as AgentReplyStatus)

const isTarget = (value: unknown): value is ReviewComment['target'] => {
  if (value === undefined) {
    return true
  }
  if (!isRecord(value)) {
    return false
  }
  if (value.scope === 'file') {
    return true
  }

  return (
    value.scope === 'range' &&
    isSide(value.side) &&
    isFiniteNumber(value.startLine) &&
    isFiniteNumber(value.endLine)
  )
}

const isReviewComment = (value: unknown): value is ReviewComment =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  value.id.length > 0 &&
  typeof value.text === 'string' &&
  (value.author === 'self' ||
    value.author === 'agent' ||
    value.author === 'reviewer') &&
  isFiniteNumber(value.createdAt) &&
  isOptionalString(value.reviewer) &&
  isCategory(value.category) &&
  isOutcome(value.outcome) &&
  (value.dispatchedAt === undefined || isFiniteNumber(value.dispatchedAt)) &&
  isTarget(value.target) &&
  isOptionalString(value.threadId) &&
  (value.resolvedAt === undefined || isFiniteNumber(value.resolvedAt)) &&
  isOptionalString(value.dispatchedTo)

const isAnnotation = (
  value: unknown
): value is DiffLineAnnotation<ReviewComment> =>
  isRecord(value) &&
  isSide(value.side) &&
  isFiniteNumber(value.lineNumber) &&
  isReviewComment(value.metadata)

const isPersistedAnnotation = (
  value: unknown
): value is PersistedReviewAnnotation =>
  isRecord(value) &&
  isRepoRelativePath(value.filePath) &&
  typeof value.staged === 'boolean' &&
  isAnnotation(value.annotation)

const isPersistedDraft = (value: unknown): value is PersistedFeedbackDraft => {
  if (
    !isRecord(value) ||
    !isRepoRelativePath(value.filePath) ||
    typeof value.staged !== 'boolean' ||
    typeof value.text !== 'string' ||
    !isOptionalString(value.editId) ||
    !isCategory(value.category)
  ) {
    return false
  }
  if (value.scope === 'file') {
    return true
  }

  return (
    (value.scope === undefined || value.scope === 'line') &&
    isSide(value.side) &&
    isFiniteNumber(value.lineNumber) &&
    (value.rangeEndLine === undefined || isFiniteNumber(value.rangeEndLine))
  )
}

const isRange = (value: unknown): value is { start: number; end: number } =>
  isRecord(value) && isFiniteNumber(value.start) && isFiniteNumber(value.end)

const isReviewedFile = (
  value: unknown
): value is PersistedPendingReviewRequest['diffSnapshot'][number] =>
  isRecord(value) &&
  isRepoRelativePath(value.path) &&
  typeof value.staged === 'boolean' &&
  Array.isArray(value.additions) &&
  value.additions.every(isRange) &&
  Array.isArray(value.deletions) &&
  value.deletions.every(isRange)

const isPersistedHandle = (
  value: unknown
): value is Omit<PersistedPendingReviewHandle, 'id'> =>
  isRecord(value) &&
  isRepoRelativePath(value.filePath) &&
  typeof value.staged === 'boolean' &&
  isFiniteNumber(value.lineNumber) &&
  isSide(value.side) &&
  isTarget(value.target) &&
  isOptionalString(value.threadId)

const isPersistedPendingReview = (
  value: unknown
): value is PersistedPendingReview =>
  isRecord(value) &&
  typeof value.ptyId === 'string' &&
  typeof value.nonce === 'string' &&
  isFiniteNumber(value.dispatchedAt) &&
  (value.consumedHandleIds === undefined ||
    (Array.isArray(value.consumedHandleIds) &&
      value.consumedHandleIds.every(isFiniteNumber))) &&
  Array.isArray(value.handles) &&
  value.handles.every(
    (handle) =>
      isRecord(handle) && isFiniteNumber(handle.id) && isPersistedHandle(handle)
  )

const isPersistedPendingReviewRequest = (
  value: unknown
): value is PersistedPendingReviewRequest =>
  isRecord(value) &&
  typeof value.nonce === 'string' &&
  isOptionalString(value.ptyId) &&
  Array.isArray(value.diffSnapshot) &&
  value.diffSnapshot.every(isReviewedFile) &&
  isFiniteNumber(value.dispatchedAt)

const isPersistedFindingTarget = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.commentId === 'string' &&
  (value.kind === 'reviewLevel' ||
    (value.kind === 'anchored' && isPersistedHandle(value.handle)))

const isPersistedFindingThread = (
  value: unknown
): value is PersistedFindingThreadRecord =>
  isRecord(value) &&
  typeof value.ptyId === 'string' &&
  typeof value.nonce === 'string' &&
  Array.isArray(value.byOrdinal) &&
  value.byOrdinal.every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      isFiniteNumber(entry[0]) &&
      isPersistedFindingTarget(entry[1])
  ) &&
  Array.isArray(value.seenReplies) &&
  value.seenReplies.every((reply) => typeof reply === 'string')

const isReviewLevelNote = (value: unknown): value is ReviewLevelNote =>
  isRecord(value) &&
  typeof value.commentId === 'string' &&
  typeof value.reviewer === 'string' &&
  typeof value.text === 'string' &&
  typeof value.nonce === 'string' &&
  isOutcome(value.outcome)

const validEntries = <T>(
  value: unknown,
  predicate: (entry: unknown) => entry is T
): T[] => (Array.isArray(value) ? value.filter(predicate) : [])

export const parsePersistedReviewState = (
  value: unknown
): PersistedReviewState | null => {
  if (!isRecord(value) || value.version !== REVIEW_STATE_VERSION) {
    return null
  }

  return {
    version: REVIEW_STATE_VERSION,
    annotations: validEntries(value.annotations, isPersistedAnnotation),
    draft:
      isPersistedDraft(value.draft) && value.draft.text.trim().length > 0
        ? value.draft
        : null,
    threadDrafts: validEntries(
      value.threadDrafts,
      (entry): entry is [string, string] =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        entry[0].length > 0 &&
        typeof entry[1] === 'string' &&
        entry[1].trim().length > 0
    ),
    pendingReviews: validEntries(
      value.pendingReviews,
      isPersistedPendingReview
    ),
    pendingReviewRequests: validEntries(
      value.pendingReviewRequests,
      isPersistedPendingReviewRequest
    ),
    findingThreads: validEntries(
      value.findingThreads,
      isPersistedFindingThread
    ),
    reviewLevelNotes: validEntries(value.reviewLevelNotes, isReviewLevelNote),
  }
}

export const reviewStateHasData = (state: PersistedReviewState): boolean =>
  state.annotations.length > 0 ||
  (state.draft?.text.trim().length ?? 0) > 0 ||
  state.threadDrafts.some(([, text]) => text.trim().length > 0) ||
  state.pendingReviews.length > 0 ||
  state.pendingReviewRequests.length > 0 ||
  state.findingThreads.length > 0 ||
  state.reviewLevelNotes.length > 0

let writeQueue: Promise<void> = Promise.resolve()
const deletedOwnerKeys = new Set<string>()

const ignoreFailure = async (pending: Promise<void>): Promise<void> => {
  try {
    await pending
  } catch {
    // The failed caller sees the error; later writes still need a usable tail.
  }
}

const enqueueWrite = (write: () => Promise<void>): Promise<void> => {
  const previous = writeQueue

  const queued = (async (): Promise<void> => {
    await previous
    await write()
  })()

  writeQueue = ignoreFailure(queued)

  return queued
}

export const loadReviewState = async (
  cwd: string,
  ownerKey: string
): Promise<PersistedReviewState | null> => {
  if (!isDesktop()) {
    return null
  }
  deletedOwnerKeys.delete(ownerKey)

  // Target transitions flush the previous cwd before loading the replacement.
  // Joining the write queue here makes that ordering explicit.
  await writeQueue

  return parsePersistedReviewState(
    await invoke<unknown>('load_review_state', { cwd, ownerKey })
  )
}

export const saveReviewState = (
  cwd: string,
  ownerKey: string,
  state: PersistedReviewState
): Promise<void> => {
  if (!isDesktop()) {
    return Promise.resolve()
  }
  if (deletedOwnerKeys.has(ownerKey)) {
    return Promise.resolve()
  }

  return enqueueWrite(() => {
    if (deletedOwnerKeys.has(ownerKey)) {
      return Promise.resolve()
    }

    return invoke('save_review_state', {
      cwd,
      ownerKey,
      state: reviewStateHasData(state) ? state : null,
    })
  })
}

export const deleteReviewOwnerState = (ownerKey: string): Promise<void> => {
  if (!isDesktop()) {
    return Promise.resolve()
  }
  deletedOwnerKeys.add(ownerKey)

  return enqueueWrite(() => invoke('delete_review_owner_state', { ownerKey }))
}

export const drainReviewStateWrites = async (): Promise<void> => {
  let pending: Promise<void>
  do {
    pending = writeQueue
    await pending
  } while (pending !== writeQueue)
}
