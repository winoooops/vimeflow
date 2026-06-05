import type { ReactElement } from 'react'
import { Tooltip } from '../../../../components/Tooltip'

export interface HeaderActionsProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
  onClose?: () => void
  /** Toggle this pane's ephemeral scratch terminal (VIM-53). */
  onScratch?: () => void
  /** This pane has a running scratch shell — show the live-but-hidden cue (§8). */
  scratchRunning?: boolean
}

export const HeaderActions = ({
  isCollapsed,
  onToggleCollapse,
  onClose = undefined,
  onScratch = undefined,
  scratchRunning = false,
}: HeaderActionsProps): ReactElement => (
  <>
    {onScratch && (
      <Tooltip
        content={
          scratchRunning ? 'Scratch terminal · running' : 'Scratch terminal'
        }
        placement="bottom"
      >
        <button
          type="button"
          aria-label={
            scratchRunning
              ? 'open scratch terminal (running)'
              : 'open scratch terminal'
          }
          onClick={(event) => {
            event.stopPropagation()
            onScratch()
          }}
          className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded border-0 hover:bg-white/5 ${
            scratchRunning
              ? 'bg-[#f0c674]/15 text-[#f0c674]'
              : 'bg-transparent text-[#f0c674]/70 hover:text-[#f0c674]'
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
