/**
 * Owns the in-memory review state for the diff surface.
 *
 * A feedback batch is the set of submitted inline review comments for one
 * terminal-owned review. A feedback draft is different: it is the single
 * comment editor the user has opened but not submitted yet. WorkspaceView keeps
 * one batch and one draft per terminal owner so switching panes, closing the
 * dock, or reopening the diff view does not lose unfinished review work.
 *
 * This file keeps the storage format private. Callers ask for comments by
 * `(cwd, filePath, staged)` and summaries by owner; the hook handles map keys,
 * optimistic updates, soft caps, owner pruning, and repo-root lookup.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnnotationSide, DiffLineAnnotation } from '@pierre/diffs'
import type { AgentReplyStatus } from '@/bindings'

/**
 * The user's one-axis tag on a review comment (VIM-256/253). It is the
 * structured signal, not decoration: it drives the chip AND the dispatch intent
 * (a Question asks the agent to answer; the rest ask it to change files).
 */
export type ReviewCommentCategory = 'question' | 'change' | 'bug' | 'suggestion'

/** Ordered for the editor's registered previous/next cycling and category chips. */
export const REVIEW_COMMENT_CATEGORIES: readonly ReviewCommentCategory[] = [
  'question',
  'change',
  'bug',
  'suggestion',
]

/**
 * Comments with no explicit category behave as a change request — the prior
 * one-way behavior — so existing/persisted comments render and dispatch
 * unchanged.
 */
export const DEFAULT_REVIEW_COMMENT_CATEGORY: ReviewCommentCategory = 'change'

export interface ReviewComment {
  id: string
  text: string
  /**
   * 'self' = a user comment; 'agent' = the primary coding-agent's reply
   * (VIM-256); 'reviewer' = a delegated review agent's finding (VIM-304).
   * Only 'self' comments are ever pending, dispatched, or counted at the cap;
   * 'agent' and 'reviewer' render distinctly and read-only.
   */
  author: 'self' | 'agent' | 'reviewer'
  /**
   * The delegated reviewer's self-reported name (VIM-304), set when
   * `author === 'reviewer'`. The row renders it as the finding's identity.
   */
  reviewer?: string
  /**
   * The user's category tag (VIM-256/253), or the delegated finding's category
   * (VIM-304). Absent → DEFAULT_REVIEW_COMMENT_CATEGORY. Not set on agent replies.
   */
  category?: ReviewCommentCategory
  /**
   * The outcome axis of an agent turn (VIM-304 PR-3), set when
   * `author === 'agent'`: reply / clarify / resolved / deferred / rejected.
   * The user/reviewer raise (category = intent); the main agent responds
   * (outcome). A thread's rollup status derives from the latest agent turn.
   */
  outcome?: AgentReplyStatus
  createdAt: number
  /**
   * When set, the comment has been dispatched to an agent and now stays in the
   * hunk as a thread anchor (VIM-282) instead of being wiped on send.
   * Comments with no dispatchedAt are the *pending* review — what Finish/Send
   * and the discard action act on. A timestamp, not a boolean, so the thread
   * model can order sends.
   */
  dispatchedAt?: number
  target?:
    | { scope: 'file' }
    | {
        scope: 'range'
        side: AnnotationSide
        startLine: number
        endLine: number
      }
  /**
   * Root comment id of the thread this turn belongs to (VIM-298). Stamped on
   * dispatch (`threadId ?? id` — a follow-up keeps its root, a root self-roots);
   * agent replies inherit it from the dispatch handle. Pending comments never
   * carry one — they are not conversations yet.
   */
  threadId?: string
  /**
   * Local thread resolution (VIM-298), set on the thread ROOT only. Purely
   * client-side — nothing is dispatched on resolve; a late agent turn does not
   * clear it (resolution is authoritative).
   */
  resolvedAt?: number
  /** ptyId of the session this comment was dispatched to (VIM-298 affinity). */
  dispatchedTo?: string
}

