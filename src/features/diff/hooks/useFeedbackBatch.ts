import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DiffLineAnnotation } from '@pierre/diffs'

export interface ReviewComment {
  id: string
  text: string
  author: 'self'
  createdAt: number
}

/**
 * Sentinel annotation id for the in-progress draft comment — the one the
 * editor is editing before it is committed to the batch. DiffPanelContent
 * renders the comment editor instead of a row from this single definition.
 */
export const DRAFT_ID = '__draft__'

export type FeedbackBatch = Map<
  /** batchKey: `${cwd}::${filePath}::${staged ? 'staged' : 'unstaged'}` */
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

const countAnnotationsInBatch = (batch: FeedbackBatch): number => {
  let count = 0
  for (const list of batch.values()) {
    count += list.length
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
  totalAnnotations: () => number
}

export interface FeedbackBatchSummary {
  ownerKey: string
  fileCount: number
  commentCount: number
}

export interface FeedbackRepoRootStoreRef {
  current: string
  repoRootForCwd: (cwd: string) => string
}

export interface UseFeedbackBatchStoreReturn {
  feedbackBatch: UseFeedbackBatchReturn
  feedbackRepoRootRef: FeedbackRepoRootStoreRef
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

  // Mirrors review batches for synchronous optimistic mutations before React
  // commits state; this is the user-visible comment data.
  const optimisticBatchesRef = useRef(batchesByOwner)
  const repoRootsRef = useRef<Map<string, string>>(new Map())
  const addAnnotationResultRef = useRef<'ok' | 'cap-reached'>('ok')

  useEffect(() => {
    optimisticBatchesRef.current = batchesByOwner
  }, [batchesByOwner])

  const batch = batchesByOwner.get(ownerKey) ?? EMPTY_BATCH

  const totalAnnotations = useCallback(
    (): number => countAnnotationsInBatch(batch),
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

  const addAnnotation = useCallback(
    (
      requestedCwd: string,
      filePath: string,
      staged: boolean,
      annotation: DiffLineAnnotation<ReviewComment>
    ): 'ok' | 'cap-reached' => {
      const key = makeBatchKey(requestedCwd, filePath, staged)

      const optimisticBatch =
        optimisticBatchesRef.current.get(ownerKey) ?? EMPTY_BATCH

      if (countAnnotationsInBatch(optimisticBatch) >= SOFT_CAP) {
        addAnnotationResultRef.current = 'cap-reached'

        return addAnnotationResultRef.current
      }

      const optimisticNextBatch = addAnnotationToBatch(
        optimisticBatch,
        key,
        annotation
      )
      optimisticBatchesRef.current = new Map(optimisticBatchesRef.current).set(
        ownerKey,
        optimisticNextBatch
      )
      addAnnotationResultRef.current = 'ok'
      setBatchesByOwner((prev) => {
        const currentBatch = prev.get(ownerKey) ?? EMPTY_BATCH
        if (countAnnotationsInBatch(currentBatch) >= SOFT_CAP) {
          addAnnotationResultRef.current = 'cap-reached'
          optimisticBatchesRef.current = prev

          return prev
        }

        const nextBatch = addAnnotationToBatch(currentBatch, key, annotation)
        const next = new Map(prev).set(ownerKey, nextBatch)
        optimisticBatchesRef.current = next
        addAnnotationResultRef.current = 'ok'

        return next
      })

      return addAnnotationResultRef.current
    },
    [ownerKey]
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
  }, [ownerKey])

  const feedbackBatch = useMemo<UseFeedbackBatchReturn>(
    () => ({
      batch,
      annotationsForFile,
      addAnnotation,
      updateAnnotation,
      removeAnnotation,
      clearBatch,
      totalAnnotations,
    }),
    [
      batch,
      annotationsForFile,
      addAnnotation,
      updateAnnotation,
      removeAnnotation,
      clearBatch,
      totalAnnotations,
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

  const summaries = useMemo<FeedbackBatchSummary[]>(
    () =>
      [...batchesByOwner.entries()]
        .map(([entryOwnerKey, entryBatch]) => ({
          ownerKey: entryOwnerKey,
          fileCount: entryBatch.size,
          commentCount: countAnnotationsInBatch(entryBatch),
        }))
        .filter((summary) => summary.commentCount > 0),
    [batchesByOwner]
  )

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
    },
    []
  )

  return {
    feedbackBatch,
    feedbackRepoRootRef,
    summaries,
    pruneOwners,
  }
}

export const useFeedbackBatch = (): UseFeedbackBatchReturn =>
  useFeedbackBatchStore(LOCAL_FEEDBACK_OWNER_KEY, '').feedbackBatch
