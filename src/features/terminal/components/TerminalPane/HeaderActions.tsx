import type { ReactElement } from 'react'
import { Tooltip } from '../../../../components/Tooltip'

// Three honest scratch-button states for AT + tooltip: a foreground command is
// running, a shell exists but is idle (`live`), or there's no shell. The idle
// `live` wording keeps a hidden-but-alive shell discoverable to screen readers,
// since the amber tint alone is a visual-only cue.
const scratchButtonLabel = (running: boolean, active: boolean): string => {
  if (active) {
    return 'open scratch terminal (running)'
  }
  if (running) {
    return 'open scratch terminal (live)'
  }

  return 'open scratch terminal'
}

const scratchButtonTooltip = (running: boolean, active: boolean): string => {
  if (active) {
    return 'Scratch terminal · running'
  }
  if (running) {
    return 'Scratch terminal · live'
  }

  return 'Scratch terminal'
}

export interface HeaderActionsProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
  onClose?: () => void
  /** Toggle this pane's ephemeral scratch terminal (VIM-53). */
  onScratch?: () => void
  /** This pane has a live scratch shell — surfaced to AT via a "(live)" label. */
  scratchRunning?: boolean
  /**
   * A foreground command is actually running in the scratch shell (VIM-71) —
   * drives the amber button tint. Distinct from `scratchRunning`, which only
   * means a shell exists.
   */
  scratchActive?: boolean
}

export const HeaderActions = ({
  isCollapsed,
  onToggleCollapse,
  onClose = undefined,
  onScratch = undefined,
  scratchRunning = false,
  scratchActive = false,
}: HeaderActionsProps): ReactElement => (
  <>
    {onScratch && (
      <Tooltip
        content={scratchButtonTooltip(scratchRunning, scratchActive)}
        placement="bottom"
      >
        <button
          type="button"
          aria-label={scratchButtonLabel(scratchRunning, scratchActive)}
          onClick={(event) => {
            event.stopPropagation()
            onScratch()
          }}
          className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded border-0 hover:bg-white/5 ${
            scratchActive
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
