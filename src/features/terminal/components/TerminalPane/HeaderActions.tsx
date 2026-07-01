import type { ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import { Tooltip } from '@/components/Tooltip'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'

const burnerButtonLabel = (active: boolean, shellExists: boolean): string => {
  if (active) {
    return 'open burner terminal (running)'
  }

  if (shellExists) {
    return 'open burner terminal (live)'
  }

  return 'open burner terminal'
}

export interface HeaderActionsProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
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
  hideCollapseToggle = false,
  onClose = undefined,
  onBurner = undefined,
  burnerActive = false,
  burnerShellExists = false,
}: HeaderActionsProps): ReactElement => {
  const burnerLabel = burnerButtonLabel(burnerActive, burnerShellExists)
  const collapseLabel = isCollapsed ? 'expand status' : 'collapse status'

  return (
    <>
      {onBurner && (
        <Tooltip content={burnerLabel} placement="bottom" nativeOverlay>
          <IconButton
            icon="terminal"
            label={burnerLabel}
            showTooltip={TOOLTIP_SUPPRESSED}
            size="sm"
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
