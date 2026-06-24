import { type ReactElement } from 'react'
import { Menu } from '@/components/Menu'
import { isMacPlatform, type ShortcutInput } from '../../../lib/formatShortcut'

export interface TerminalContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number } | null
  onClose: () => void
  onCopy: () => void
  onPaste: () => void
  canCopy: boolean
}

// Chips reflect the active platform's handled terminal clipboard shortcuts:
//   macOS:        Cmd+C copy / Cmd+V paste           → renders ⌘C / ⌘V
//   Linux/Win:    Ctrl+Shift+C / Ctrl+Shift+V        → renders Ctrl+Shift+C / Ctrl+Shift+V
// Computed at module load — there's no live platform-flip use case.
const IS_MAC = isMacPlatform()

const COPY_SHORTCUT: ShortcutInput = IS_MAC
  ? ['Mod', 'C']
  : ['Ctrl', 'Shift', 'C']

const PASTE_SHORTCUT: ShortcutInput = IS_MAC
  ? ['Mod', 'V']
  : ['Ctrl', 'Shift', 'V']

export const TerminalContextMenu = ({
  isOpen,
  position,
  onClose,
  onCopy,
  onPaste,
  canCopy,
}: TerminalContextMenuProps): ReactElement | null => {
  if (position === null) {
    return null
  }

  return (
    <Menu.Context
      position={position}
      open={isOpen}
      onOpenChange={(open): void => {
        if (!open) {
          onClose()
        }
      }}
      aria-label="Terminal actions"
    >
      <Menu.Item disabled={!canCopy} shortcut={COPY_SHORTCUT} onSelect={onCopy}>
        Copy
      </Menu.Item>
      <Menu.Item shortcut={PASTE_SHORTCUT} onSelect={onPaste}>
        Paste
      </Menu.Item>
    </Menu.Context>
  )
}
