import type { ReactElement } from 'react'
import { Tooltip } from '../../../../components/Tooltip'

// Two honest button states: a foreground command is running, or it isn't. An
// idle-but-alive shell reads the same as no shell — nothing claims "active".
const burnerButtonLabel = (active: boolean): string =>
  active ? 'open burner terminal (running)' : 'open burner terminal'

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
}

export const HeaderActions = ({
  isCollapsed,
  onToggleCollapse,
  onClose = undefined,
  onBurner = undefined,
  burnerActive = false,
}: HeaderActionsProps): ReactElement => (
  <>
    {onBurner && (
      <Tooltip content={burnerButtonTooltip(burnerActive)} placement="bottom">
        <button
          type="button"
          aria-label={burnerButtonLabel(burnerActive)}
          onClick={(event) => {
            event.stopPropagation()
            onBurner()
          }}
          className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded border-0 hover:bg-white/5 ${
            burnerActive
              ? 'bg-[#f0c674]/15 text-[#f0c674]'
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
      <button
        type="button"
        aria-label={isCollapsed ? 'expand status' : 'collapse status'}
        onClick={(event) => {
          event.stopPropagation()
          onToggleCollapse()
        }}
        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded border-0 bg-transparent text-on-surface-muted hover:bg-white/5"
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
        <button
          type="button"
          aria-label="close pane"
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          className="inline-flex h-[22px] w-[22px] items-center justify-center rounded border-0 bg-transparent text-on-surface-muted hover:bg-white/5"
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
