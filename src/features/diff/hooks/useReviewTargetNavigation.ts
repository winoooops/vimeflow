import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import type {
  AnnotationSide,
  DiffLineAnnotation,
  SelectedLineRange,
} from '@pierre/diffs'
import type { FileDiff } from '../types'
import type { DiffStyle } from './useToolbarState'
import type { ReviewComment } from './useFeedbackBatch'

const PIERRE_DIFF_CONTAINER_SELECTOR = 'diffs-container'
const STICKY_HEADER_SCROLL_GAP_PX = 4

// A review target is the stable comment/navigation address behind a rendered
// Pierre row. Keyboard and pointer input both resolve to this same shape.
export interface ReviewNavigationTarget {
  lineNumber: number
  side: AnnotationSide
  hunkIndex: number
  splitRowIndex: number
  changed: boolean
}

interface UseReviewTargetNavigationOptions {
  annotations: DiffLineAnnotation<ReviewComment>[]
  clearTransientSelection: () => void
  diffStyle: DiffStyle
  fileDiff: FileDiff | null
  fileKey: string
  onHunkIndexChange: (hunkIndex: number) => void
  scrollBodyRef: RefObject<HTMLElement | null>
}

interface UseReviewTargetNavigationReturn {
  activeTarget: ReviewNavigationTarget | null
  activeTargetIndex: number
  activateTarget: (targetIndex: number) => void
  activateTargetNearViewportCenter: () => void
  currentTarget: ReviewNavigationTarget | null
  currentTargetComment: DiffLineAnnotation<ReviewComment> | undefined
  deactivateTarget: () => void
  handlePointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  moveTargetLine: (delta: number) => void
  moveTargetSide: (side: AnnotationSide) => void
  scrollHunkIntoView: (hunkIndex: number) => boolean
  scrollTargetIntoView: (
    target: ReviewNavigationTarget,
    targetIndex: number,
    delta: number
  ) => void
  selectedLines: SelectedLineRange | null
  targetIndexFromPointerEvent: (
    event: ReactPointerEvent<HTMLElement>
  ) => number | null
  targetIndexForHunk: (hunkIndex: number) => number
  targets: ReviewNavigationTarget[]
}

// Flattens hunks into row-ordered targets so j/k can move by visible row while
// h/l can switch sides inside the same split replacement row.
const reviewTargetsForDiff = (fileDiff: FileDiff): ReviewNavigationTarget[] => {
  const targets: ReviewNavigationTarget[] = []

  fileDiff.hunks.forEach((hunk, hunkIndex) => {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    let splitRowIndex = 0
    let pendingDeletions: ReviewNavigationTarget[] = []
    let pendingAdditions: ReviewNavigationTarget[] = []

    const flushChangedRows = (): void => {
      const rowCount = Math.max(
        pendingDeletions.length,
        pendingAdditions.length
      )

      for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
        const rowIndex = splitRowIndex + rowOffset
        if (rowOffset < pendingDeletions.length) {
          const deletion = pendingDeletions[rowOffset]
          targets.push({ ...deletion, splitRowIndex: rowIndex })
        }

        if (rowOffset < pendingAdditions.length) {
          const addition = pendingAdditions[rowOffset]
          targets.push({ ...addition, splitRowIndex: rowIndex })
        }
      }

      splitRowIndex += rowCount
      pendingDeletions = []
      pendingAdditions = []
    }

    if (hunk.lines.length === 0) {
      targets.push({
        lineNumber: hunk.newLines === 0 ? hunk.oldStart : hunk.newStart,
        side: hunk.newLines === 0 ? 'deletions' : 'additions',
        hunkIndex,
        splitRowIndex,
        changed: true,
      })

      return
    }

    for (const line of hunk.lines) {
      const oldLineNumber =
        line.oldLineNumber ?? (line.type === 'added' ? undefined : oldLine)

      const newLineNumber =
        line.newLineNumber ?? (line.type === 'removed' ? undefined : newLine)

      if (line.type === 'removed') {
        if (oldLineNumber !== undefined) {
          pendingDeletions.push({
            lineNumber: oldLineNumber,
            side: 'deletions',
            hunkIndex,
            splitRowIndex,
            changed: true,
          })
        }
      } else if (line.type === 'added') {
        if (newLineNumber !== undefined) {
          pendingAdditions.push({
            lineNumber: newLineNumber,
            side: 'additions',
            hunkIndex,
            splitRowIndex,
            changed: true,
          })
        }
      } else {
        flushChangedRows()

        if (newLineNumber !== undefined) {
          targets.push({
            lineNumber: newLineNumber,
            side: 'additions',
            hunkIndex,
            splitRowIndex,
            changed: false,
          })
        }

        splitRowIndex += 1
      }

      if (line.type !== 'added') {
        oldLine += 1
      }

      if (line.type !== 'removed') {
        newLine += 1
      }
    }

    flushChangedRows()
  })

  return targets
}

