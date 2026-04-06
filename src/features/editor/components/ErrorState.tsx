import type { ReactElement } from 'react'

interface ErrorStateProps {
  message: string
}

/**
 * ErrorState - Displays a centered error state when file loading fails.
 * Shows error icon and message matching the dark atmospheric design system.
 */
export const ErrorState = ({ message }: ErrorStateProps): ReactElement => (
  <div
    role="alert"
    className="flex flex-col items-center justify-center h-full bg-surface"
    data-testid="error-state"
  >
    {/* Error Icon */}
    <span
      className="material-symbols-outlined text-error/40 text-6xl mb-4"
      aria-hidden="true"
    >
      error_outline
    </span>

    {/* Error Message */}
    <p className="text-on-surface-variant/40 text-sm">Error: {message}</p>
  </div>
)
