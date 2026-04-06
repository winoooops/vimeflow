import type { ReactElement } from 'react'

/**
 * LoadingState - Displays a centered loading indicator while file content is being fetched.
 * Shows pulsing text matching the dark atmospheric design system.
 */
export const LoadingState = (): ReactElement => (
  <div
    role="status"
    aria-live="polite"
    className="flex items-center justify-center h-full bg-surface"
    data-testid="loading-state"
  >
    <span className="text-on-surface-variant/40 text-sm animate-pulse">
      Loading...
    </span>
  </div>
)
