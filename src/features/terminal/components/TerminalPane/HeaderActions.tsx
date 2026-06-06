import type { ReactElement } from 'react'
import { Tooltip } from '../../../../components/Tooltip'

// Three honest burner-button states for AT + tooltip: a foreground command is
// running, a shell exists but is idle (`live`), or there's no shell. The idle
// `live` wording keeps a hidden-but-alive shell discoverable to screen readers,
// since the amber tint alone is a visual-only cue.
const burnerButtonLabel = (running: boolean, active: boolean): string => {
  if (active) {
    return 'open burner terminal (running)'
  }
  if (running) {
    return 'open burner terminal (live)'
  }

  return 'open burner terminal'
}

const burnerButtonTooltip = (running: boolean, active: boolean): string => {
  if (active) {
    return 'Burner terminal · running'
  }
  if (running) {
    return 'Burner terminal · live'
  }

  return 'Burner terminal'
}

export interface HeaderActionsProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
  onClose?: () => void
  /** Toggle this pane's ephemeral burner terminal (VIM-53). */
  onBurner?: () => void
  /** This pane has a live burner shell — surfaced to AT via a "(live)" label. */
  burnerRunning?: boolean
  /**
   * A foreground command is actually running in the burner shell (VIM-71) —
   * drives the amber button tint. Distinct from `burnerRunning`, which only
   * means a shell exists.
   */
  burnerActive?: boolean
}

export const HeaderActions = ({
  isCollapsed,
  onToggleCollapse,
  onClose = undefined,
  onBurner = undefined,
  burnerRunning = false,
  burnerActive = false,
}: HeaderActionsProps): ReactElement => (
  <>
    {onBurner && (
      <Tooltip
        content={burnerButtonTooltip(burnerRunning, burnerActive)}
        placement="bottom"
      >
        <button
          type="button"
          aria-label={burnerButtonLabel(burnerRunning, burnerActive)}
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
