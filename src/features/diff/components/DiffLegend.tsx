import type { ReactElement } from 'react'

/**
 * DiffLegend component
 *
 * Displays a floating glassmorphism legend at the bottom center of the diff viewer.
 * Shows visual indicators for added/removed lines and interaction hints.
 */
const DiffLegend = (): ReactElement => (
  <div
    data-testid="diff-legend"
    className="fixed bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-surface-container-high/60 backdrop-blur-xl border border-outline-variant/20 shadow-2xl rounded-full px-6 py-3"
  >
    {/* Added indicator */}
    <div className="flex items-center gap-2">
      <div
        data-testid="added-dot"
        className="h-2 w-2 rounded-full bg-[#a6e3a1]"
      />
      <span className="text-[0.7rem] font-bold uppercase tracking-wider text-on-surface">
        ADDED
      </span>
    </div>

    {/* Removed indicator */}
    <div className="flex items-center gap-2">
      <div
        data-testid="removed-dot"
        className="h-2 w-2 rounded-full bg-[#f38ba8]"
      />
      <span className="text-[0.7rem] font-bold uppercase tracking-wider text-on-surface">
        REMOVED
      </span>
    </div>

    {/* Divider */}
    <div
      data-testid="legend-divider"
      className="h-4 w-px bg-outline-variant/30"
    />

    {/* Keyboard hint */}
    <div className="flex items-center gap-2">
      <span className="material-symbols-outlined text-[1rem] text-on-surface-variant">
        keyboard
      </span>
      <span className="text-[0.7rem] font-bold uppercase tracking-wider text-on-surface-variant">
        Space to stage hunk
      </span>
    </div>
  </div>
)

export default DiffLegend