const sameReviewRow = (
  left: ReviewNavigationTarget,
  right: ReviewNavigationTarget
): boolean =>
  left.hunkIndex === right.hunkIndex &&
  left.splitRowIndex === right.splitRowIndex

const reviewRowIndexForTarget = (
  targets: ReviewNavigationTarget[],
  targetIndex: number
): number => {
  let rowIndex = 0

  for (let index = 1; index <= targetIndex; index += 1) {
    if (!sameReviewRow(targets[index - 1], targets[index])) {
      rowIndex += 1
    }
  }

  return rowIndex
}

const reviewRowCountForTargets = (targets: ReviewNavigationTarget[]): number =>
  targets.length === 0
    ? 0
    : reviewRowIndexForTarget(targets, targets.length - 1) + 1

const reviewTargetIndexForLine = (
  targets: ReviewNavigationTarget[],
  lineNumber: number,
  side: AnnotationSide
): number =>
  targets.findIndex(
    (target) => target.lineNumber === lineNumber && target.side === side
  )

// Pierre exposes side information through different attributes in split and
// unified layouts, so pointer navigation reads the closest reliable marker.
const reviewTargetSideForElement = (
  element: Element
): AnnotationSide | null => {
  const lineType = element.getAttribute('data-line-type')

  if (lineType === 'change-deletion' || lineType === 'removed') {
    return 'deletions'
  }

  if (
    lineType === 'change-addition' ||
    lineType === 'added' ||
    lineType === 'context'
  ) {
    return 'additions'
  }

  if (element.closest('[data-deletions]') !== null) {
    return 'deletions'
  }

  if (element.closest('[data-additions], [data-unified]') !== null) {
    return 'additions'
  }

  return null
}

// Converts a mouse/pointer row into the same target index used by keyboard
// navigation, keeping hover and shortcut movement in sync.
const reviewTargetIndexFromPointerEvent = (
  event: ReactPointerEvent<HTMLElement>,
  targets: ReviewNavigationTarget[]
): number | null => {
  const path = event.nativeEvent.composedPath()

  for (const item of path) {
    if (!(item instanceof Element)) {
      continue
    }

    const line = item.closest<HTMLElement>('[data-line], [data-column-number]')
    if (line === null) {
      continue
    }

    const side = reviewTargetSideForElement(line)

    const lineValue =
      line.getAttribute('data-line') ?? line.getAttribute('data-column-number')
    const lineNumber = lineValue === null ? NaN : Number(lineValue)

    if (side === null || !Number.isFinite(lineNumber)) {
      continue
    }

    const index = reviewTargetIndexForLine(targets, lineNumber, side)

    return index === -1 ? null : index
  }

  return null
}

