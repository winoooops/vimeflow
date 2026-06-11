import { type ReactElement } from 'react'

export interface SidebarTopBarProps {
  /** Whether the platform reserves space for macOS inset window controls. */
  reserveWindowControls?: boolean
}

const SIDEBAR_TOGGLE_LEFT =
  'var(--workspace-sidebar-toggle-left, max(12px, var(--workspace-window-controls-inset, 0px)))'
const SIDEBAR_TOGGLE_SIZE = 'var(--workspace-sidebar-toggle-size, 28px)'
const SIDEBAR_TOGGLE_TOP = 'var(--workspace-sidebar-toggle-top, 7px)'

// The new sidebar chrome row. Uses the sidebar's own surface
// (bg-surface-container-low) with no bottom divider, so the top bar blends into
// the sidebar. The persistent sidebar toggle is owned by WorkspaceView so it
// never changes position while this row slides beneath it. Native drag surrounds
// the toggle slot but does not sit under the clickable toggle rectangle.
export const SidebarTopBar = ({
  reserveWindowControls = false,
}: SidebarTopBarProps): ReactElement => {
  const dragClassName = reserveWindowControls ? 'vf-app-drag-region' : ''

  return (
    <div
      data-testid="sidebar-top-bar"
      className="bg-surface-container-low"
      style={{
        height: 42,
        flexShrink: 0,
        display: 'grid',
        gridTemplateColumns: `${SIDEBAR_TOGGLE_LEFT} ${SIDEBAR_TOGGLE_SIZE} minmax(0, 1fr)`,
        gridTemplateRows: `${SIDEBAR_TOGGLE_TOP} ${SIDEBAR_TOGGLE_SIZE} minmax(0, 1fr)`,
      }}
    >
      <div
        aria-hidden="true"
        data-testid="sidebar-top-bar-upper-drag-region"
        className={dragClassName}
        style={{ gridColumn: '1 / -1', gridRow: 1 }}
      />
      <div
        aria-hidden="true"
        data-testid="sidebar-top-bar-left-drag-region"
        className={dragClassName}
        style={{ gridColumn: 1, gridRow: 2 }}
      />
      <div
        aria-hidden="true"
        data-testid="sidebar-top-bar-toggle-clearance"
        className="vf-app-no-drag"
        style={{ gridColumn: 2, gridRow: 2 }}
      />
      <div
        aria-hidden="true"
        data-testid="sidebar-top-bar-right-drag-region"
        className={dragClassName}
        style={{ gridColumn: 3, gridRow: 2, paddingRight: 10 }}
      />
      <div
        aria-hidden="true"
        data-testid="sidebar-top-bar-lower-drag-region"
        className={dragClassName}
        style={{ gridColumn: '1 / -1', gridRow: 3 }}
      />
    </div>
  )
}