/**
 * Sentinel annotation id for the in-progress draft comment — the one the
 * editor is editing before it is committed to the batch. DiffPanelContent
 * renders the comment editor instead of a row from this single definition.
 */
export const DRAFT_ID = '__draft__'

export type FeedbackBatch = Map<
  /** Opaque batch key produced by makeBatchKey(cwd, filePath, staged). */
  string,
  DiffLineAnnotation<ReviewComment>[]
>

export interface ParsedBatchKey {
  cwd: string
  filePath: string
  staged: boolean
}

// NUL separates the key segments. It cannot occur in a Unix cwd or file path,
// so splitting is unambiguous even when a path itself contains the old `::`
// separator. The key is internal to the batch Map — never displayed or sent to
// a terminal.
const KEY_SEP = '\0'

/**
 * The batch Map is keyed by a single string encoding (cwd, filePath, staged).
 * `makeBatchKey` and `parseBatchKey` are the ONE source of truth for that
 * format — consumers (e.g. the dispatch path in DiffPanelContent) use these
 * rather than splitting the key by hand.
 */
export const makeBatchKey = (
  cwd: string,
  filePath: string,
  staged: boolean
): string =>
  `${cwd}${KEY_SEP}${filePath}${KEY_SEP}${staged ? 'staged' : 'unstaged'}`

export const parseBatchKey = (key: string): ParsedBatchKey => {
  const parts = key.split(KEY_SEP)

  return {
    cwd: parts[0] ?? '',
    filePath: parts[1] ?? '',
    staged: parts[2] === 'staged',
  }
}

const SOFT_CAP = 50

export const FILE_COMMENT_LINE_NUMBER = 0

export const isFileLevelReviewAnnotation = (
  annotation: DiffLineAnnotation<ReviewComment>
): boolean => annotation.metadata.target?.scope === 'file'

export const isLineLevelReviewAnnotation = (
  annotation: DiffLineAnnotation<ReviewComment>
): boolean => !isFileLevelReviewAnnotation(annotation)

/** A coding-agent reply (VIM-256): renders distinctly and is never dispatched. */
export const isAgentReviewAnnotation = (
  annotation: DiffLineAnnotation<ReviewComment>
): boolean => annotation.metadata.author === 'agent'

/** The effective category, defaulting absent tags to a change request. */
export const reviewCommentCategory = (
  comment: ReviewComment
): ReviewCommentCategory => comment.category ?? DEFAULT_REVIEW_COMMENT_CATEGORY

/**
 * A comment is *pending* until it is dispatched to an agent. Pending comments
 * are the review the user is still assembling; dispatched ones stay in the hunk
 * as thread anchors but are never re-sent, counted as unfinished, or discarded.
 * Only the user's own not-yet-dispatched comments are pending — `agent` replies
 * and `reviewer` findings are agent output, never the user's unsent feedback.
 */
export const isPendingReviewAnnotation = (
  annotation: DiffLineAnnotation<ReviewComment>
): boolean =>
  annotation.metadata.author === 'self' &&
  annotation.metadata.dispatchedAt === undefined

const countAnnotationsInBatch = (batch: FeedbackBatch): number => {
  let count = 0
  for (const list of batch.values()) {
    count += list.length
  }

  return count
}

const countPendingInBatch = (batch: FeedbackBatch): number => {
  let count = 0
  for (const list of batch.values()) {
    for (const annotation of list) {
      if (isPendingReviewAnnotation(annotation)) {
        count += 1
      }
    }
  }

  return count
}

const addAnnotationToBatch = (
  batch: FeedbackBatch,
  key: string,
  annotation: DiffLineAnnotation<ReviewComment>
): FeedbackBatch => {
  const next = new Map(batch)
  const existing = next.get(key) ?? []
  next.set(key, [...existing, annotation])

  return next
}

const updateAnnotationInBatch = (
  batch: FeedbackBatch,
  key: string,
  id: string,
  patch: Partial<ReviewComment>
): FeedbackBatch => {
  const list = batch.get(key)
  if (!list) {
    return batch
  }
  const idx = list.findIndex((a) => a.metadata.id === id)
  if (idx === -1) {
    return batch
  }
  const next = new Map(batch)

  const updated = list.map((a, i) => {
    if (i !== idx) {
      return a
    }

    return {
      ...a,
      metadata: { ...a.metadata, ...patch },
    }
  })
  next.set(key, updated)

  return next
}

