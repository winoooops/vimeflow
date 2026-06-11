import { type ReactElement } from 'react'

export interface SidebarTopBarProps {
  /** Whether the platform reserves space for macOS inset window controls. */
  reserveWindowControls?: boolean
}

// The new sidebar chrome row. Uses the sidebar's own surface
// (bg-surface-container-low) with no bottom divider, so the top bar blends into
// the sidebar. The persistent sidebar toggle is owned by WorkspaceView so it
// never changes position while this row slides beneath it. This row intentionally
// stays empty for macOS traffic-light and drag space.
export const SidebarTopBar = ({
  reserveWindowControls = false,
}: SidebarTopBarProps): ReactElement => (
  <div
    data-testid="sidebar-top-bar"
    className={`bg-surface-container-low${
      reserveWindowControls ? ' vf-app-drag-region' : ''
    }`}
    style={{
      height: 42,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      paddingLeft: 'max(12px, var(--workspace-window-controls-inset, 0px))',
      paddingRight: 10,
    }}
  >
    <div style={{ flex: 1 }} />
  </div>
)
