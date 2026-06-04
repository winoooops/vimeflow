import type { ReactElement } from 'react'
import { Tooltip } from '../../../../components/Tooltip'

export interface HeaderActionsProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
  onClose?: () => void
  /** Toggle this session's ephemeral scratch terminal (VIM-53). */
  onScratch?: () => void
}

export const HeaderActions = ({
  isCollapsed,
  onToggleCollapse,
  onClose = undefined,
  onScratch = undefined,
}: HeaderActionsProps): ReactElement => (
  <>
    {onScratch && (
      <Tooltip content="Scratch terminal" placement="bottom">
        <button
          type="button"
          aria-label="open scratch terminal"
          onClick={(event) => {
            event.stopPropagation()
            onScratch()
          }}
          className="inline-flex h-[22px] w-[22px] items-center justify-center rounded border-0 bg-transparent text-[#f0c674]/70 hover:bg-white/5 hover:text-[#f0c674]"
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
