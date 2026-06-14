import type { ReactElement } from 'react'
import { Tooltip } from '@/components/Tooltip'

const burnerButtonLabel = (active: boolean, shellExists: boolean): string => {
  if (active) {
    return 'open burner terminal (running)'
  }

  if (shellExists) {
    return 'open burner terminal (live)'
  }

  return 'open burner terminal'
}

const burnerButtonTooltip = (active: boolean): string =>
  active ? 'Burner terminal · running' : 'Burner terminal'

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
      <Tooltip content={burnerButtonTooltip(burnerActive)} placement="bottom">
        {/* eslint-disable-next-line vimeflow/no-raw-icon-button */}
        <button
          type="button"
          aria-label={burnerButtonLabel(burnerActive, burnerShellExists)}
          onClick={(event) => {
            event.stopPropagation()
            onBurner()
          }}
          className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded border-0 hover:bg-wash-subtle ${
            burnerActive
              ? 'bg-agent-shell-accent/15 text-agent-shell-accent'
              : 'text-on-surface-muted bg-transparent'
          }`}
        >
          <span
            className="material-symbols-outlined text-[13px]"
            aria-hidden="true"
          >
            terminal
          </span>
        </button>
      </Tooltip>
    )}

    <Tooltip
      content={isCollapsed ? 'Expand status' : 'Collapse status'}
      placement="bottom"
    >
      {/* eslint-disable-next-line vimeflow/no-raw-icon-button */}
      <button
        type="button"
        aria-label={isCollapsed ? 'expand status' : 'collapse status'}
        onClick={(event) => {
          event.stopPropagation()
          onToggleCollapse()
        }}
        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded border-0 bg-transparent text-on-surface-muted hover:bg-wash-subtle"
      >
        <span
          className="material-symbols-outlined text-[13px]"
          aria-hidden="true"
        >
          {isCollapsed ? 'unfold_more' : 'unfold_less'}
        </span>
      </button>
    </Tooltip>

    {onClose && (
      <Tooltip content="Close pane" placement="bottom">
        {/* eslint-disable-next-line vimeflow/no-raw-icon-button */}
        <button
          type="button"
          aria-label="close pane"
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          className="inline-flex h-[22px] w-[22px] items-center justify-center rounded border-0 bg-transparent text-on-surface-muted hover:bg-wash-subtle"
        >
          <span
            className="material-symbols-outlined text-[13px]"
            aria-hidden="true"
          >
            close
          </span>
        </button>
      </Tooltip>
    )}
  </>
)
