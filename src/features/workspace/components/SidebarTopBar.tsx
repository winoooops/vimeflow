import { type ReactElement, type Ref } from 'react'
import { SidebarToggle } from './SidebarToggle'

export interface SidebarTopBarProps {
  /** Toggle the sidebar collapse flag (shared with ⌘B and the palette command). */
  onToggleSidebar: () => void
  /** Platform-appropriate sidebar-toggle hint forwarded to the toggle tooltip. */
  sidebarShortcutHint?: string
  /** Ref forwarded to the collapse-toggle button for imperative focus. */
  toggleRef?: Ref<HTMLButtonElement>
  /** Whether the platform reserves space for macOS inset window controls. */
  reserveWindowControls?: boolean
}

// The new sidebar chrome row. Uses the sidebar's own surface
// (bg-surface-container-low) with no bottom divider, so the top bar blends into
// the sidebar. The height seats the open-state toggle at the same
// vertical position as the collapsed-state tab-bar toggle. The remaining
// empty chrome is intentionally left open for the macOS drag region.
export const SidebarTopBar = ({
  onToggleSidebar,
  sidebarShortcutHint = '⌘B',
  toggleRef = undefined,
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
    <SidebarToggle
      ref={toggleRef}
      onClick={onToggleSidebar}
      size={28}
      variant="inset"
      data-testid="sidebar-toggle-topbar"
      shortcutHint={sidebarShortcutHint}
    />
    <div style={{ flex: 1 }} />
  </div>
)
