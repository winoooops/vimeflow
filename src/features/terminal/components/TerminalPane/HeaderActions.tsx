import type { ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'

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
  onClose = undefined,
  onBurner = undefined,
  burnerActive = false,
  burnerShellExists = false,
}: HeaderActionsProps): ReactElement => (
  <>
    {onBurner && (
      <IconButton
        icon="terminal"
        label={burnerButtonLabel(burnerActive, burnerShellExists)}
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
    )}

    <IconButton
      icon={isCollapsed ? 'unfold_more' : 'unfold_less'}
      label={isCollapsed ? 'expand status' : 'collapse status'}
      size="sm"
      onClick={(event) => {
        event.stopPropagation()
        onToggleCollapse()
      }}
    />

    {onClose && (
      <IconButton
        icon="close"
        label="close pane"
        size="sm"
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
      />
    )}
  </>
)
