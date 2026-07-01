import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { AnnotationSide, SelectedLineRange } from '@pierre/diffs'
import { writeClipboardText } from '@/lib/clipboard'
import type { DiffHunk } from '../types'
import type { DiffStyle } from './useToolbarState'
import type { ReviewNavigationTarget } from './useReviewTargetNavigation'

interface VisualSelection {
  anchorIndex: number
  focusIndex: number
}

interface UseVisualSelectionOptions {
  activeHunks: DiffHunk[] | null
  activeTargetIndex: number
  activateTarget: (targetIndex: number) => void
  diffStyle: DiffStyle
  fileKey: string
  focusDiffRoot: () => void
  moveTargetLine: (delta: number) => void
  moveTargetSide: (side: AnnotationSide) => void
  notifyInfo: (message: string) => void
  onPointerHover: (event: ReactPointerEvent<HTMLElement>) => void
  scrollTargetIntoView: (
    target: ReviewNavigationTarget,
    targetIndex: number,
    delta: number
  ) => void
  shouldIgnorePointerTarget?: (target: EventTarget | null) => boolean
  targetIndexFromPointerEvent: (
    event: ReactPointerEvent<HTMLElement>
  ) => number | null
  targets: ReviewNavigationTarget[]
}

interface UseVisualSelectionReturn {
  active: boolean
  selectedLines: SelectedLineRange | null
  cancel: (focusDiff?: boolean) => void
  moveLine: (delta: number) => void
  moveMouse: (event: ReactPointerEvent<HTMLElement>) => void
  moveSide: (side: AnnotationSide) => void
  start: () => void
  startMouse: (event: ReactPointerEvent<HTMLElement>) => void
  stopMouse: () => void
  yank: () => void
}

const rangeForVisualSelection = (
  targets: ReviewNavigationTarget[],
  selection: VisualSelection | null
): SelectedLineRange | null => {
  if (selection === null) {
    return null
  }

  if (
    selection.anchorIndex < 0 ||
    selection.focusIndex < 0 ||
    selection.anchorIndex >= targets.length ||
    selection.focusIndex >= targets.length
  ) {
    return null
  }

  const anchor = targets[selection.anchorIndex]
  const focus = targets[selection.focusIndex]

  if (anchor.side !== focus.side) {
    return { start: focus.lineNumber, end: focus.lineNumber, side: focus.side }
  }

  return {
    start: Math.min(anchor.lineNumber, focus.lineNumber),
    end: Math.max(anchor.lineNumber, focus.lineNumber),
    side: focus.side,
  }
}

const moveTargetIndexByLine = (
  targets: ReviewNavigationTarget[],
  current: number,
  delta: number,
  diffStyle: DiffStyle
): number => {
  if (targets.length === 0) {
    return current
  }

  const currentIndex = Math.min(current, targets.length - 1)
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

  return diffStyle === 'split' && sameSideIndex !== -1
    ? sameSideIndex
    : rowTargetIndex
}

const moveTargetIndexToSide = (
  targets: ReviewNavigationTarget[],
  current: number,
  side: AnnotationSide
): number => {
  if (current < 0 || current >= targets.length) {
    return current
  }

  const currentTarget = targets[current]

  const nextIndex = targets.findIndex(
    (target) =>
      target.hunkIndex === currentTarget.hunkIndex &&
      target.splitRowIndex === currentTarget.splitRowIndex &&
      target.side === side
  )

  return nextIndex === -1 ? current : nextIndex
}

const textForRange = (range: SelectedLineRange, hunks: DiffHunk[]): string => {
  const lines: string[] = []

  for (const hunk of hunks) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart

    for (const line of hunk.lines) {
      const oldLineNumber =
        line.oldLineNumber ?? (line.type === 'added' ? undefined : oldLine)

      const newLineNumber =
        line.newLineNumber ?? (line.type === 'removed' ? undefined : newLine)

      const lineNumber =
        range.side === 'deletions' ? oldLineNumber : newLineNumber

      if (
        lineNumber !== undefined &&
        lineNumber >= range.start &&
        lineNumber <= range.end
      ) {
        lines.push(line.content)
      }

      if (line.type !== 'added') {
        oldLine += 1
      }

      if (line.type !== 'removed') {
        newLine += 1
      }
    }
  }

  return lines.join('\n')
}

