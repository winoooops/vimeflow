import { useRef, useEffect, type ReactElement } from 'react'
import type { FileDiff } from '../types'
import { DiffLine } from './DiffLine'
import { DiffHunkHeader } from './DiffHunkHeader'

export interface SplitDiffViewProps {
  diff: FileDiff
  focusedHunkIndex: number
  focusedLineIndex: number
  onLineClick?: (hunkIndex: number, lineIndex: number) => void
}

const SplitDiffView = ({
  diff,
  focusedHunkIndex,
  focusedLineIndex,
  onLineClick = undefined,
}: SplitDiffViewProps): ReactElement => {
  const leftPaneRef = useRef<HTMLDivElement>(null)
  const rightPaneRef = useRef<HTMLDivElement>(null)

  // Synchronized scrolling between panes
  useEffect(() => {
    const leftPane = leftPaneRef.current
    const rightPane = rightPaneRef.current

    if (!leftPane || !rightPane) {
      return
    }

    const handleLeftScroll = (): void => {
      rightPane.scrollTop = leftPane.scrollTop
    }

    const handleRightScroll = (): void => {
      leftPane.scrollTop = rightPane.scrollTop
    }

    leftPane.addEventListener('scroll', handleLeftScroll)
    rightPane.addEventListener('scroll', handleRightScroll)

    return (): void => {
      leftPane.removeEventListener('scroll', handleLeftScroll)
      rightPane.removeEventListener('scroll', handleRightScroll)
    }
  }, [])

  const fileName = diff.filePath.split('/').pop() ?? diff.filePath

  return (
    <div className="grid grid-cols-2 gap-px h-full">
      {/* Before pane (left) */}
      <div className="flex flex-col h-full overflow-hidden">
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-surface-container-highest/70 backdrop-blur-sm px-4 py-2 border-b border-outline-variant/10">
          <span className="material-symbols-outlined text-[1rem] text-on-surface-variant">
            history
          </span>
          <span className="font-label text-sm text-on-surface-variant">
            Before: {fileName}
          </span>
        </div>

        <div
          ref={leftPaneRef}
          data-testid="before-pane"
          className="overflow-y-auto flex-1 font-code text-xs"
        >
          {diff.hunks.map((hunk, hunkIndex) => {
            let lineIndex = 0

            return (
              <div key={hunk.id}>
                <DiffHunkHeader header={hunk.header} />

                {hunk.lines.map((line) => {
                  const currentLineIndex = lineIndex
                  lineIndex++

                  const isFocused =
                    hunkIndex === focusedHunkIndex &&
                    currentLineIndex === focusedLineIndex

                  // Only show removed and context lines in the before pane
                  if (line.type === 'added') {
                    return null
                  }

                  return (
                    <DiffLine
                      key={`${hunk.id}-before-${currentLineIndex}`}
                      line={line}
                      isFocused={isFocused}
                      onRightClick={() =>
                        onLineClick?.(hunkIndex, currentLineIndex)
                      }
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* After pane (right) */}
      <div className="flex flex-col h-full overflow-hidden">
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-surface-container-highest/70 backdrop-blur-sm px-4 py-2 border-b border-outline-variant/10">
          <span className="material-symbols-outlined text-[1rem] text-on-surface-variant">
            edit
          </span>
          <span className="font-label text-sm text-on-surface-variant">
            After: {fileName}
          </span>
        </div>

        <div
          ref={rightPaneRef}
          data-testid="after-pane"
          className="overflow-y-auto flex-1 font-code text-xs"
        >
          {diff.hunks.map((hunk, hunkIndex) => {
            let lineIndex = 0

            return (
              <div key={hunk.id}>
                <DiffHunkHeader header={hunk.header} />

                {hunk.lines.map((line) => {
                  const currentLineIndex = lineIndex
                  lineIndex++

                  const isFocused =
                    hunkIndex === focusedHunkIndex &&
                    currentLineIndex === focusedLineIndex

                  // Only show added and context lines in the after pane
                  if (line.type === 'removed') {
                    return null
                  }

                  return (
                    <DiffLine
                      key={`${hunk.id}-after-${currentLineIndex}`}
                      line={line}
                      isFocused={isFocused}
                      onRightClick={() =>
                        onLineClick?.(hunkIndex, currentLineIndex)
                      }
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default SplitDiffView
