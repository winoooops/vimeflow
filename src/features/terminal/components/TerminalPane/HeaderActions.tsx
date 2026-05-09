import type { ReactElement } from 'react'

export interface HeaderActionsProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
  onClose?: () => void
}

export const HeaderActions = ({
  isCollapsed,
  onToggleCollapse,
  onClose = undefined,
}: HeaderActionsProps): ReactElement => (
  <>
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

    {onClose && (
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
    )}
  </>
)
