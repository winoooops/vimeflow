import { type ReactElement } from 'react'
import { Menu } from '@/components/Menu'
import {
  formatShortcut,
  isMacPlatform,
  type ShortcutInput,
} from '../../../lib/formatShortcut'

export interface TerminalContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number } | null
  onClose: () => void
  onCopy: () => void
  onPaste: () => void
  onPasteImage: () => void
  canCopy: boolean
  canPasteImage: boolean
  showPasteImage: boolean
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

const PASTE_IMAGE_SHORTCUT: ShortcutInput | null = IS_MAC ? null : ['Ctrl', 'V']

const TERMINAL_MENU_ROW_CLASSES =
  'flex min-h-7 w-40 items-center justify-between gap-6 px-2.5 py-1 ' +
  'text-left text-xs text-on-surface outline-none hover:bg-on-surface/10 ' +
  'focus:bg-on-surface/10'

const TERMINAL_MENU_DISABLED_ROW_CLASSES =
  'aria-disabled:cursor-default aria-disabled:text-on-surface-variant/45 ' +
  'aria-disabled:hover:bg-transparent aria-disabled:focus:bg-transparent'

const TERMINAL_MENU_SHORTCUT_CLASSES =
  'shrink-0 font-mono text-[10px] text-on-surface-variant'

export const TerminalContextMenu = ({
  isOpen,
  position,
  onClose,
  onCopy,
  onPaste,
  onPasteImage,
  canCopy,
  canPasteImage,
  showPasteImage,
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
      <Menu.Row
        label="Copy"
        disabled={!canCopy}
        className={`${TERMINAL_MENU_ROW_CLASSES} ${TERMINAL_MENU_DISABLED_ROW_CLASSES}`}
        onSelect={(): void => {
          onCopy()
          onClose()
        }}
      >
        <span>Copy</span>
        <kbd className={TERMINAL_MENU_SHORTCUT_CLASSES} aria-hidden="true">
          {formatShortcut(COPY_SHORTCUT)}
        </kbd>
      </Menu.Row>
      <Menu.Row
        label="Paste"
        className={TERMINAL_MENU_ROW_CLASSES}
        onSelect={(): void => {
          onPaste()
          onClose()
        }}
      >
        <span>Paste</span>
        <kbd className={TERMINAL_MENU_SHORTCUT_CLASSES} aria-hidden="true">
          {formatShortcut(PASTE_SHORTCUT)}
        </kbd>
      </Menu.Row>
      {showPasteImage ? (
        <Menu.Row
          label="Paste Image"
          disabled={!canPasteImage}
          className={`${TERMINAL_MENU_ROW_CLASSES} ${TERMINAL_MENU_DISABLED_ROW_CLASSES}`}
          onSelect={(): void => {
            onPasteImage()
            onClose()
          }}
        >
          <span>Paste Image</span>
          {PASTE_IMAGE_SHORTCUT === null ? null : (
            <kbd className={TERMINAL_MENU_SHORTCUT_CLASSES} aria-hidden="true">
              {formatShortcut(PASTE_IMAGE_SHORTCUT)}
            </kbd>
          )}
        </Menu.Row>
      ) : null}
    </Menu.Context>
  )
}
