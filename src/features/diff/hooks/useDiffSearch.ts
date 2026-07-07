import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  clearPaint,
  collectLines,
  paintMatches,
  scrollToMatch,
  type CollectedDiffLines,
} from '../search/diffSearchDom'
import { matchDiffLines, type DiffSearchMatch } from '../search/matchDiffLines'

export interface UseDiffSearchOptions {
  /** `${path}:${'staged' | 'unstaged'}` or null when no diff is shown. */
  fileKey: string | null
  /** Gates ownership of the document-global Highlight registry. */
  paintEnabled: boolean
  /** Returns focus to the diff panel root. */
  focusPanel: () => void
  /** The diff scroll body, so match reveals clear the sticky file header. */
  scrollContainerRef: RefObject<HTMLElement | null>
}

export interface UseDiffSearchResult {
  isOpen: boolean
  query: string
  matchCount: number
  /** 1-based ordinal of the active match; 0 when there are none. */
  activeOrdinal: number
  open: () => void
  close: () => void
  setQuery: (query: string) => void
  step: (direction: 1 | -1) => void
  commit: (direction: 1 | -1) => void
  /** Wire to pierre options.onPostRender via a stable forwarding callback. */
  handlePostRender: (node: Element) => void
  inputRef: RefObject<HTMLInputElement | null>
}

/**
 * State owner for in-file diff search (VIM-252): the popup's open/close
 * lifecycle, the query and its matches over the rendered diff lines,
 * vim-style match navigation (n/p + Enter), and match painting via the CSS
 * Custom Highlight API. Re-collects lines whenever pierre rebuilds its shadow
 * DOM (handlePostRender), with two recompute rules: a file switch resets to
 * the first match; a same-file rebuild preserves then clamps the active one.
 * Contracts: docs/superpowers/specs/2026-07-02-diff-search-design.md §2/§4/§5.
 */