const removeAnnotationFromBatch = (
  batch: FeedbackBatch,
  key: string,
  id: string
): FeedbackBatch => {
  const list = batch.get(key)
  if (!list) {
    return batch
  }
  const filtered = list.filter((a) => a.metadata.id !== id)
  const next = new Map(batch)
  if (filtered.length === 0) {
    next.delete(key)
  } else {
    next.set(key, filtered)
  }

  return next
}

/**
 * Stable empty array returned for absent file keys.
 * Must be module-level and frozen so callers get referential equality
 * across renders — prevents Pierre from re-tokenizing or effects from looping.
 */
const EMPTY: DiffLineAnnotation<ReviewComment>[] = []
Object.freeze(EMPTY)

const EMPTY_BATCH: FeedbackBatch = new Map()
Object.freeze(EMPTY_BATCH)

const REPO_ROOT_KEY_SEP = '\0'

const makeRepoRootKey = (ownerKey: string, cwd: string): string =>
  `${ownerKey}${REPO_ROOT_KEY_SEP}${cwd}`

const ownerKeyFromRepoRootKey = (key: string): string =>
  key.split(REPO_ROOT_KEY_SEP)[0] ?? ''

const LOCAL_FEEDBACK_OWNER_KEY = '__local_feedback__'

export interface UseFeedbackBatchReturn {
  batch: FeedbackBatch
  annotationsForFile: (
    cwd: string,
    filePath: string,
    staged: boolean
  ) => DiffLineAnnotation<ReviewComment>[]
  addAnnotation: (
    cwd: string,
    filePath: string,
    staged: boolean,
    annotation: DiffLineAnnotation<ReviewComment>
  ) => 'ok' | 'cap-reached'
  /** Add onto a SPECIFIC owner (not the active one) — for agent replies (VIM-249). */
  addAnnotationForOwner: (
    ownerKey: string,
    cwd: string,
    filePath: string,
    staged: boolean,
    annotation: DiffLineAnnotation<ReviewComment>
  ) => 'ok' | 'cap-reached'
  updateAnnotation: (
    cwd: string,
    filePath: string,
    staged: boolean,
    id: string,
    patch: Partial<ReviewComment>
  ) => void
  removeAnnotation: (
    cwd: string,
    filePath: string,
    staged: boolean,
    id: string
  ) => void
  clearBatch: () => void
  /**
   * Mark every pending comment in the owner as dispatched (keeping them in the
   * hunk as thread anchors) and clear the open draft. Replaces clearBatch on the
   * send path so submitted comments persist instead of being wiped.
   */
  markDispatched: (
    dispatchedAt: number,
    dispatchedAnnotationIds: ReadonlySet<string>,
    options?: { clearDraftForWholeBatch?: boolean; dispatchedTo?: string }
  ) => void
  /**
   * Drop the pending comments and the open draft, leaving already dispatched
   * thread anchors intact. The discard action.
   */
  clearPending: () => void
  totalAnnotations: () => number
  /** Count of pending comments (not yet dispatched) — what Finish/Send acts on. */
  pendingAnnotations: () => number
}

export interface FeedbackBatchSummary {
  ownerKey: string
  fileCount: number
  commentCount: number
  draftCount: number
}

export interface FeedbackRepoRootStoreRef {
  current: string
  repoRootForCwd: (cwd: string) => string
}

interface FeedbackDraftBase {
  cwd: string
  filePath: string
  staged: boolean
  editId?: string
  text: string
  /** The picked category, persisted so it survives a draft restore (VIM-256). */
  category?: ReviewCommentCategory
}

export type FeedbackDraft =
  | (FeedbackDraftBase & {
      scope?: 'line'
      side: AnnotationSide
      lineNumber: number
      rangeEndLine?: number
    })
  | (FeedbackDraftBase & {
      scope: 'file'
    })

