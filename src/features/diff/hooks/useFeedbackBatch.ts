import { useCallback, useState } from 'react'
import type { DiffLineAnnotation } from '@pierre/diffs'

export interface ReviewComment {
  id: string
  text: string
  author: 'self'
  createdAt: number
}

export type FeedbackBatch = Map<
  /** batchKey: `${cwd}::${filePath}` */
  string,
  DiffLineAnnotation<ReviewComment>[]
>

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
  ) => DiffLineAnnotation<ReviewComment>[]
  addAnnotation: (
    cwd: string,
    filePath: string,
    annotation: DiffLineAnnotation<ReviewComment>,
  ) => 'ok' | 'cap-reached'
  updateAnnotation: (
    cwd: string,
    filePath: string,
    id: string,
    patch: Partial<ReviewComment>,
  ) => void
  removeAnnotation: (cwd: string, filePath: string, id: string) => void
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
    (cwd: string, filePath: string): DiffLineAnnotation<ReviewComment>[] => {
      const key = `${cwd}::${filePath}`

      return batch.get(key) ?? EMPTY
    },
    [batch],
  )

  const addAnnotation = useCallback(
    (
      cwd: string,
      filePath: string,
      annotation: DiffLineAnnotation<ReviewComment>,
    ): 'ok' | 'cap-reached' => {
      if (totalAnnotations() >= SOFT_CAP) {
        return 'cap-reached'
      }
      const key = `${cwd}::${filePath}`
      setBatch((prev) => {
        const next = new Map(prev)
        const existing = next.get(key) ?? []
        next.set(key, [...existing, annotation])

        return next
      })

      return 'ok'
    },
    [totalAnnotations],
  )

  const updateAnnotation = useCallback(
    (
      cwd: string,
      filePath: string,
      id: string,
      patch: Partial<ReviewComment>,
    ): void => {
      const key = `${cwd}::${filePath}`
      setBatch((prev) => {
        const list = prev.get(key)
        if (!list) {return prev}
        const idx = list.findIndex((a) => a.metadata.id === id)
        if (idx === -1) {return prev}
        const next = new Map(prev)

        const updated = list.map((a, i) => {
          if (i !== idx) {return a}

          return {
            ...a,
            metadata: { ...a.metadata, ...patch },
          }
        })
        next.set(key, updated)

        return next
      })
    },
    [],
  )

  const removeAnnotation = useCallback(
    (cwd: string, filePath: string, id: string): void => {
      const key = `${cwd}::${filePath}`
      setBatch((prev) => {
        const list = prev.get(key)
        if (!list) {return prev}
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
    [],
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
