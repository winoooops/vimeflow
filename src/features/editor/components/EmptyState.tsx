import type { ReactElement } from 'react'

/**
 * EmptyState - Displays a centered empty state when no file is selected.
 * Shows icon, heading, and hint text matching the dark atmospheric design system.
 */
export const EmptyState = (): ReactElement => (
  <div
    role="status"
    className="flex flex-col items-center justify-center h-full bg-surface"
    data-testid="empty-state"
  >
    {/* Icon */}
    <span
      className="material-symbols-outlined text-on-surface-variant/20 text-6xl mb-4"
      aria-hidden="true"
    >
      code_off
    </span>

    {/* Heading */}
    <h3 className="text-on-surface-variant/40 text-sm font-medium mb-2">
      No file open
    </h3>

    {/* Hint */}
    <p className="text-on-surface-variant/20 text-xs">
      Select a file from the explorer to start editing
    </p>
  </div>
)