// Pierre has changed its row attributes across layouts; keep both selectors so
// scrolling works in runtime shadow DOM and test light DOM.
const lineSelectorForReviewTarget = (
  target: ReviewNavigationTarget
): string => {
  const lineNumber = target.lineNumber

  if (target.side === 'deletions') {
    return (
      `[data-line-type="change-deletion"][data-line="${lineNumber}"], ` +
      `[data-line-type="change-deletion"][data-column-number="${lineNumber}"], ` +
      `[data-line-type="removed"][data-line="${lineNumber}"], ` +
      `[data-line-type="removed"][data-column-number="${lineNumber}"]`
    )
  }

  return (
    `[data-line-type="change-addition"][data-line="${lineNumber}"], ` +
    `[data-line-type="change-addition"][data-column-number="${lineNumber}"], ` +
    `[data-line-type="context"][data-line="${lineNumber}"], ` +
    `[data-line-type="context"][data-column-number="${lineNumber}"], ` +
    `[data-line-type="added"][data-line="${lineNumber}"], ` +
    `[data-line-type="added"][data-column-number="${lineNumber}"]`
  )
}

// Some Pierre rows only expose the line number, so fall back to a side-agnostic
// selector after trying the safer side-aware selector.
const fallbackLineSelectorForReviewTarget = (
  target: ReviewNavigationTarget
): string => {
  const lineNumber = target.lineNumber

  return `[data-line="${lineNumber}"], [data-column-number="${lineNumber}"]`
}

// Limits shadow-DOM searches to the relevant split side when possible.
const scopedDiffRootForReviewTarget = (
  shadowRoot: ShadowRoot,
  target: ReviewNavigationTarget
): ParentNode => {
  const sideRoot = shadowRoot.querySelector<HTMLElement>(
    target.side === 'deletions' ? '[data-deletions]' : '[data-additions]'
  )

  return (
    sideRoot ??
    shadowRoot.querySelector<HTMLElement>('[data-unified]') ??
    shadowRoot
  )
}

// Finds the rendered row for a target whether Pierre rendered it in light DOM
// for tests or inside its shadow DOM in the app.
const findReviewTargetLineElement = (
  root: HTMLElement,
  target: ReviewNavigationTarget
): HTMLElement | null => {
  const selector = lineSelectorForReviewTarget(target)
  const fallbackSelector = fallbackLineSelectorForReviewTarget(target)

  const localLine =
    root.querySelector<HTMLElement>(selector) ??
    root.querySelector<HTMLElement>(fallbackSelector)

  if (localLine !== null) {
    return localLine
  }

  for (const container of root.querySelectorAll<HTMLElement>(
    PIERRE_DIFF_CONTAINER_SELECTOR
  )) {
    const shadowRoot = container.shadowRoot
    if (shadowRoot === null) {
      continue
    }

    const scopedRoot = scopedDiffRootForReviewTarget(shadowRoot, target)

    const line =
      scopedRoot.querySelector<HTMLElement>(selector) ??
      scopedRoot.querySelector<HTMLElement>(fallbackSelector)

    if (line !== null) {
      return line
    }
  }

  return null
}

// Hunk jumps prefer showing the whole hunk when it can fit in the scroll body.
const lineRangeFitsContainer = (
  container: HTMLElement,
  firstLine: HTMLElement,
  lastLine: HTMLElement
): boolean => {
  if (container.clientHeight <= 0) {
    return true
  }

  const firstRect = firstLine.getBoundingClientRect()
  const lastRect = lastLine.getBoundingClientRect()
  const top = Math.min(firstRect.top, lastRect.top)
  const bottom = Math.max(firstRect.bottom, lastRect.bottom)

  return bottom - top <= container.clientHeight
}

// Sticky Pierre headers can cover the first visible row after scrollIntoView,
// so measure the active header before nudging rows clear of it.
const stickyHeaderOffsetForDiffRoot = (root: HTMLElement): number => {
  const headers = [
    ...root.querySelectorAll<HTMLElement>('[data-diffs-header][data-sticky]'),
  ]

  for (const container of root.querySelectorAll<HTMLElement>(
    PIERRE_DIFF_CONTAINER_SELECTOR
  )) {
    if (container.shadowRoot !== null) {
      headers.push(
        ...container.shadowRoot.querySelectorAll<HTMLElement>(
          '[data-diffs-header][data-sticky]'
        )
      )
    }
  }

  const height = Math.max(
    0,
    ...headers.map((header) => header.getBoundingClientRect().height)
  )

  return height === 0 ? 0 : height + STICKY_HEADER_SCROLL_GAP_PX
}

