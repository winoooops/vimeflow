import { useCallback, useState } from 'react'
import type { DiffLineAnnotation } from '@pierre/diffs'

export interface ReviewComment {
  id: string
  text: string
  author: 'self'
  createdAt: number
}

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

/**
 * The batch Map is keyed by a single string encoding (cwd, filePath, staged).
 * Construction (`makeBatchKey`) and parsing (`parseBatchKey`) live together so
 * the format has ONE source of truth — consumers (e.g. the dispatch path in
 * DiffPanelContent) must use these instead of hand-slicing on `::`, so a format
 * change can't silently break parsing in callers.
 */
export const makeBatchKey = (
  cwd: string,
  filePath: string,
  staged: boolean
): string => `${cwd}::${filePath}::${staged ? 'staged' : 'unstaged'}`

export const parseBatchKey = (key: string): ParsedBatchKey => {
  const firstSep = key.indexOf('::')
  const lastSep = key.lastIndexOf('::')

  return {
    cwd: key.slice(0, firstSep),
    filePath: key.slice(firstSep + 2, lastSep),
    staged: key.slice(lastSep + 2) === 'staged',
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
