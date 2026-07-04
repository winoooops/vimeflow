import { useCallback, useEffect, useRef } from 'react'
import type { DiffLineAnnotation } from '@pierre/diffs'
import {
  paintRangeBars,
  rangeBarSpansForAnnotations,
  rangeBarSpansKey,
} from '../rangeBar/diffRangeBars'
import type { ReviewComment } from './useFeedbackBatch'

export interface UseDiffRangeBarsOptions {
  /** Committed line-level annotations for the selected file. */
  annotations: DiffLineAnnotation<ReviewComment>[]
  /** `${path}:${'staged' | 'unstaged'}` or null; a change invalidates in-flight paints. */
  fileKey: string | null
}

export interface UseDiffRangeBarsResult {
  /** Wire to pierre `options.onPostRender` via a stable forwarding callback. */
  handlePostRender: (node: Element) => void
}

/**
 * Draws the persistent gutter bar for committed range comments (VIM-273).
 * Pierre has no decorations API, so — like search — this tags shadow-DOM gutter
 * cells on every `onPostRender` (pierre wipes custom attributes when it
 * rebuilds), coalescing rebuild bursts with a single rAF and guarding stale
 * frames with a monotonic generation token.
 */
export const useDiffRangeBars = ({
  annotations,
  fileKey,
}: UseDiffRangeBarsOptions): UseDiffRangeBarsResult => {
  const containerRef = useRef<Element | null>(null)
  const generationRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  const spans = rangeBarSpansForAnnotations(annotations)
  const spansRef = useRef(spans)
  spansRef.current = spans
  const spansKey = rangeBarSpansKey(spans)

  const cancelPendingFrame = useCallback((): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const handlePostRender = useCallback(
    (node: Element): void => {
      containerRef.current = node
      cancelPendingFrame()

      const generation = generationRef.current
      // One frame coalesces pierre's rebuild bursts (plain → highlighted paint).
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        if (generation !== generationRef.current) {
          return
        }

        paintRangeBars(containerRef.current, spansRef.current)
      })
    },
    [cancelPendingFrame]
  )

  // Re-tag when the committed ranges change without a pierre rebuild — a comment
  // added/removed while the same file stays rendered.
  useEffect(() => {
    paintRangeBars(containerRef.current, spansRef.current)
  }, [spansKey])

  // A file switch invalidates any in-flight frame and the stored container; the
  // next onPostRender re-establishes both.
  useEffect(() => {
    generationRef.current += 1
    cancelPendingFrame()
    containerRef.current = null
  }, [cancelPendingFrame, fileKey])

  useEffect(
    () => (): void => {
      generationRef.current += 1
      cancelPendingFrame()
    },
    [cancelPendingFrame]
  )

  return { handlePostRender }
}
