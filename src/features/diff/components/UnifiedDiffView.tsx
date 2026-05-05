import type { ReactElement } from 'react'
import type { FileDiff } from '../types'
import { DiffLine } from './DiffLine'
import { DiffHunkHeader } from './DiffHunkHeader'

export interface UnifiedDiffViewProps {
  diff: FileDiff
  focusedHunkIndex: number
  focusedLineIndex: number
  onLineClick?: (hunkIndex: number, lineIndex: number) => void
}

const UnifiedDiffView = ({
  diff,
  focusedHunkIndex,
  focusedLineIndex,
  onLineClick = undefined,
}: UnifiedDiffViewProps): ReactElement => (
  <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
    <div
      data-testid="unified-pane"
      className="thin-scrollbar min-w-0 flex-1 overflow-auto font-code text-xs"
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

              return (
                <DiffLine
                  key={`${hunk.id}-${currentLineIndex}`}
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
)

export default UnifiedDiffView