// Corrects scrollIntoView when the target row lands underneath the sticky
// header instead of actually being visible.
const revealLineBelowStickyHeader = (
  container: HTMLElement,
  line: HTMLElement,
  reservePreviousRow: boolean
): void => {
  const stickyOffset = stickyHeaderOffsetForDiffRoot(container)
  if (stickyOffset === 0) {
    return
  }

  const containerTop = container.getBoundingClientRect().top
  const lineRect = line.getBoundingClientRect()
  const rowOffset = reservePreviousRow ? lineRect.height : 0
  const overlap = containerTop + stickyOffset + rowOffset - lineRect.top

  if (overlap > 0) {
    container.scrollTop = Math.max(0, container.scrollTop - Math.ceil(overlap))
  }
}

// Applies the small set of scroll rules the diff view needs: nearest for normal
// moves, top/bottom at the file edges, then sticky-header correction.
const scrollLineElementIntoView = (
  container: HTMLElement,
  line: HTMLElement,
  targetIndex: number,
  targetCount: number,
  delta: number
): void => {
  if (delta === 0) {
    line.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    revealLineBelowStickyHeader(container, line, false)

    return
  }

  if (targetCount === 1) {
    line.scrollIntoView({
      block: delta > 0 ? 'end' : 'start',
      inline: 'nearest',
    })
    revealLineBelowStickyHeader(container, line, delta < 0)

    return
  }

  if (targetIndex === 0) {
    line.scrollIntoView({ block: 'start', inline: 'nearest' })
    revealLineBelowStickyHeader(container, line, delta < 0)

    return
  }

  if (targetIndex === targetCount - 1) {
    line.scrollIntoView({ block: 'end', inline: 'nearest' })
    revealLineBelowStickyHeader(container, line, false)

    return
  }

  line.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  revealLineBelowStickyHeader(container, line, delta < 0)
}

// After page scrolling, use the row closest to the viewport center as the new
// current target so the next j/k move continues from what the user sees.
const reviewTargetIndexClosestToViewportCenter = (
  container: HTMLElement,
  targets: ReviewNavigationTarget[]
): number | null => {
  const containerRect = container.getBoundingClientRect()
  const containerHeight = containerRect.height || container.clientHeight
  const viewportCenter = containerRect.top + containerHeight / 2
  let bestIndex: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  targets.forEach((target, index) => {
    const line = findReviewTargetLineElement(container, target)
    if (line === null) {
      return
    }

    const lineRect = line.getBoundingClientRect()
    const lineCenter = (lineRect.top + lineRect.bottom) / 2
    const distance = Math.abs(lineCenter - viewportCenter)

    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })

  return bestIndex
}

/**
 * Keeps review navigation out of Panel.
 *
 * The hook builds one target list from the current file diff, tracks the current
 * row plus whether it is visually active, and exposes plain callbacks for
 * keyboard, pointer, hunk, and page-scroll navigation.
 */
