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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { AnnotationSide, DiffLineAnnotation } from '@pierre/diffs'
import type { AgentReplyStatus } from '@/bindings'
import { isDesktop } from '@/lib/environment'
import { createLogger } from '@/lib/log'
import { registerRendererTeardownFlush } from '@/lib/teardownFlush'
import {
  pendingReviewsRevision,
  persistedPendingReviews,
  restorePendingReviews,
  subscribePendingReviews,
} from '../services/pendingReviews'
import {
  persistedFindingThreads,
  persistedPendingReviewRequests,
  persistedReviewLevelNotes,
  restoreReviewRequestState,
  reviewRequestStateRevision,
  subscribeReviewLevelNotes,
} from '../services/pendingReviewRequests'
import {
  deleteReviewOwnerState,
  drainReviewStateWrites,
  loadReviewState,
  REVIEW_STATE_VERSION,
  saveReviewState,
  type PersistedReviewState,
} from '../services/reviewStatePersistence'

const log = createLogger('review-state')

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

const EMPTY_THREAD_DRAFTS: ReadonlyMap<string, string> = new Map()
Object.freeze(EMPTY_THREAD_DRAFTS)

const REPO_ROOT_KEY_SEP = '\0'

const makeRepoRootKey = (ownerKey: string, cwd: string): string =>
  `${ownerKey}${REPO_ROOT_KEY_SEP}${cwd}`

const ownerKeyFromRepoRootKey = (key: string): string =>
  key.split(REPO_ROOT_KEY_SEP)[0] ?? ''

const LOCAL_FEEDBACK_OWNER_KEY = '__local_feedback__'

interface ReviewPersistenceContext {
  ownerKey: string
  cwd: string
  ptyId?: string
  hydrationTarget: string
  saveTarget: string
}

interface QueuedReviewSave extends ReviewPersistenceContext {
  state: PersistedReviewState
  serializedState: string
}

const emptyPersistedReviewState = (): PersistedReviewState => ({
  version: REVIEW_STATE_VERSION,
  annotations: [],
  draft: null,
  threadDrafts: [],
  pendingReviews: [],
  pendingReviewRequests: [],
  findingThreads: [],
  reviewLevelNotes: [],
})

const makePersistenceTarget = (
  ownerKey: string,
  cwd: string,
  ptyId?: string
): string => `${ownerKey}${KEY_SEP}${cwd}${KEY_SEP}${ptyId ?? ''}`

const makePersistenceSaveTarget = (ownerKey: string, cwd: string): string =>
  `${ownerKey}${KEY_SEP}${cwd}`

const ownerKeyFromPersistenceTarget = (target: string): string =>
  target.split(KEY_SEP)[0] ?? ''

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
  threadDrafts?: ReadonlyMap<string, string>
  setThreadDraft?: (threadId: string, text: string | null) => void
}

export interface UseFeedbackBatchStoreReturn {
  feedbackBatch: UseFeedbackBatchReturn
  feedbackRepoRootRef: FeedbackRepoRootStoreRef
  feedbackDraft: FeedbackDraftStore
  summaries: FeedbackBatchSummary[]
  pruneOwners: (liveOwnerKeys: ReadonlySet<string>) => void
  isOwnerReviewStateReady: (ownerKey: string) => boolean
  hydrating: boolean
  hydrationFailed: boolean
}

const persistedStateForOwner = (
  ownerKey: string,
  cwd: string,
  batch: FeedbackBatch,
  draft: FeedbackDraft | null,
  threadDrafts: ReadonlyMap<string, string>
): PersistedReviewState => {
  let persistedDraft: PersistedReviewState['draft'] = null
  if (draft?.cwd === cwd && draft.text.trim().length > 0) {
    const { cwd: draftCwd, ...draftWithoutCwd } = draft
    void draftCwd
    persistedDraft = draftWithoutCwd
  }

  return {
    version: REVIEW_STATE_VERSION,
    annotations: [...batch.entries()].flatMap(([key, annotations]) => {
      const parsed = parseBatchKey(key)
      if (parsed.cwd !== cwd) {
        return []
      }

      return annotations.map((annotation) => ({
        filePath: parsed.filePath,
        staged: parsed.staged,
        annotation,
      }))
    }),
    draft: persistedDraft,
    threadDrafts: [...threadDrafts.entries()].filter(
      ([, text]) => text.trim().length > 0
    ),
    pendingReviews: persistedPendingReviews(ownerKey),
    pendingReviewRequests: persistedPendingReviewRequests(ownerKey),
    findingThreads: persistedFindingThreads(ownerKey),
    reviewLevelNotes: persistedReviewLevelNotes(ownerKey),
  }
}

