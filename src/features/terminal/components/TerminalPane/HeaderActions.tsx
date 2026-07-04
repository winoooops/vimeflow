import type { ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import { Tooltip } from '@/components/Tooltip'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'

const burnerButtonLabel = (
  active: boolean,
  open: boolean,
  shellExists: boolean
): string => {
  if (active) {
    return open
      ? 'hide burner terminal (running)'
      : 'open burner terminal (running)'
  }

  if (open) {
    return 'hide burner terminal'
  }

  if (shellExists) {
    return 'open burner terminal (live)'
  }

  return 'open burner terminal'
}

export interface HeaderActionsProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
  shortcutHint?: string
  /** Hide when the status bar cannot render for this pane state. */
  hideCollapseToggle?: boolean
  onClose?: () => void
  /** Toggle this pane's ephemeral burner terminal (VIM-53). */
  onBurner?: () => void
  /**
   * A foreground command is actually running in the burner shell (VIM-71) —
   * drives the amber button tint (the sole running cue).
   */
  burnerActive?: boolean
  /** This pane's burner secondary terminal is currently visible. */
  burnerOpen?: boolean
  /**
   * A burner shell exists for this pane but no foreground command is running.
   * Exposed to assistive tech so an idle-but-live shell is distinguishable
   * from "no shell" (VIM-53 a11y).
   */
  burnerShellExists?: boolean
}

export const HeaderActions = ({
  isCollapsed,
  onToggleCollapse,
  shortcutHint = undefined,
  hideCollapseToggle = false,
  onClose = undefined,
  onBurner = undefined,
  burnerActive = false,
  burnerOpen = false,
  burnerShellExists = false,
}: HeaderActionsProps): ReactElement => {
  const burnerLabel = burnerButtonLabel(
    burnerActive,
    burnerOpen,
    burnerShellExists
  )
  const collapseLabel = isCollapsed ? 'expand status' : 'collapse status'

  return (
    <>
      {shortcutHint && (
        <span
          data-testid="pane-shortcut-hint"
          className="shrink-0 rounded bg-on-surface/10 px-1.5 py-0.5 font-mono text-[10px] leading-none text-on-surface-variant"
        >
          {shortcutHint}
        </span>
      )}

      {onBurner && (
        <Tooltip content={burnerLabel} placement="bottom" nativeOverlay>
          <IconButton
            icon="terminal"
            label={burnerLabel}
            showTooltip={TOOLTIP_SUPPRESSED}
            size="sm"
            pressed={burnerOpen}
            onClick={(event) => {
              event.stopPropagation()
              onBurner()
            }}
            // Running is a status tint, not a toggle — no `pressed` (it would override the accent).
            className={
              burnerActive
                ? 'bg-agent-shell-accent/15 text-agent-shell-accent'
                : undefined
            }
          />
        </Tooltip>
      )}

      {!hideCollapseToggle && (
        <Tooltip content={collapseLabel} placement="bottom" nativeOverlay>
          <IconButton
            icon={isCollapsed ? 'unfold_more' : 'unfold_less'}
            label={collapseLabel}
            showTooltip={TOOLTIP_SUPPRESSED}
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              onToggleCollapse()
            }}
          />
        </Tooltip>
      )}

      {onClose && (
        <Tooltip content="close pane" placement="bottom" nativeOverlay>
          <IconButton
            icon="close"
            label="close pane"
            showTooltip={TOOLTIP_SUPPRESSED}
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
          />
        </Tooltip>
      )}
    </>
  )
}
