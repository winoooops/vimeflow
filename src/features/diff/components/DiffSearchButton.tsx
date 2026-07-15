import type { ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import {
  chordToAriaShortcut,
  chordToShortcutInput,
} from '@/features/keymap/displayKey'
import type { Keybindings } from '@/features/keymap/useKeybindings'

interface DiffSearchButtonProps {
  bindingFor: Keybindings['bindingFor']
  fileHeaderVisible: boolean
  onOpen: () => void
}

/**
 * Floating search entry point - anchored by Panel 4px under the toolbar,
 * or below Pierre's file header when visible. Hover tints the icon only.
 */
export const DiffSearchButton = ({
  bindingFor,
  fileHeaderVisible,
  onOpen,
}: DiffSearchButtonProps): ReactElement => {
  const topOffsetClass = fileHeaderVisible ? 'top-10' : 'top-1'
  const shortcut = bindingFor('diff-search-open')

  return (
    <IconButton
      icon="search"
      label="Search in diff"
      shortcut={chordToShortcutInput(shortcut)}
      aria-keyshortcuts={chordToAriaShortcut(shortcut)}
      size="md"
      className={`absolute right-[22px] ${topOffsetClass} z-30 h-[34px] w-[34px] rounded-xl border border-outline-variant/25 bg-surface-container-high/30 text-on-surface-muted shadow-md backdrop-blur-[14px] backdrop-saturate-150 hover:bg-surface-container-high/30 hover:text-primary`}
      onClick={onOpen}
    />
  )
}
