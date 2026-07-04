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
 * Tagging is idempotent — it reads the live container + spans and rewrites to
 * the current state — so unlike search (which owns the global CSS.highlights
 * registry) it needs no stale-frame/generation guard: a late frame simply paints
 * the truth. A file switch is handled by the new file's own onPostRender, which
 * replaces the container and cancels any in-flight frame.
 */
export const useDiffRangeBars = ({
  annotations,
}: UseDiffRangeBarsOptions): UseDiffRangeBarsResult => {
  const containerRef = useRef<Element | null>(null)
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

      // One frame coalesces pierre's rebuild bursts (plain → highlighted paint).
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
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

  useEffect(() => cancelPendingFrame, [cancelPendingFrame])

  return { handlePostRender }
}
