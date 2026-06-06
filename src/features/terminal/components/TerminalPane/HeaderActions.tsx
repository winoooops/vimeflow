import type { ReactElement } from 'react'
import { Tooltip } from '../../../../components/Tooltip'

export interface HeaderActionsProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
  onClose?: () => void
  /** Toggle this pane's ephemeral scratch terminal (VIM-53). */
  onScratch?: () => void
  /** This pane has a live scratch shell — amber button tint (§8). */
  scratchRunning?: boolean
  /**
   * A foreground command is actually running in the scratch shell (VIM-71) —
   * shows the honest mint live-dot. Distinct from `scratchRunning`, which only
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
        content={
          scratchActive ? 'Scratch terminal · running' : 'Scratch terminal'
        }
        placement="bottom"
      >
        <button
          type="button"
          aria-label={
            scratchActive
              ? 'open scratch terminal (running)'
              : 'open scratch terminal'
          }
          onClick={(event) => {
            event.stopPropagation()
            onScratch()
          }}
          className={`relative inline-flex h-[22px] w-[22px] items-center justify-center rounded border-0 hover:bg-white/5 ${
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
          {scratchActive && (
            <span
              data-testid="scratch-live-dot"
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full"
              style={{
                background: '#50fa7b',
                boxShadow: '0 0 4px rgba(80, 250, 123, 0.7)',
              }}
            />
          )}
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