export const useFeedbackBatchStore = (
  ownerKey: string,
  cwd: string,
  currentPtyId?: string
): UseFeedbackBatchStoreReturn => {
  const [batchesByOwner, setBatchesByOwner] = useState<
    Map<string, FeedbackBatch>
  >(() => new Map())

  const [draftsByOwner, setDraftsByOwner] = useState<
    Map<string, FeedbackDraft>
  >(() => new Map())

  const [threadDraftsByOwner, setThreadDraftsByOwner] = useState<
    Map<string, ReadonlyMap<string, string>>
  >(() => new Map())

  // Mirrors review batches for synchronous optimistic mutations before React
  // commits state; this is the user-visible comment data.
  const optimisticBatchesRef = useRef(batchesByOwner)
  const draftsByOwnerRef = useRef(draftsByOwner)
  const threadDraftsByOwnerRef = useRef(threadDraftsByOwner)
  const repoRootsRef = useRef<Map<string, string>>(new Map())
  const addAnnotationResultRef = useRef<'ok' | 'cap-reached'>('ok')
  const previousLiveOwnerKeysRef = useRef<ReadonlySet<string> | null>(null)

  const persistenceContextsRef = useRef<Map<string, ReviewPersistenceContext>>(
    new Map()
  )
  const hydratedPersistenceTargetsRef = useRef<Map<string, string>>(new Map())
  const desiredSnapshotsRef = useRef<Map<string, string>>(new Map())
  const latestReviewSavesRef = useRef<Map<string, QueuedReviewSave>>(new Map())

  const reviewSaveTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map())

  const persistenceEnabled =
    isDesktop() &&
    ownerKey !== LOCAL_FEEDBACK_OWNER_KEY &&
    (cwd.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cwd))

  const persistenceContext = useMemo<ReviewPersistenceContext | null>(
    () =>
      persistenceEnabled
        ? {
            ownerKey,
            cwd,
            ...(currentPtyId === undefined ? {} : { ptyId: currentPtyId }),
            hydrationTarget: makePersistenceTarget(ownerKey, cwd, currentPtyId),
            saveTarget: makePersistenceSaveTarget(ownerKey, cwd),
          }
        : null,
    [currentPtyId, cwd, ownerKey, persistenceEnabled]
  )
  const persistenceTarget = persistenceContext?.hydrationTarget ?? null
  if (persistenceContext !== null) {
    persistenceContextsRef.current.set(ownerKey, persistenceContext)
  }

  const [settledPersistenceTarget, setSettledPersistenceTarget] = useState<
    string | null
  >(null)

  const [failedPersistenceTarget, setFailedPersistenceTarget] = useState<
    string | null
  >(null)

  const pendingReviewRevision = useSyncExternalStore(
    subscribePendingReviews,
    pendingReviewsRevision,
    pendingReviewsRevision
  )

  const requestStateRevision = useSyncExternalStore(
    subscribeReviewLevelNotes,
    reviewRequestStateRevision,
    reviewRequestStateRevision
  )

  useLayoutEffect(() => {
    optimisticBatchesRef.current = batchesByOwner
    draftsByOwnerRef.current = draftsByOwner
    threadDraftsByOwnerRef.current = threadDraftsByOwner
  }, [batchesByOwner, draftsByOwner, threadDraftsByOwner])

  const batch = batchesByOwner.get(ownerKey) ?? EMPTY_BATCH
  const draft = draftsByOwner.get(ownerKey) ?? null
  const threadDrafts = threadDraftsByOwner.get(ownerKey) ?? EMPTY_THREAD_DRAFTS

  const persistReviewSave = useCallback(
    async (save: QueuedReviewSave): Promise<void> => {
      try {
        await saveReviewState(save.cwd, save.ownerKey, save.state)
      } catch (error) {
        log.warn('review state persistence failed', error)
        if (
          desiredSnapshotsRef.current.get(save.saveTarget) ===
            save.serializedState &&
          !latestReviewSavesRef.current.has(save.saveTarget)
        ) {
          latestReviewSavesRef.current.set(save.saveTarget, save)
        }
      }
    },
    []
  )

  const flushReviewSave = useCallback(
    async (saveTarget: string): Promise<void> => {
      const timer = reviewSaveTimersRef.current.get(saveTarget)
      if (timer !== undefined) {
        clearTimeout(timer)
        reviewSaveTimersRef.current.delete(saveTarget)
      }

      const latest = latestReviewSavesRef.current.get(saveTarget)
      if (latest === undefined) {
        return
      }
      latestReviewSavesRef.current.delete(saveTarget)
      await persistReviewSave(latest)
    },
    [persistReviewSave]
  )

  const queueReviewSave = useCallback(
    (context: ReviewPersistenceContext, state: PersistedReviewState): void => {
      const serializedState = JSON.stringify(state)
      if (
        desiredSnapshotsRef.current.get(context.saveTarget) === serializedState
      ) {
        return
      }

      const existingTimer = reviewSaveTimersRef.current.get(context.saveTarget)
      if (existingTimer !== undefined) {
        clearTimeout(existingTimer)
        reviewSaveTimersRef.current.delete(context.saveTarget)
      }

      const save: QueuedReviewSave = {
        ...context,
        state,
        serializedState,
      }
      desiredSnapshotsRef.current.set(context.saveTarget, serializedState)
      latestReviewSavesRef.current.set(context.saveTarget, save)
      reviewSaveTimersRef.current.set(
        context.saveTarget,
        setTimeout(() => {
          reviewSaveTimersRef.current.delete(context.saveTarget)
          if (latestReviewSavesRef.current.get(context.saveTarget) !== save) {
            return
          }
          latestReviewSavesRef.current.delete(context.saveTarget)
          void persistReviewSave(save)
        }, 150)
      )
    },
    [persistReviewSave]
  )

  const flushAllReviewState = useCallback(async (): Promise<void> => {
    const saveTargets = new Set(latestReviewSavesRef.current.keys())
    for (const context of persistenceContextsRef.current.values()) {
      if (
        hydratedPersistenceTargetsRef.current.get(context.ownerKey) !==
        context.hydrationTarget
      ) {
        continue
      }

      queueReviewSave(
        context,
        persistedStateForOwner(
          context.ownerKey,
          context.cwd,
          optimisticBatchesRef.current.get(context.ownerKey) ?? EMPTY_BATCH,
          draftsByOwnerRef.current.get(context.ownerKey) ?? null,
          threadDraftsByOwnerRef.current.get(context.ownerKey) ??
            EMPTY_THREAD_DRAFTS
        )
      )
      saveTargets.add(context.saveTarget)
    }

    await Promise.all(
      [...saveTargets].map(async (target) => flushReviewSave(target))
    )
    await drainReviewStateWrites()
  }, [flushReviewSave, queueReviewSave])

  useEffect(
    () => registerRendererTeardownFlush(flushAllReviewState),
    [flushAllReviewState]
  )

  useEffect(() => {
    if (persistenceTarget === null) {
      setSettledPersistenceTarget(null)
      setFailedPersistenceTarget(null)

      return undefined
    }

    let cancelled = false
    const hydratedTargets = hydratedPersistenceTargetsRef.current

    const hydrate = async (): Promise<void> => {
      if (
        hydratedPersistenceTargetsRef.current.get(ownerKey) ===
        persistenceTarget
      ) {
        setSettledPersistenceTarget(persistenceTarget)
        setFailedPersistenceTarget(null)

        return
      }

      try {
        if (
          persistenceContext !== null &&
          latestReviewSavesRef.current.has(persistenceContext.saveTarget)
        ) {
          await flushReviewSave(persistenceContext.saveTarget)
        }

        const loadedState = await loadReviewState(cwd, ownerKey)
        if (cancelled) {
          return
        }

        const retainedState =
          persistenceContext === null
            ? undefined
            : latestReviewSavesRef.current.get(persistenceContext.saveTarget)
                ?.state
        const state = retainedState ?? loadedState

        let restoredBatch: FeedbackBatch = new Map()
        for (const entry of state?.annotations ?? []) {
          restoredBatch = addAnnotationToBatch(
            restoredBatch,
            makeBatchKey(cwd, entry.filePath, entry.staged),
            entry.annotation
          )
        }

        setBatchesByOwner((previous) => {
          const next = new Map(previous)
          if (restoredBatch.size === 0) {
            next.delete(ownerKey)
          } else {
            next.set(ownerKey, restoredBatch)
          }
          optimisticBatchesRef.current = next

          return next
        })

        setDraftsByOwner((previous) => {
          const next = new Map(previous)
          if (state?.draft === null || state?.draft === undefined) {
            next.delete(ownerKey)
          } else {
            next.set(ownerKey, { cwd, ...state.draft } as FeedbackDraft)
          }
          draftsByOwnerRef.current = next

          return next
        })

        setThreadDraftsByOwner((previous) => {
          const next = new Map(previous)
          if (state === null || state.threadDrafts.length === 0) {
            next.delete(ownerKey)
          } else {
            next.set(ownerKey, new Map(state.threadDrafts))
          }
          threadDraftsByOwnerRef.current = next

          return next
        })

        restorePendingReviews(
          ownerKey,
          cwd,
          currentPtyId,
          state?.pendingReviews ?? []
        )

        restoreReviewRequestState(
          ownerKey,
          cwd,
          currentPtyId,
          state?.pendingReviewRequests ?? [],
          state?.findingThreads ?? [],
          state?.reviewLevelNotes ?? []
        )

        const context = persistenceContextsRef.current.get(ownerKey)
        if (context?.hydrationTarget !== persistenceTarget) {
          return
        }

        const serializedState = JSON.stringify(
          state ?? emptyPersistedReviewState()
        )
        desiredSnapshotsRef.current.set(context.saveTarget, serializedState)
        hydratedPersistenceTargetsRef.current.set(ownerKey, persistenceTarget)
        setFailedPersistenceTarget(null)
        setSettledPersistenceTarget(persistenceTarget)
      } catch (error) {
        log.warn('review state hydration failed', error)
        if (!cancelled) {
          setFailedPersistenceTarget(persistenceTarget)
          setSettledPersistenceTarget(persistenceTarget)
        }
      }
    }

    void hydrate()

    return (): void => {
      cancelled = true
      if (
        persistenceContext !== null &&
        hydratedTargets.get(persistenceContext.ownerKey) ===
          persistenceContext.hydrationTarget
      ) {
        queueReviewSave(
          persistenceContext,
          persistedStateForOwner(
            persistenceContext.ownerKey,
            persistenceContext.cwd,
            optimisticBatchesRef.current.get(persistenceContext.ownerKey) ??
              EMPTY_BATCH,
            draftsByOwnerRef.current.get(persistenceContext.ownerKey) ?? null,
            threadDraftsByOwnerRef.current.get(persistenceContext.ownerKey) ??
              EMPTY_THREAD_DRAFTS
          )
        )
        void flushReviewSave(persistenceContext.saveTarget)
      }
    }
  }, [
    currentPtyId,
    cwd,
    flushReviewSave,
    ownerKey,
    persistenceContext,
    persistenceTarget,
    queueReviewSave,
  ])

  useEffect(() => {
    for (const context of persistenceContextsRef.current.values()) {
      if (
        hydratedPersistenceTargetsRef.current.get(context.ownerKey) !==
        context.hydrationTarget
      ) {
        continue
      }

      queueReviewSave(
        context,
        persistedStateForOwner(
          context.ownerKey,
          context.cwd,
          batchesByOwner.get(context.ownerKey) ?? EMPTY_BATCH,
          draftsByOwner.get(context.ownerKey) ?? null,
          threadDraftsByOwner.get(context.ownerKey) ?? EMPTY_THREAD_DRAFTS
        )
      )
    }
  }, [
    batchesByOwner,
    draftsByOwner,
    pendingReviewRevision,
    queueReviewSave,
    requestStateRevision,
    settledPersistenceTarget,
    threadDraftsByOwner,
  ])

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

    setThreadDraftsByOwner((previous) => {
      if (!previous.has(ownerKey)) {
        return previous
      }
      const next = new Map(previous)
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

  const setThreadDraft = useCallback(
    (threadId: string, text: string | null): void => {
      setThreadDraftsByOwner((previous) => {
        const ownerDrafts = previous.get(ownerKey) ?? EMPTY_THREAD_DRAFTS
        if (text === null && !ownerDrafts.has(threadId)) {
          return previous
        }

        const nextOwnerDrafts = new Map(ownerDrafts)
        if (text === null) {
          nextOwnerDrafts.delete(threadId)
        } else {
          nextOwnerDrafts.set(threadId, text)
        }

        const next = new Map(previous)
        if (nextOwnerDrafts.size === 0) {
          next.delete(ownerKey)
        } else {
          next.set(ownerKey, nextOwnerDrafts)
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
      threadDrafts,
      setThreadDraft,
    }),
    [draft, setDraft, setThreadDraft, threadDrafts]
  )

  const summaries = useMemo<FeedbackBatchSummary[]>(() => {
    const ownerKeys = new Set([
      ...batchesByOwner.keys(),
      ...[...draftsByOwner.entries()]
        .filter(([, entryDraft]) => entryDraft.text.trim().length > 0)
        .map(([entryOwnerKey]) => entryOwnerKey),
      ...threadDraftsByOwner.keys(),
    ])

    return [...ownerKeys]
      .map((entryOwnerKey) => {
        const entryBatch = batchesByOwner.get(entryOwnerKey) ?? EMPTY_BATCH
        const entryDraft = draftsByOwner.get(entryOwnerKey) ?? null

        const entryThreadDrafts =
          threadDraftsByOwner.get(entryOwnerKey) ?? EMPTY_THREAD_DRAFTS

        // Only files with a pending comment count as unfinished — dispatched
        // thread anchors are done (VIM-282).
        const fileKeys = new Set(
          [...entryBatch.entries()]
            .filter(([, list]) => list.some(isPendingReviewAnnotation))
            .map(([entryKey]) => entryKey)
        )

        const draftCount =
          (entryDraft !== null && entryDraft.text.trim().length > 0 ? 1 : 0) +
          [...entryThreadDrafts.values()].filter(
            (text) => text.trim().length > 0
          ).length

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
  }, [batchesByOwner, draftsByOwner, threadDraftsByOwner])

  const pruneOwners = useCallback(
    (liveOwnerKeys: ReadonlySet<string>): void => {
      const previousLiveOwnerKeys = previousLiveOwnerKeysRef.current
      if (previousLiveOwnerKeys !== null) {
        for (const previousOwnerKey of previousLiveOwnerKeys) {
          if (!liveOwnerKeys.has(previousOwnerKey)) {
            const deleteOwnerState = async (): Promise<void> => {
              try {
                await deleteReviewOwnerState(previousOwnerKey)
              } catch (error) {
                log.warn('review owner cleanup failed', error)
              }
            }

            void deleteOwnerState()
          }
        }
      }
      previousLiveOwnerKeysRef.current = new Set(liveOwnerKeys)

      for (const [entryOwnerKey, context] of persistenceContextsRef.current) {
        if (liveOwnerKeys.has(entryOwnerKey)) {
          continue
        }
        const timer = reviewSaveTimersRef.current.get(context.saveTarget)
        if (timer !== undefined) {
          clearTimeout(timer)
          reviewSaveTimersRef.current.delete(context.saveTarget)
        }
        latestReviewSavesRef.current.delete(context.saveTarget)
        persistenceContextsRef.current.delete(entryOwnerKey)
        hydratedPersistenceTargetsRef.current.delete(entryOwnerKey)
      }
      for (const target of desiredSnapshotsRef.current.keys()) {
        if (!liveOwnerKeys.has(ownerKeyFromPersistenceTarget(target))) {
          desiredSnapshotsRef.current.delete(target)
        }
      }

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

      setThreadDraftsByOwner((previous) => {
        const next = new Map(
          [...previous.entries()].filter(([entryOwnerKey]) =>
            liveOwnerKeys.has(entryOwnerKey)
          )
        )

        return next.size === previous.size ? previous : next
      })
    },
    []
  )

  const isOwnerReviewStateReady = useCallback(
    (targetOwnerKey: string): boolean => {
      const context = persistenceContextsRef.current.get(targetOwnerKey)

      return (
        context === undefined ||
        hydratedPersistenceTargetsRef.current.get(targetOwnerKey) ===
          context.hydrationTarget
      )
    },
    []
  )

  return {
    feedbackBatch,
    feedbackRepoRootRef,
    feedbackDraft,
    summaries,
    pruneOwners,
    isOwnerReviewStateReady,
    hydrating:
      persistenceTarget !== null &&
      settledPersistenceTarget !== persistenceTarget,
    hydrationFailed:
      persistenceTarget !== null &&
      failedPersistenceTarget === persistenceTarget,
  }
}

export const useFeedbackBatch = (): UseFeedbackBatchReturn =>
  useFeedbackBatchStore(LOCAL_FEEDBACK_OWNER_KEY, '').feedbackBatch
