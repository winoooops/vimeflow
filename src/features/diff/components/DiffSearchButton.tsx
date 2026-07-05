import type { ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'

interface DiffSearchButtonProps {
  fileHeaderVisible: boolean
  onOpen: () => void
}

/**
 * Floating search entry point - anchored by Panel 4px under the toolbar,
 * or below Pierre's file header when visible. Hover tints the icon only.
 */
export const DiffSearchButton = ({
  fileHeaderVisible,
  onOpen,
}: DiffSearchButtonProps): ReactElement => {
  const topOffsetClass = fileHeaderVisible ? 'top-10' : 'top-1'

  return (
    <IconButton
      icon="search"
      label="Search in diff"
      shortcut="/"
      size="md"
      className={`absolute right-[22px] ${topOffsetClass} z-30 h-[34px] w-[34px] rounded-xl border border-outline-variant/25 bg-surface-container-high/30 text-on-surface-muted shadow-md backdrop-blur-[14px] backdrop-saturate-150 hover:bg-surface-container-high/30 hover:text-primary`}
      onClick={onOpen}
    />
  )
}