export const useDiffSearch = ({
  fileKey,
  paintEnabled,
  focusPanel,
  scrollContainerRef,
}: UseDiffSearchOptions): UseDiffSearchResult => {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQueryState] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [matches, setMatches] = useState<DiffSearchMatch[]>([])

  const activeIndexRef = useRef(activeIndex)
  const isOpenRef = useRef(isOpen)

  const collectedRef = useRef<CollectedDiffLines>({
    lines: [],
    elements: new Map(),
  })
  const containerRef = useRef<Element | null>(null)
  // Monotonic invalidation token: bumped whenever in-flight work must be
  // abandoned (close, paint-authority loss, unmount). A scheduled frame
  // captures the value and aborts if it changed before running, so a stale
  // callback can never repaint after cleanup.
  const generationRef = useRef(0)
  const hasNavigatedRef = useRef(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const queryRef = useRef(query)
  // Handle of the single requestAnimationFrame scheduled by handlePostRender
  // (null when none) — kept so close/disable/unmount can cancel it.
  const rafRef = useRef<number | null>(null)

  activeIndexRef.current = activeIndex
  isOpenRef.current = isOpen
  queryRef.current = query

  // The "pending frame" is a scheduled-but-not-yet-run rAF callback from
  // handlePostRender; cancelling it stops a stale re-collect/repaint.
  const cancelPendingFrame = useCallback((): void => {
    if (rafRef.current === null) {
      return
    }

    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  const setActive = useCallback((next: number): void => {
    activeIndexRef.current = next
    setActiveIndex(next)
  }, [])

  const resetCollectedMatches = useCallback((): void => {
    collectedRef.current = {
      lines: [],
      elements: new Map(),
    }
    setMatches([])
    setActive(0)
  }, [setActive])

  const resetVisibleMatches = useCallback((): void => {
    setMatches([])
    setActive(0)
  }, [setActive])

  const recompute = useCallback(
    (nextQuery: string, reconcile: (count: number) => number): void => {
      const nextMatches = matchDiffLines(collectedRef.current.lines, nextQuery)
      const nextActive = reconcile(nextMatches.length)
      setMatches(nextMatches)
      setActive(nextActive)
    },
    [setActive]
  )

  useEffect(() => {
    if (!paintEnabled || !isOpen || query === '') {
      clearPaint()

      return
    }

    paintMatches(collectedRef.current, matches, activeIndex)
  }, [activeIndex, isOpen, matches, paintEnabled, query])

  useEffect(() => {
    if (paintEnabled) {
      return
    }

    generationRef.current += 1
    cancelPendingFrame()
    clearPaint()
  }, [cancelPendingFrame, paintEnabled])

  const handlePostRender = useCallback(
    (node: Element): void => {
      containerRef.current = node
      cancelPendingFrame()

      const generation = generationRef.current
      // One frame coalesces pierre's rebuild bursts (plain → highlighted paint).
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null

        // Generation alone gates staleness: losing paint authority bumps it
        // (see the paintEnabled effect), so no separate enabled check needed.
        if (generation !== generationRef.current) {
          return
        }

        collectedRef.current = collectLines(containerRef.current)
        recompute(queryRef.current, (count) =>
          count === 0 ? 0 : Math.min(activeIndexRef.current, count - 1)
        )
      })
    },
    [cancelPendingFrame, recompute]
  )

  const close = useCallback((): void => {
    const wasOpen = isOpenRef.current
    isOpenRef.current = false
    generationRef.current += 1
    cancelPendingFrame()
    setIsOpen(false)
    queryRef.current = ''
    setQueryState('')
    resetVisibleMatches()
    hasNavigatedRef.current = false
    clearPaint()
    if (wasOpen) {
      focusPanel()
    }
  }, [cancelPendingFrame, focusPanel, resetVisibleMatches])

  const open = useCallback((): void => {
    if (fileKey === null) {
      return
    }

    isOpenRef.current = true
    setIsOpen(true)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [fileKey])

  const setQuery = useCallback(
    (next: string): void => {
      queryRef.current = next
      setQueryState(next)
      hasNavigatedRef.current = false
      recompute(next, () => 0)
    },
    [recompute]
  )

  const step = useCallback(
    (direction: 1 | -1): void => {
      if (matches.length === 0) {
        return
      }

      const next = (activeIndex + direction + matches.length) % matches.length
      hasNavigatedRef.current = true
      setActive(next)
      scrollToMatch(
        scrollContainerRef.current,
        matches[next],
        collectedRef.current.elements
      )
    },
    [activeIndex, matches, scrollContainerRef, setActive]
  )

  const commit = useCallback(
    (direction: 1 | -1): void => {
      if (matches.length > 0) {
        if (hasNavigatedRef.current) {
          const next =
            (activeIndex + direction + matches.length) % matches.length
          setActive(next)
          scrollToMatch(
            scrollContainerRef.current,
            matches[next],
            collectedRef.current.elements
          )
        } else {
          hasNavigatedRef.current = true
          scrollToMatch(
            scrollContainerRef.current,
            matches[activeIndex],
            collectedRef.current.elements
          )
        }
      }

      focusPanel()
    },
    [activeIndex, focusPanel, matches, scrollContainerRef, setActive]
  )

  const previousKeyRef = useRef(fileKey)
  useEffect(() => {
    if (fileKey === previousKeyRef.current) {
      return
    }

    previousKeyRef.current = fileKey

    if (fileKey === null) {
      close()

      return
    }

    generationRef.current += 1
    cancelPendingFrame()
    containerRef.current = null
    hasNavigatedRef.current = false
    resetCollectedMatches()
    clearPaint()
  }, [cancelPendingFrame, close, fileKey, resetCollectedMatches])

  useEffect(
    () => (): void => {
      generationRef.current += 1
      cancelPendingFrame()
      clearPaint()
    },
    [cancelPendingFrame]
  )

  const activeOrdinal = matches.length === 0 ? 0 : activeIndex + 1

  return {
    isOpen,
    query,
    matchCount: matches.length,
    activeOrdinal,
    open,
    close,
    setQuery,
    step,
    commit,
    handlePostRender,
    inputRef,
  }
}
