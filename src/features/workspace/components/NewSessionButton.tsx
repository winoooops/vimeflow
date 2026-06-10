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
      className="vf-new-session-button group grid min-w-[38px] max-w-[150px] flex-1 shrink place-items-center self-stretch overflow-hidden rounded-[10px] border border-[rgba(243,234,255,0.26)] bg-[linear-gradient(180deg,rgba(214,174,255,0.98)_0%,rgba(166,110,224,0.98)_100%)] text-[#20122c] shadow-[0_8px_18px_rgba(166,110,224,0.2),inset_0_1px_0_rgba(255,255,255,0.36)] transition-[filter,transform,box-shadow] hover:brightness-110 active:translate-y-px focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
    >
      <span className="vf-new-session-button-content flex min-w-0 items-center justify-center">
        <span
          className="material-symbols-outlined text-[19px]"
          aria-hidden="true"
        >
          add
        </span>
        <span className="vf-new-session-label overflow-hidden whitespace-nowrap font-body text-[13px] font-semibold">
          New session
        </span>
      </span>
    </button>
  </Tooltip>
)
