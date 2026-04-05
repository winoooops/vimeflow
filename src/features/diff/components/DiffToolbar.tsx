import type { ReactElement } from 'react'
import type { DiffViewMode } from '../types'

export interface DiffToolbarProps {
  viewMode: DiffViewMode
  currentHunkIndex: number
  totalHunks: number
  onViewModeChange: (mode: DiffViewMode) => void
  onPreviousHunk: () => void
  onNextHunk: () => void
  onDiscard: () => void
  onStageHunk: () => void
}

const DiffToolbar = ({
  viewMode,
  currentHunkIndex,
  totalHunks,
  onViewModeChange,
  onPreviousHunk,
  onNextHunk,
  onDiscard,
  onStageHunk,
}: DiffToolbarProps): ReactElement => {
  const hunkCounter =
    totalHunks === 0
      ? '0 of 0 changes'
      : `${currentHunkIndex + 1} of ${totalHunks} changes`

  return (
    <div className="flex items-center justify-between gap-4 bg-surface-container-low/50 backdrop-blur-sm border border-outline-variant/10 px-4 py-2 rounded-lg">
      {/* Left section: View mode toggle, divider, hunk navigation */}
      <div className="flex items-center gap-3">
        {/* View mode pill toggle */}
        <div className="flex items-center gap-1 bg-surface-container/30 rounded-full p-1">
          <button
            type="button"
            onClick={() => onViewModeChange('split')}
            className={`px-3 py-1 rounded-full text-[0.7rem] font-bold uppercase tracking-wider transition-colors ${
              viewMode === 'split'
                ? 'bg-surface-container-highest text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Side-by-side
          </button>

          <button
            type="button"
            onClick={() => onViewModeChange('unified')}
            className={`px-3 py-1 rounded-full text-[0.7rem] font-bold uppercase tracking-wider transition-colors ${
              viewMode === 'unified'
                ? 'bg-surface-container-highest text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Unified
          </button>
        </div>

        {/* Vertical divider */}
        <div className="h-6 w-px bg-outline-variant/20" />

        {/* Hunk navigation arrows */}
        <button
          type="button"
          onClick={onPreviousHunk}
          className="p-1 text-on-surface-variant hover:text-on-surface transition-colors"
          aria-label="Previous hunk"
        >
          <span className="material-symbols-outlined text-base">
            arrow_upward
          </span>
        </button>

        <button
          type="button"
          onClick={onNextHunk}
          className="p-1 text-on-surface-variant hover:text-on-surface transition-colors"
          aria-label="Next hunk"
        >
          <span className="material-symbols-outlined text-base">
            arrow_downward
          </span>
        </button>

        {/* Hunk counter */}
        <span className="text-[0.7rem] font-label text-on-surface-variant uppercase tracking-wider">
          {hunkCounter}
        </span>
      </div>

      {/* Right section: Discard and Stage Hunk buttons */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="px-4 py-1.5 border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-outline text-[0.7rem] font-bold uppercase tracking-wider rounded transition-colors"
        >
          Discard
        </button>

        <button
          type="button"
          onClick={onStageHunk}
          className="px-4 py-1.5 bg-primary text-on-primary hover:bg-primary-container hover:text-on-primary-container text-[0.7rem] font-bold uppercase tracking-wider rounded transition-colors shadow-sm"
        >
          Stage Hunk
        </button>
      </div>
    </div>
  )
}

export default DiffToolbar
