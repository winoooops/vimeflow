import { type ReactElement } from 'react'
import { Tooltip } from '../../../components/Tooltip'

export interface NewSessionButtonProps {
  onClick: () => void
  /** Platform shortcut shown in the tooltip chip (e.g. '⌘N' / 'Ctrl+⇧N'). */
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
      className="grid w-[38px] shrink-0 place-items-center self-stretch rounded-[10px] border border-[rgba(203,166,247,0.32)] bg-[rgba(203,166,247,0.1)] text-[#e2c7ff] transition-colors hover:bg-[rgba(203,166,247,0.2)] hover:text-[#f3eaff] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
    >
      <span
        className="material-symbols-outlined text-[19px]"
        aria-hidden="true"
      >
        add
      </span>
    </button>
  </Tooltip>
)
