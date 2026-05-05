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
      className="flex items-center justify-between gap-4 bg-surface-container-high/80 text-primary px-4 py-3 rounded-lg shadow-[0_10px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl"
    >
      <p className="flex-1 text-sm">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex size-6 items-center justify-center rounded-md text-primary-dim transition-colors hover:bg-surface-bright hover:text-primary"
      >
        <span className="material-symbols-outlined text-base" aria-hidden>
          close
        </span>
      </button>
    </div>
  )
}
