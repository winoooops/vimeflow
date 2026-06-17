import type { ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'

export interface InfoBannerProps {
  message: string
  onDismiss: () => void
}

export const InfoBanner = ({
  message,
  onDismiss,
}: InfoBannerProps): ReactElement => (
  <div
    role="status"
    className="flex items-center justify-between gap-4 bg-surface-container-high/80 text-primary px-4 py-3 rounded-lg shadow-[0_10px_40px_color-mix(in_srgb,var(--color-scrim)_28%,transparent)] backdrop-blur-xl"
  >
    <p className="flex-1 text-sm">{message}</p>
    <IconButton icon="close" label="Dismiss" size="sm" onClick={onDismiss} />
  </div>
)
