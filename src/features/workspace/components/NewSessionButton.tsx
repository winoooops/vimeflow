import { type ReactElement } from 'react'
import { Tooltip } from '../../../components/Tooltip'

export interface NewSessionButtonProps {
  onClick: () => void
  /** Platform shortcut shown in the tooltip chip (e.g. '⌘N' / 'Ctrl+N'). */
  shortcutHint: string
  /** ARIA keyboard-shortcut token announced to assistive tech (e.g. 'Meta+N'). */
  ariaKeyshortcuts: string
}

// Primary "+" new-session control for the sidebar switcher row. Flat lavender
// to read as primary without a gradient; the shortcut surfaces through the
// project Tooltip chip (never a native title) plus aria-keyshortcuts.
export const NewSessionButton = ({
  onClick,
  shortcutHint,
  ariaKeyshortcuts,
}: NewSessionButtonProps): ReactElement => (
  <Tooltip content="New session" shortcut={shortcutHint} placement="bottom">
    <button
      type="button"
      onClick={onClick}
      aria-label="New session"
      aria-keyshortcuts={ariaKeyshortcuts}
      data-testid="sidebar-new-session"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary-container transition-colors hover:bg-primary/20 hover:text-on-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
    >
      <span
        className="material-symbols-outlined text-[18px]"
        aria-hidden="true"
      >
        add
      </span>
    </button>
  </Tooltip>
)
