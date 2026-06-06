import { useState, type CSSProperties, type ReactElement } from 'react'
import { SidebarToggle } from './SidebarToggle'
import { Tooltip } from '../../../components/Tooltip'

interface TopBarUtilProps {
  icon: string
  label: string
  kbd?: string
  onClick?: () => void
  disabled?: boolean
}

// Compact utility button for the right side of the sidebar top bar. Command
// Palette shows its shortcut inline; Settings is icon-only (28x28). Both share
// the recessed well style of the SidebarToggle so the row reads as one cluster.
// `disabled` renders aria-disabled and suppresses the click (the Settings stub).
// The hover label surfaces through the project Tooltip (not a native title).
const TopBarUtil = ({
  icon,
  label,
  kbd = undefined,
  onClick = undefined,
  disabled = false,
}: TopBarUtilProps): ReactElement => {
  const [hover, setHover] = useState(false)
  const lit = hover && !disabled

  const style: CSSProperties = {
    height: 28,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: kbd ? '0 8px 0 7px' : 0,
    width: kbd ? 'auto' : 28,
    justifyContent: 'center',
    borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: lit ? 'rgba(226,199,255,0.08)' : 'rgba(26,26,42,0.6)',
    border: lit
      ? '1px solid rgba(203,166,247,0.4)'
      : '1px solid rgba(74,68,79,0.3)',
    color: disabled ? '#6c7086' : lit ? '#e2c7ff' : '#9b93ab',
    opacity: disabled ? 0.6 : 1,
    transition: 'all 140ms ease',
  }

  return (
    <Tooltip content={label} placement="bottom">
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
        style={style}
      >
        <span
          className="material-symbols-outlined"
          aria-hidden="true"
          style={{ fontSize: 15, lineHeight: 1, flexShrink: 0 }}
        >
          {icon}
        </span>
        {kbd && (
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9.5,
              fontWeight: 600,
              color: lit ? '#cba6f7' : '#6c7086',
              letterSpacing: '0.02em',
            }}
          >
            {kbd}
          </span>
        )}
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
  /** Real command-palette chord (e.g. 'Ctrl+;' / '⌘;'); required so no placeholder is shown. */
  commandShortcutHint: string
  /** Platform-appropriate sidebar-toggle hint forwarded to the toggle tooltip. */
  sidebarShortcutHint?: string
  /** Settings follow-up issue number, surfaced in the (disabled) tooltip. */
  settingsIssueNumber?: number
}

// The new sidebar chrome row (38px). Fill + bottom hairline reuse the same
// design tokens as the session-tab bar (bg-surface-container-lowest +
// border-outline-variant/25) so the two bars form one continuous band and the
// open-state toggle lands at the same vertical position as the collapsed-state
// tab-bar toggle. Toggle pinned left; Command Palette + Settings pinned right.
export const SidebarTopBar = ({
  onToggleSidebar,
  onCommand = undefined,
  onSettings = undefined,
  commandShortcutHint,
  sidebarShortcutHint = '⌘B',
  settingsIssueNumber = undefined,
}: SidebarTopBarProps): ReactElement => (
  <div
    data-testid="sidebar-top-bar"
    className="border-b border-outline-variant/25 bg-surface-container-lowest"
    style={{
      height: 38,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      paddingLeft: 12,
      paddingRight: 10,
    }}
  >
    <SidebarToggle
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
      kbd={commandShortcutHint}
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
