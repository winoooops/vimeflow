import type { ReactElement } from 'react'
import { Chip } from '@/components/Chip'

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
    <Chip
      tone="custom"
      radius="pill"
      size="custom"
      className="gap-2 bg-transparent p-0 text-on-surface"
    >
      <span
        data-testid="added-dot"
        className="h-2 w-2 rounded-full bg-vcs-added"
      />
      <span className="text-[0.7rem] font-bold uppercase tracking-wider text-on-surface">
        ADDED
      </span>
    </Chip>

    {/* Removed indicator */}
    <Chip
      tone="custom"
      radius="pill"
      size="custom"
      className="gap-2 bg-transparent p-0 text-on-surface"
    >
      <span
        data-testid="removed-dot"
        className="h-2 w-2 rounded-full bg-vcs-deleted"
      />
      <span className="text-[0.7rem] font-bold uppercase tracking-wider text-on-surface">
        REMOVED
      </span>
    </Chip>

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
