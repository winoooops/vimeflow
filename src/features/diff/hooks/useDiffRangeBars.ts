import { useCallback, useEffect, useRef } from 'react'
import type { DiffLineAnnotation } from '@pierre/diffs'
import {
  paintRangeBars,
  rangeBarSpansForAnnotations,
  rangeBarSpansKey,
} from '../rangeBar/diffRangeBars'
import type { ReviewComment } from './useFeedbackBatch'

export interface UseDiffRangeBarsOptions {
  /** Identity for the selected file whose diff DOM owns these annotations. */
  fileKey: string | null
  /** Committed line-level annotations for the selected file. */
  annotations: DiffLineAnnotation<ReviewComment>[]
}

export interface UseDiffRangeBarsResult {
  /** Wire to pierre `options.onPostRender` via a stable forwarding callback. */
  handlePostRender: (node: Element) => void
}

/**
 * Draws the persistent gutter bar for committed range comments (VIM-273).
 * Pierre has no decorations API, so — like search — this tags shadow-DOM gutter
 * cells on every `onPostRender` (pierre wipes custom attributes when it
 * rebuilds), coalescing rebuild bursts with a single rAF.
 *
 * Tagging is idempotent when the stored container still belongs to the selected
 * file: it reads the live container + spans and rewrites to the current state.
 * File switches invalidate the retained Pierre container until the new file's
 * own `onPostRender` stores a matching container, preventing annotation changes
 * from repainting stale shadow DOM from the previously selected file.
 */
export const useDiffRangeBars = ({
  fileKey,
  annotations,
}: UseDiffRangeBarsOptions): UseDiffRangeBarsResult => {
  const containerRef = useRef<Element | null>(null)
  const containerFileKeyRef = useRef<string | null>(null)
  const previousFileKeyRef = useRef(fileKey)
  const fileKeyRef = useRef(fileKey)
  const rafRef = useRef<number | null>(null)

  if (previousFileKeyRef.current !== fileKey) {
    previousFileKeyRef.current = fileKey
    containerRef.current = null
    containerFileKeyRef.current = null
  }

  const spans = rangeBarSpansForAnnotations(annotations)
  const spansRef = useRef(spans)
  spansRef.current = spans
  fileKeyRef.current = fileKey
  const spansKey = rangeBarSpansKey(spans)

  const cancelPendingFrame = useCallback((): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const paintStoredContainer = useCallback((): void => {
    if (
      fileKeyRef.current === null ||
      containerFileKeyRef.current !== fileKeyRef.current
    ) {
      return
    }

    paintRangeBars(containerRef.current, spansRef.current)
  }, [])

  const handlePostRender = useCallback(
    (node: Element): void => {
      containerRef.current = node
      containerFileKeyRef.current = fileKey
      cancelPendingFrame()

      // One frame coalesces pierre's rebuild bursts (plain → highlighted paint).
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        paintStoredContainer()
      })
    },
    [cancelPendingFrame, fileKey, paintStoredContainer]
  )

  // Re-tag when the committed ranges change without a pierre rebuild — a comment
  // added/removed while the same file stays rendered.
  useEffect(() => {
    paintStoredContainer()
  }, [paintStoredContainer, spansKey])

  useEffect(() => cancelPendingFrame, [cancelPendingFrame])

  return { handlePostRender }
}