export const useReviewTargetNavigation = ({
  annotations,
  clearTransientSelection,
  diffStyle,
  fileDiff,
  fileKey,
  onHunkIndexChange,
  scrollBodyRef,
}: UseReviewTargetNavigationOptions): UseReviewTargetNavigationReturn => {
  const targets = useMemo(
    (): ReviewNavigationTarget[] =>
      fileDiff === null ? [] : reviewTargetsForDiff(fileDiff),
    [fileDiff]
  )

  const [activeTargetIndex, setActiveTargetIndex] = useState(0)
  const [active, setActive] = useState(false)

  useEffect(() => {
    setActiveTargetIndex(0)
    setActive(false)
  }, [fileKey])

  useEffect(() => {
    if (targets.length === 0) {
      setActiveTargetIndex(0)
      setActive(false)

      return
    }

    setActiveTargetIndex((prev) => Math.min(prev, targets.length - 1))
  }, [targets.length])

  const currentTarget =
    targets.length > 0
      ? targets[Math.min(activeTargetIndex, targets.length - 1)]
      : null

  const activeTarget = active ? currentTarget : null

  const selectedLines: SelectedLineRange | null =
    active && currentTarget !== null
      ? {
          start: currentTarget.lineNumber,
          end: currentTarget.lineNumber,
          side: currentTarget.side,
        }
      : null

  const currentTargetComment = useMemo(():
    | DiffLineAnnotation<ReviewComment>
    | undefined => {
    if (currentTarget === null) {
      return undefined
    }

    return annotations.find(
      (annotation) =>
        annotation.lineNumber === currentTarget.lineNumber &&
        annotation.side === currentTarget.side
    )
  }, [currentTarget, annotations])

  const activateTarget = useCallback(
    (targetIndex: number): void => {
      if (targetIndex < 0 || targetIndex >= targets.length) {
        return
      }

      const target = targets[targetIndex]

      clearTransientSelection()
      setActive(true)
      setActiveTargetIndex(targetIndex)
      onHunkIndexChange(target.hunkIndex)
    },
    [clearTransientSelection, onHunkIndexChange, targets]
  )

  // Hides the visual cursor without forgetting the current row for shortcuts.
  const deactivateTarget = useCallback((): void => {
    setActive(false)
  }, [])

  // Scrolls one target row into view after keyboard, hunk, or side movement.
  const scrollTargetIntoView = useCallback(
    (
      target: ReviewNavigationTarget,
      targetIndex: number,
      delta: number
    ): void => {
      const node = scrollBodyRef.current
      if (node === null) {
        return
      }

      const line = findReviewTargetLineElement(node, target)
      if (line === null) {
        return
      }

      scrollLineElementIntoView(
        node,
        line,
        diffStyle === 'split'
          ? reviewRowIndexForTarget(targets, targetIndex)
          : targetIndex,
        diffStyle === 'split'
          ? reviewRowCountForTargets(targets)
          : targets.length,
        delta
      )
    },
    [diffStyle, scrollBodyRef, targets]
  )

  // Hunk jumps show the first hunk row, then include the rest when it fits.
  const scrollHunkIntoView = useCallback(
    (hunkIndex: number): boolean => {
      const node = scrollBodyRef.current
      if (node === null) {
        return false
      }

      const hunkTargets = targets.filter(
        (target) => target.hunkIndex === hunkIndex
      )
      if (hunkTargets.length === 0) {
        return false
      }

      const firstTarget = hunkTargets[0]
      const lastTarget = hunkTargets[hunkTargets.length - 1]
      const firstLine = findReviewTargetLineElement(node, firstTarget)
      const lastLine = findReviewTargetLineElement(node, lastTarget)
      if (firstLine === null || lastLine === null) {
        return false
      }

      firstLine.scrollIntoView({ block: 'start', inline: 'nearest' })

      if (
        firstLine === lastLine ||
        !lineRangeFitsContainer(node, firstLine, lastLine)
      ) {
        return true
      }

      lastLine.scrollIntoView({ block: 'nearest', inline: 'nearest' })

      return true
    },
    [scrollBodyRef, targets]
  )

  // Hunk navigation lands on the first changed row when possible, not on
  // unchanged context above the actual change.
  const targetIndexForHunk = useCallback(
    (hunkIndex: number): number => {
      const changedTargetIndex = targets.findIndex(
        (target) => target.hunkIndex === hunkIndex && target.changed
      )

      return changedTargetIndex === -1
        ? targets.findIndex((target) => target.hunkIndex === hunkIndex)
        : changedTargetIndex
    },
    [targets]
  )

  // Ctrl+U/D moves the scroll body first, then snaps the target to the visible
  // row closest to the viewport center.
  const activateTargetNearViewportCenter = useCallback((): void => {
    const node = scrollBodyRef.current
    if (node === null) {
      return
    }

    const targetIndex = reviewTargetIndexClosestToViewportCenter(node, targets)

    if (targetIndex !== null) {
      activateTarget(targetIndex)
    }
  }, [activateTarget, scrollBodyRef, targets])

  // j/k move by rendered row. In split mode, replacement pairs count as one row
  // so h/l, not j/k, changes between old and new sides.
  const moveTargetLine = useCallback(
    (delta: number): void => {
      if (targets.length === 0) {
        return
      }

      clearTransientSelection()
      setActive(true)
      setActiveTargetIndex((prev) => {
        const currentIndex = Math.min(prev, targets.length - 1)
        const baseTarget = targets[currentIndex]
        let rowTargetIndex = currentIndex + delta

        if (rowTargetIndex < 0 || rowTargetIndex >= targets.length) {
          return currentIndex
        }

        if (diffStyle === 'split') {
          rowTargetIndex = currentIndex

          while (
            rowTargetIndex + delta >= 0 &&
            rowTargetIndex + delta < targets.length
          ) {
            rowTargetIndex += delta

            const rowTarget = targets[rowTargetIndex]
            if (
              rowTarget.hunkIndex !== baseTarget.hunkIndex ||
              rowTarget.splitRowIndex !== baseTarget.splitRowIndex
            ) {
              break
            }
          }
        }

        const rowTarget = targets[rowTargetIndex]

        const sameSideIndex = targets.findIndex(
          (target) =>
            target.hunkIndex === rowTarget.hunkIndex &&
            target.splitRowIndex === rowTarget.splitRowIndex &&
            target.side === baseTarget.side
        )

        const next =
          diffStyle === 'split' && sameSideIndex !== -1
            ? sameSideIndex
            : rowTargetIndex
        if (next === currentIndex) {
          return currentIndex
        }

        const nextTarget = targets[next]
        onHunkIndexChange(nextTarget.hunkIndex)
        scrollTargetIntoView(nextTarget, next, delta)

        return next
      })
    },
    [
      clearTransientSelection,
      diffStyle,
      onHunkIndexChange,
      scrollTargetIntoView,
      targets,
    ]
  )

  // h/l switch sides within the same split row when both sides exist.
  const moveTargetSide = useCallback(
    (side: AnnotationSide): void => {
      if (diffStyle !== 'split' || currentTarget === null) {
        return
      }

      const nextIndex = targets.findIndex(
        (target) =>
          target.hunkIndex === currentTarget.hunkIndex &&
          target.splitRowIndex === currentTarget.splitRowIndex &&
          target.side === side
      )

      if (nextIndex === -1 || nextIndex === activeTargetIndex) {
        return
      }

      const nextTarget = targets[nextIndex]
      activateTarget(nextIndex)
      scrollTargetIntoView(nextTarget, nextIndex, 0)
    },
    [
      activeTargetIndex,
      activateTarget,
      currentTarget,
      diffStyle,
      scrollTargetIntoView,
      targets,
    ]
  )

  // Pointer hover updates the same current target used by shortcuts.
  const targetIndexFromPointerEvent = useCallback(
    (event: ReactPointerEvent<HTMLElement>): number | null =>
      reviewTargetIndexFromPointerEvent(event, targets),
    [targets]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const targetIndex = targetIndexFromPointerEvent(event)

      if (targetIndex !== null) {
        activateTarget(targetIndex)
      }
    },
    [activateTarget, targetIndexFromPointerEvent]
  )

  return {
    activeTarget,
    activeTargetIndex,
    activateTarget,
    activateTargetNearViewportCenter,
    currentTarget,
    currentTargetComment,
    deactivateTarget,
    handlePointerMove,
    moveTargetLine,
    moveTargetSide,
    scrollHunkIntoView,
    scrollTargetIntoView,
    selectedLines,
    targetIndexFromPointerEvent,
    targetIndexForHunk,
    targets,
  }
}