export interface FeedbackDraftStore {
  draft: FeedbackDraft | null
  setDraft: (draft: FeedbackDraft | null) => void
}

export interface UseFeedbackBatchStoreReturn {
  feedbackBatch: UseFeedbackBatchReturn
  feedbackRepoRootRef: FeedbackRepoRootStoreRef
  feedbackDraft: FeedbackDraftStore
  summaries: FeedbackBatchSummary[]
  pruneOwners: (liveOwnerKeys: ReadonlySet<string>) => void
}

export const useFeedbackBatchStore = (
  ownerKey: string,
  cwd: string
): UseFeedbackBatchStoreReturn => {
  const [batchesByOwner, setBatchesByOwner] = useState<
    Map<string, FeedbackBatch>
  >(() => new Map())

  const [draftsByOwner, setDraftsByOwner] = useState<
    Map<string, FeedbackDraft>
  >(() => new Map())

  // Mirrors review batches for synchronous optimistic mutations before React
  // commits state; this is the user-visible comment data.
  const optimisticBatchesRef = useRef(batchesByOwner)
  const repoRootsRef = useRef<Map<string, string>>(new Map())
  const addAnnotationResultRef = useRef<'ok' | 'cap-reached'>('ok')

  useEffect(() => {
    optimisticBatchesRef.current = batchesByOwner
  }, [batchesByOwner])

  const batch = batchesByOwner.get(ownerKey) ?? EMPTY_BATCH
  const draft = draftsByOwner.get(ownerKey) ?? null

  const totalAnnotations = useCallback(
    (): number => countAnnotationsInBatch(batch),
    [batch]
  )

  const pendingAnnotations = useCallback(
    (): number => countPendingInBatch(batch),
    [batch]
  )

  const annotationsForFile = useCallback(
    (
      requestedCwd: string,
      filePath: string,
      staged: boolean
    ): DiffLineAnnotation<ReviewComment>[] => {
      const key = makeBatchKey(requestedCwd, filePath, staged)

      return batch.get(key) ?? EMPTY
    },
    [batch]
  )

  // Owner-addressed add: targets a SPECIFIC owner, not the active one. The diff
  // add path uses `addAnnotation` (active owner); an agent reply (VIM-249) uses
  // this to attach onto the owner that dispatched the review, even after the
  // user switched panes.
  const addAnnotationForOwner = useCallback(
    (
      targetOwnerKey: string,
      requestedCwd: string,
      filePath: string,
      staged: boolean,
      annotation: DiffLineAnnotation<ReviewComment>
    ): 'ok' | 'cap-reached' => {
      const key = makeBatchKey(requestedCwd, filePath, staged)

      const optimisticBatch =
        optimisticBatchesRef.current.get(targetOwnerKey) ?? EMPTY_BATCH

      if (
        isPendingReviewAnnotation(annotation) &&
        countPendingInBatch(optimisticBatch) >= SOFT_CAP
      ) {
        addAnnotationResultRef.current = 'cap-reached'

        return addAnnotationResultRef.current
      }

      const optimisticNextBatch = addAnnotationToBatch(
        optimisticBatch,
        key,
        annotation
      )
      optimisticBatchesRef.current = new Map(optimisticBatchesRef.current).set(
        targetOwnerKey,
        optimisticNextBatch
      )
      addAnnotationResultRef.current = 'ok'
      setBatchesByOwner((prev) => {
        const currentBatch = prev.get(targetOwnerKey) ?? EMPTY_BATCH
        if (
          isPendingReviewAnnotation(annotation) &&
          countPendingInBatch(currentBatch) >= SOFT_CAP
        ) {
          addAnnotationResultRef.current = 'cap-reached'
          optimisticBatchesRef.current = prev

          return prev
        }

        const nextBatch = addAnnotationToBatch(currentBatch, key, annotation)
        const next = new Map(prev).set(targetOwnerKey, nextBatch)
        optimisticBatchesRef.current = next
        addAnnotationResultRef.current = 'ok'

        return next
      })

      return addAnnotationResultRef.current
    },
    []
  )

  const addAnnotation = useCallback(
    (
      requestedCwd: string,
      filePath: string,
      staged: boolean,
      annotation: DiffLineAnnotation<ReviewComment>
    ): 'ok' | 'cap-reached' =>
      addAnnotationForOwner(
        ownerKey,
        requestedCwd,
        filePath,
        staged,
        annotation
      ),
    [addAnnotationForOwner, ownerKey]
  )

  const updateAnnotation = useCallback(
    (
      requestedCwd: string,
      filePath: string,
      staged: boolean,
      id: string,
      patch: Partial<ReviewComment>
    ): void => {
      const key = makeBatchKey(requestedCwd, filePath, staged)

      const optimisticBatch =
        optimisticBatchesRef.current.get(ownerKey) ?? EMPTY_BATCH

      const optimisticNextBatch = updateAnnotationInBatch(
        optimisticBatch,
        key,
        id,
        patch
      )
      optimisticBatchesRef.current = new Map(optimisticBatchesRef.current).set(
        ownerKey,
        optimisticNextBatch
      )

      setBatchesByOwner((prev) => {
        const currentBatch = prev.get(ownerKey) ?? EMPTY_BATCH
        const nextBatch = updateAnnotationInBatch(currentBatch, key, id, patch)
        const next = new Map(prev).set(ownerKey, nextBatch)
        optimisticBatchesRef.current = next

        return next
      })
    },
    [ownerKey]
  )

  const removeAnnotation = useCallback(
    (
      requestedCwd: string,
      filePath: string,
      staged: boolean,
      id: string
    ): void => {
      const key = makeBatchKey(requestedCwd, filePath, staged)

      const optimisticBatch =
        optimisticBatchesRef.current.get(ownerKey) ?? EMPTY_BATCH

      const optimisticNextBatch = removeAnnotationFromBatch(
        optimisticBatch,
        key,
        id
      )
      const optimisticNext = new Map(optimisticBatchesRef.current)
      if (optimisticNextBatch.size === 0) {
        optimisticNext.delete(ownerKey)
      } else {
        optimisticNext.set(ownerKey, optimisticNextBatch)
      }
      optimisticBatchesRef.current = optimisticNext

      setBatchesByOwner((prev) => {
        const currentBatch = prev.get(ownerKey) ?? EMPTY_BATCH
        const nextBatch = removeAnnotationFromBatch(currentBatch, key, id)
        const next = new Map(prev)
        if (nextBatch.size === 0) {
          next.delete(ownerKey)
        } else {
          next.set(ownerKey, nextBatch)
        }
        optimisticBatchesRef.current = next

        return next
      })
    },
    [ownerKey]
  )

  const clearBatch = useCallback((): void => {
    setBatchesByOwner((prev) => {
      if (!prev.has(ownerKey)) {
        return prev
      }

      const next = new Map(prev)
      next.delete(ownerKey)
      optimisticBatchesRef.current = next

      return next
    })

    setDraftsByOwner((prev) => {
      if (!prev.has(ownerKey)) {
        return prev
      }

      const next = new Map(prev)
      next.delete(ownerKey)

      return next
    })
  }, [ownerKey])

  const clearOwnerDraft = useCallback((): void => {
    setDraftsByOwner((prev) => {
      if (!prev.has(ownerKey)) {
        return prev
      }

      const next = new Map(prev)
      next.delete(ownerKey)

      return next
    })
  }, [ownerKey])

  // Send path (VIM-282): stamp sent pending comments as dispatched and keep
  // them in the hunk as thread anchors. Whole-batch sends close the active draft;
  // single-comment sends only close an editor draft for the dispatched comment.
  // Unchanged file lists keep their identity so Pierre does not re-tokenize files
  // with no pending comment.
  const markDispatched = useCallback(
    (
      dispatchedAt: number,
      dispatchedAnnotationIds: ReadonlySet<string>,
      options?: { clearDraftForWholeBatch?: boolean; dispatchedTo?: string }
    ): void => {
      setBatchesByOwner((prev) => {
        const currentBatch = prev.get(ownerKey)
        if (currentBatch === undefined || currentBatch.size === 0) {
          return prev
        }

        let changed = false
        const nextBatch: FeedbackBatch = new Map()
        for (const [key, list] of currentBatch) {
          if (
            !list.some(
              (annotation) =>
                isPendingReviewAnnotation(annotation) &&
                dispatchedAnnotationIds.has(annotation.metadata.id)
            )
          ) {
            nextBatch.set(key, list)

            continue
          }

          changed = true
          nextBatch.set(
            key,
            list.map((annotation) =>
              isPendingReviewAnnotation(annotation) &&
              dispatchedAnnotationIds.has(annotation.metadata.id)
                ? {
                    ...annotation,
                    metadata: {
                      ...annotation.metadata,
                      dispatchedAt,
                      threadId:
                        annotation.metadata.threadId ?? annotation.metadata.id,
                      ...(options?.dispatchedTo === undefined
                        ? {}
                        : { dispatchedTo: options.dispatchedTo }),
                    },
                  }
                : annotation
            )
          )
        }

        if (!changed) {
          return prev
        }

        const next = new Map(prev).set(ownerKey, nextBatch)
        optimisticBatchesRef.current = next

        return next
      })

      setDraftsByOwner((prev) => {
        const ownerDraft = prev.get(ownerKey)

        const shouldClearDraft =
          options?.clearDraftForWholeBatch === true ||
          (ownerDraft?.editId !== undefined &&
            dispatchedAnnotationIds.has(ownerDraft.editId))

        if (!shouldClearDraft) {
          return prev
        }

        const next = new Map(prev)
        next.delete(ownerKey)

        return next
      })
    },
    [ownerKey]
  )

  // Discard path (VIM-282): drop pending comments and the draft, but leave
  // dispatched thread anchors in place.
  const clearPending = useCallback((): void => {
    setBatchesByOwner((prev) => {
      const currentBatch = prev.get(ownerKey)
      if (currentBatch === undefined || currentBatch.size === 0) {
        return prev
      }

      let changed = false
      const nextBatch: FeedbackBatch = new Map()
      for (const [key, list] of currentBatch) {
        const kept = list.filter(
          (annotation) => !isPendingReviewAnnotation(annotation)
        )
        if (kept.length === list.length) {
          nextBatch.set(key, list)

          continue
        }
        changed = true
        if (kept.length > 0) {
          nextBatch.set(key, kept)
        }
      }

      if (!changed) {
        return prev
      }

      const next = new Map(prev)
      if (nextBatch.size === 0) {
        next.delete(ownerKey)
      } else {
        next.set(ownerKey, nextBatch)
      }
      optimisticBatchesRef.current = next

      return next
    })

    clearOwnerDraft()
  }, [clearOwnerDraft, ownerKey])

  const setDraft = useCallback(
    (nextDraft: FeedbackDraft | null): void => {
      setDraftsByOwner((prev) => {
        const hasCurrent = prev.has(ownerKey)
        if (nextDraft === null && !hasCurrent) {
          return prev
        }

        const next = new Map(prev)
        if (nextDraft === null) {
          next.delete(ownerKey)
        } else {
          next.set(ownerKey, nextDraft)
        }

        return next
      })
    },
    [ownerKey]
  )

  const feedbackBatch = useMemo<UseFeedbackBatchReturn>(
    () => ({
      batch,
      annotationsForFile,
      addAnnotation,
      addAnnotationForOwner,
      updateAnnotation,
      removeAnnotation,
      clearBatch,
      markDispatched,
      clearPending,
      totalAnnotations,
      pendingAnnotations,
    }),
    [
      batch,
      annotationsForFile,
      addAnnotation,
      addAnnotationForOwner,
      updateAnnotation,
      removeAnnotation,
      clearBatch,
      markDispatched,
      clearPending,
      totalAnnotations,
      pendingAnnotations,
    ]
  )

  const feedbackRepoRootRef = useMemo<FeedbackRepoRootStoreRef>(
    () => ({
      get current(): string {
        return repoRootsRef.current.get(makeRepoRootKey(ownerKey, cwd)) ?? ''
      },
      set current(nextRoot: string) {
        const rootKey = makeRepoRootKey(ownerKey, cwd)
        if (repoRootsRef.current.get(rootKey) === nextRoot) {
          return
        }

        const next = new Map(repoRootsRef.current)
        if (nextRoot.length === 0) {
          next.delete(rootKey)
        } else {
          next.set(rootKey, nextRoot)
        }
        repoRootsRef.current = next
      },
      repoRootForCwd(requestedCwd: string): string {
        return (
          repoRootsRef.current.get(makeRepoRootKey(ownerKey, requestedCwd)) ??
          ''
        )
      },
    }),
    [cwd, ownerKey]
  )

  const feedbackDraft = useMemo<FeedbackDraftStore>(
    () => ({
      draft,
      setDraft,
    }),
    [draft, setDraft]
  )

  const summaries = useMemo<FeedbackBatchSummary[]>(() => {
    const ownerKeys = new Set([
      ...batchesByOwner.keys(),
      ...[...draftsByOwner.entries()]
        .filter(([, entryDraft]) => entryDraft.text.trim().length > 0)
        .map(([entryOwnerKey]) => entryOwnerKey),
    ])

    return [...ownerKeys]
      .map((entryOwnerKey) => {
        const entryBatch = batchesByOwner.get(entryOwnerKey) ?? EMPTY_BATCH
        const entryDraft = draftsByOwner.get(entryOwnerKey) ?? null

        // Only files with a pending comment count as unfinished — dispatched
        // thread anchors are done (VIM-282).
        const fileKeys = new Set(
          [...entryBatch.entries()]
            .filter(([, list]) => list.some(isPendingReviewAnnotation))
            .map(([entryKey]) => entryKey)
        )

        const draftCount =
          entryDraft !== null && entryDraft.text.trim().length > 0 ? 1 : 0

        if (draftCount > 0 && entryDraft !== null) {
          fileKeys.add(
            makeBatchKey(entryDraft.cwd, entryDraft.filePath, entryDraft.staged)
          )
        }

        return {
          ownerKey: entryOwnerKey,
          fileCount: fileKeys.size,
          commentCount: countPendingInBatch(entryBatch),
          draftCount,
        }
      })
      .filter((summary) => summary.commentCount > 0 || summary.draftCount > 0)
  }, [batchesByOwner, draftsByOwner])

  const pruneOwners = useCallback(
    (liveOwnerKeys: ReadonlySet<string>): void => {
      setBatchesByOwner((prev) => {
        const next = new Map(
          [...prev.entries()].filter(([entryOwnerKey]) =>
            liveOwnerKeys.has(entryOwnerKey)
          )
        )

        if (next.size === prev.size) {
          return prev
        }

        optimisticBatchesRef.current = next

        return next
      })

      const nextRepoRoots = new Map(
        [...repoRootsRef.current.entries()].filter(([rootKey]) =>
          liveOwnerKeys.has(ownerKeyFromRepoRootKey(rootKey))
        )
      )

      if (nextRepoRoots.size !== repoRootsRef.current.size) {
        repoRootsRef.current = nextRepoRoots
      }

      setDraftsByOwner((prev) => {
        const next = new Map(
          [...prev.entries()].filter(([entryOwnerKey]) =>
            liveOwnerKeys.has(entryOwnerKey)
          )
        )

        if (next.size === prev.size) {
          return prev
        }

        return next
      })
    },
    []
  )

  return {
    feedbackBatch,
    feedbackRepoRootRef,
    feedbackDraft,
    summaries,
    pruneOwners,
  }
}

export const useFeedbackBatch = (): UseFeedbackBatchReturn =>
  useFeedbackBatchStore(LOCAL_FEEDBACK_OWNER_KEY, '').feedbackBatch
