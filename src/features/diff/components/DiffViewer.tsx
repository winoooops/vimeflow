import type { ReactElement } from 'react'
import SplitDiffView from './SplitDiffView'
import UnifiedDiffView from './UnifiedDiffView'
import type { FileDiff, DiffViewMode } from '../types'

export interface DiffViewerProps {
  fileDiff: FileDiff
  viewMode: DiffViewMode
  focusedHunkIndex: number
  focusedLineIndex: number
  onLineClick?: (hunkIndex: number, lineIndex: number) => void
}

export const DiffViewer = ({
  fileDiff,
  viewMode,
  focusedHunkIndex,
  focusedLineIndex,
  onLineClick = undefined,
}: DiffViewerProps): ReactElement => (
  <div className="h-full overflow-auto">
    {viewMode === 'split' ? (
      <SplitDiffView
        diff={fileDiff}
        focusedHunkIndex={focusedHunkIndex}
        focusedLineIndex={focusedLineIndex}
        onLineClick={onLineClick}
      />
    ) : (
      <UnifiedDiffView
        diff={fileDiff}
        focusedHunkIndex={focusedHunkIndex}
        focusedLineIndex={focusedLineIndex}
        onLineClick={onLineClick}
      />
    )}
  </div>
)