export const useVisualSelection = ({
  activeHunks,
  activeTargetIndex,
  activateTarget,
  diffStyle,
  fileKey,
  focusDiffRoot,
  moveTargetLine,
  moveTargetSide,
  notifyInfo,
  onPointerHover,
  scrollTargetIntoView,
  shouldIgnorePointerTarget = undefined,
  targetIndexFromPointerEvent,
  targets,
}: UseVisualSelectionOptions): UseVisualSelectionReturn => {
  const [selection, setSelection] = useState<VisualSelection | null>(null)
  const dragActiveRef = useRef(false)

  const selectedLines = useMemo(
    (): SelectedLineRange | null => rangeForVisualSelection(targets, selection),
    [targets, selection]
  )

  useEffect(() => {
    setSelection(null)
    dragActiveRef.current = false
  }, [fileKey])

  useEffect(() => {
    setSelection((current) => {
      if (current === null) {
        return null
      }

      if (
        current.anchorIndex >= targets.length ||
        current.focusIndex >= targets.length
      ) {
        return null
      }

      return current
    })
  }, [targets.length])

  const cancel = useCallback(
    (focusDiff = true): void => {
      dragActiveRef.current = false
      setSelection(null)
      if (focusDiff) {
        focusDiffRoot()
      }
    },
    [focusDiffRoot]
  )

  const start = useCallback((): void => {
    if (targets.length === 0) {
      notifyInfo('No diff line selected.')

      return
    }

    const index = Math.min(activeTargetIndex, targets.length - 1)
    activateTarget(index)
    setSelection({ anchorIndex: index, focusIndex: index })
    focusDiffRoot()
  }, [
    activateTarget,
    activeTargetIndex,
    focusDiffRoot,
    notifyInfo,
    targets.length,
  ])

  const startMouse = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (
        event.button > 0 ||
        shouldIgnorePointerTarget?.(event.target) === true
      ) {
        return
      }

      const targetIndex = targetIndexFromPointerEvent(event)
      if (targetIndex === null) {
        return
      }

      event.preventDefault()
      dragActiveRef.current = true
      activateTarget(targetIndex)
      setSelection({ anchorIndex: targetIndex, focusIndex: targetIndex })
      focusDiffRoot()
    },
    [
      activateTarget,
      focusDiffRoot,
      shouldIgnorePointerTarget,
      targetIndexFromPointerEvent,
    ]
  )

  const moveMouse = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (!dragActiveRef.current) {
        onPointerHover(event)

        return
      }

      const targetIndex = targetIndexFromPointerEvent(event)
      if (targetIndex === null) {
        return
      }

      activateTarget(targetIndex)
      setSelection((current) =>
        current === null
          ? { anchorIndex: targetIndex, focusIndex: targetIndex }
          : { ...current, focusIndex: targetIndex }
      )
    },
    [activateTarget, onPointerHover, targetIndexFromPointerEvent]
  )

  const stopMouse = useCallback((): void => {
    dragActiveRef.current = false
  }, [])

  const moveLine = useCallback(
    (delta: number): void => {
      if (selection === null) {
        moveTargetLine(delta)
        focusDiffRoot()

        return
      }

      if (targets.length === 0) {
        return
      }

      const nextIndex = moveTargetIndexByLine(
        targets,
        selection.focusIndex,
        delta,
        diffStyle
      )
      const nextTarget = targets[nextIndex]

      activateTarget(nextIndex)
      scrollTargetIntoView(nextTarget, nextIndex, delta)
      setSelection((current) =>
        current === null ? null : { ...current, focusIndex: nextIndex }
      )
      focusDiffRoot()
    },
    [
      activateTarget,
      diffStyle,
      focusDiffRoot,
      moveTargetLine,
      scrollTargetIntoView,
      selection,
      targets,
    ]
  )

  const moveSide = useCallback(
    (side: AnnotationSide): void => {
      if (selection === null) {
        moveTargetSide(side)
        focusDiffRoot()

        return
      }

      if (diffStyle !== 'split' || targets.length === 0) {
        return
      }

      const nextIndex = moveTargetIndexToSide(
        targets,
        selection.focusIndex,
        side
      )
      const nextTarget = targets[nextIndex]

      activateTarget(nextIndex)
      scrollTargetIntoView(nextTarget, nextIndex, 0)
      setSelection({ anchorIndex: nextIndex, focusIndex: nextIndex })
      focusDiffRoot()
    },
    [
      activateTarget,
      diffStyle,
      focusDiffRoot,
      moveTargetSide,
      scrollTargetIntoView,
      selection,
      targets,
    ]
  )

  const yank = useCallback((): void => {
    if (selectedLines === null || activeHunks === null) {
      notifyInfo('No visual selection to copy.')

      return
    }

    const snippet = textForRange(selectedLines, activeHunks)

    if (snippet.length === 0) {
      notifyInfo('Selected range has no text to copy.')

      return
    }

    cancel(false)
    focusDiffRoot()
    void (async (): Promise<void> => {
      const copied = await writeClipboardText(snippet)
      if (!copied) {
        notifyInfo('Could not copy selection to clipboard.')
      }
    })()
  }, [activeHunks, cancel, focusDiffRoot, notifyInfo, selectedLines])

  return {
    active: selection !== null,
    selectedLines,
    cancel,
    moveLine,
    moveMouse,
    moveSide,
    start,
    startMouse,
    stopMouse,
    yank,
  }
}
