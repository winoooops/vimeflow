import { useCallback, useState } from 'react'
import type { DiffLineAnnotation } from '@pierre/diffs'

export interface ReviewComment {
  id: string
  text: string
  author: 'self'
  createdAt: number
}

/**
 * Sentinel annotation id for the in-progress draft comment — the one the
 * composer is editing before it is committed to the batch. Shared so
 * DiffPanelContent and the dev demo both render the composer (not a row) for
 * it from a single definition.
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

/**
 * Stable empty array returned for absent file keys.
 * Must be module-level and frozen so callers get referential equality
 * across renders — prevents Pierre from re-tokenizing or effects from looping.
 */
const EMPTY: DiffLineAnnotation<ReviewComment>[] = []
Object.freeze(EMPTY)

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

export const useFeedbackBatch = (): UseFeedbackBatchReturn => {
  const [batch, setBatch] = useState<FeedbackBatch>(() => new Map())

  const totalAnnotations = useCallback((): number => {
    let count = 0
    for (const list of batch.values()) {
      count += list.length
    }

    return count
  }, [batch])

  const annotationsForFile = useCallback(
    (
      cwd: string,
      filePath: string,
      staged: boolean
    ): DiffLineAnnotation<ReviewComment>[] => {
      const key = makeBatchKey(cwd, filePath, staged)

      return batch.get(key) ?? EMPTY
    },
    [batch]
  )

  const addAnnotation = useCallback(
    (
      cwd: string,
      filePath: string,
      staged: boolean,
      annotation: DiffLineAnnotation<ReviewComment>
    ): 'ok' | 'cap-reached' => {
      if (totalAnnotations() >= SOFT_CAP) {
        return 'cap-reached'
      }
      const key = makeBatchKey(cwd, filePath, staged)
      setBatch((prev) => {
        const next = new Map(prev)
        const existing = next.get(key) ?? []
        next.set(key, [...existing, annotation])

        return next
      })

      return 'ok'
    },
    [totalAnnotations]
  )

  const updateAnnotation = useCallback(
    (
      cwd: string,
      filePath: string,
      staged: boolean,
      id: string,
      patch: Partial<ReviewComment>
    ): void => {
      const key = makeBatchKey(cwd, filePath, staged)
      setBatch((prev) => {
        const list = prev.get(key)
        if (!list) {
          return prev
        }
        const idx = list.findIndex((a) => a.metadata.id === id)
        if (idx === -1) {
          return prev
        }
        const next = new Map(prev)

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
      })
    },
    []
  )

  const removeAnnotation = useCallback(
    (cwd: string, filePath: string, staged: boolean, id: string): void => {
      const key = makeBatchKey(cwd, filePath, staged)
      setBatch((prev) => {
        const list = prev.get(key)
        if (!list) {
          return prev
        }
        const filtered = list.filter((a) => a.metadata.id !== id)
        const next = new Map(prev)
        if (filtered.length === 0) {
          next.delete(key)
        } else {
          next.set(key, filtered)
        }

        return next
      })
    },
    []
  )

  const clearBatch = useCallback((): void => {
    setBatch(() => new Map())
  }, [])

  return {
    batch,
    annotationsForFile,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    clearBatch,
    totalAnnotations,
  }
}
