import type { ReactElement } from 'react'

export interface InfoBannerProps {
  message: string | null
  onDismiss: () => void
}

export const InfoBanner = ({
  message,
  onDismiss,
}: InfoBannerProps): ReactElement | null => {
  if (message === null) {
    return null
  }

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-4 bg-primary/20 border border-primary/40 text-primary px-4 py-3 rounded-lg"
    >
      <p className="flex-1 text-sm">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="text-primary hover:text-primary/80 transition-colors text-sm font-medium"
        aria-label="Dismiss"
      >
        Dismiss
      </button>
    </div>
  )
}
