import {
  useState,
  type CSSProperties,
  type ReactElement,
  type Ref,
} from 'react'
import { SidebarToggle } from './SidebarToggle'
import { Tooltip } from '../../../components/Tooltip'

interface TopBarUtilProps {
  icon: string
  label: string
  /** Optional shortcut surfaced as the tooltip's shortcut chip (e.g. 'Ctrl+;'). */
  shortcut?: string
  onClick?: () => void
  disabled?: boolean
}

// Compact icon-only utility button (28x28) for the right side of the sidebar
// top bar, matching the collapse toggle. Hover highlights the background only
// (no border-color change). The label — and, where relevant, the shortcut chip —
// surface through the project Tooltip, never a native title.
const TopBarUtil = ({
  icon,
  label,
  shortcut = undefined,
  onClick = undefined,
  disabled = false,
}: TopBarUtilProps): ReactElement => {
  const [hover, setHover] = useState(false)
  const lit = hover && !disabled

  const style: CSSProperties = {
    width: 28,
    height: 28,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: lit ? 'rgba(226,199,255,0.08)' : 'rgba(26,26,42,0.6)',
    border: '1px solid rgba(74,68,79,0.3)',
    color: disabled ? '#6c7086' : lit ? '#e2c7ff' : '#9b93ab',
    opacity: disabled ? 0.6 : 1,
    transition: 'all 140ms ease',
  }

  return (
    <Tooltip content={label} shortcut={shortcut} placement="bottom">
      <button
        type="button"
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (disabled) {
            return
          }
          onClick?.()
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        aria-label={label}
        className="vf-app-no-drag"
        style={style}
      >
        <span
          className="material-symbols-outlined"
          aria-hidden="true"
          style={{ fontSize: 15, lineHeight: 1 }}
        >
          {icon}
        </span>
      </button>
    </Tooltip>
  )
}

export interface SidebarTopBarProps {
  /** Toggle the sidebar collapse flag (shared with ⌘B and the palette command). */
  onToggleSidebar: () => void
  /** Open the command palette. */
  onCommand?: () => void
  /** Open Settings; when omitted the button renders as a disabled stub. */
  onSettings?: () => void
  /** Real command-palette chord (e.g. 'Ctrl+;' / '⌘;'); shown in the button's tooltip. */
  commandShortcutHint: string
  /** Platform-appropriate sidebar-toggle hint forwarded to the toggle tooltip. */
  sidebarShortcutHint?: string
  /** Settings follow-up issue number, surfaced in the (disabled) tooltip. */
  settingsIssueNumber?: number
  /** Ref forwarded to the collapse-toggle button for imperative focus. */
  toggleRef?: Ref<HTMLButtonElement>
  /** Whether the platform reserves space for macOS inset window controls. */
  reserveWindowControls?: boolean
}

// The new sidebar chrome row. Uses the sidebar's own surface
// (bg-surface-container-low) with no bottom divider, so the top bar blends into
// the sidebar. The height seats the open-state toggle at the same
// vertical position as the collapsed-state tab-bar toggle. Toggle pinned left;
// Command Palette + Settings pinned right — all three are icon-only 28x28 buttons.
export const SidebarTopBar = ({
  onToggleSidebar,
  onCommand = undefined,
  onSettings = undefined,
  commandShortcutHint,
  sidebarShortcutHint = '⌘B',
  settingsIssueNumber = undefined,
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
    <TopBarUtil
      icon="terminal"
      label="Command Palette"
      shortcut={commandShortcutHint}
      onClick={onCommand}
    />
    <TopBarUtil
      icon="settings"
      label={
        settingsIssueNumber
          ? `Settings — coming (see issue #${settingsIssueNumber})`
          : 'Settings'
      }
      onClick={onSettings}
      disabled={!onSettings}
    />
  </div>
)
