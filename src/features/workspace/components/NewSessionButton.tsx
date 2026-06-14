import { type ReactElement } from 'react'
import { Button } from '@/components/Button'
import { Tooltip } from '@/components/Tooltip'

export interface NewSessionButtonProps {
  onClick: () => void
  /** Platform shortcut shown in the tooltip chip (e.g. '⌘N' / 'Ctrl+⇧N'). */
  shortcutHint: string
  /** ARIA keyboard-shortcut token announced to assistive tech (e.g. 'Meta+N'). */
  ariaKeyshortcuts: string
}

// Primary "+" new-session control for the sidebar switcher row. The gradient,
// border, shadow, and active-press chrome come from the Button `primary`
// variant; only the container-query reveal layout (the width clamp + the
// inner content/label spans whose @container rule animates the label in/out)
// stays here via className + children.
export const NewSessionButton = ({
  onClick,
  shortcutHint,
  ariaKeyshortcuts,
}: NewSessionButtonProps): ReactElement => (
  <Tooltip content="New session" shortcut={shortcutHint} placement="bottom">
    <Button
      variant="primary"
      onClick={onClick}
      aria-label="New session"
      aria-keyshortcuts={ariaKeyshortcuts}
      data-testid="sidebar-new-session"
      className="vf-new-session-button group min-w-[38px] max-w-[150px] flex-1 shrink self-stretch overflow-hidden px-0"
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
    </Button>
  </Tooltip>
)
