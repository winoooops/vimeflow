import type { ReactElement } from 'react'
import { Tooltip } from '../../../components/Tooltip'
import { formatShortcut } from '../../../lib/formatShortcut'
import { COMMAND_PALETTE_SHORTCUT_KEYS } from '../../command-palette/shortcutConfig'
import type { NavigationItem } from '../types'
import { SidebarToggle } from './SidebarToggle'

// The collapsed-state sidebar toggle's top must line up with the in-card
// toggle's top so the glyph reads as one control as the drawer opens/closes:
// sidebar header pt-3 (12px) + AgentStatusCard padding-top (13px) = 25px from
// the column top; the rail's own py-2.5 contributes 10px, so the toggle needs
// the remaining offset.
const RAIL_TOGGLE_TOP_OFFSET_PX = 25 - 10

export interface IconRailIdentity {
  initial: string
  ariaLabel?: string
}

export interface IconRailProps {
  settingsIssueNumber: number
  onCommand?: () => void
  onSettings?: () => void
  identity?: IconRailIdentity
  /** Whether the left sidebar is collapsed; when true the rail hosts the expand toggle. */
  sidebarCollapsed?: boolean
  /** Toggle the sidebar collapse flag (shared with the in-card toggle, ⌘B, and the palette). */
  onToggleSidebar?: () => void
  /** Platform-appropriate shortcut hint forwarded to the sidebar toggle tooltip. */
  sidebarShortcutHint?: string
  /**
   * @deprecated Ignored by the new rail body — the rail no longer
   * iterates this array. Kept for one cycle so existing callers
   * compile; will be removed once the Settings dialog (see issue
   * referenced by `settingsIssueNumber`) lands. See
   * `docs/superpowers/specs/2026-05-20-icon-rail-trim-design.md`
   * §7.1 for the deprecation cycle.
   */
  items?: NavigationItem[]
  /**
   * @deprecated Ignored by the new rail body — the settings button is
   * rendered with hardcoded icon, label, and tooltip text inside
   * `IconRail`. Kept for one cycle so existing callers compile; will
   * be removed alongside `items` once the Settings dialog lands.
   */
  settingsItem?: NavigationItem
}

interface RailBtnProps {
  icon: RailIconName
  accessibleName: string
  tooltipContent: string
  onClick?: () => void
  ariaDisabled?: boolean
}

type RailIconName = 'search' | 'settings'

const RailIcon = ({ icon }: { icon: RailIconName }): ReactElement => (
  <span
    aria-hidden="true"
    data-testid={`icon-rail-${icon}-icon`}
    className="material-symbols-outlined text-[18px]"
  >
    {icon}
  </span>
)

const RailBtn = ({
  icon,
  accessibleName,
  tooltipContent,
  onClick = undefined,
  ariaDisabled = false,
}: RailBtnProps): ReactElement => (
  <Tooltip content={tooltipContent} placement="right">
    <button
      type="button"
      aria-label={accessibleName}
      aria-disabled={ariaDisabled || undefined}
      onClick={(): void => {
        if (ariaDisabled) {
          return
        }
        onClick?.()
      }}
      className={`
        flex h-[34px] w-[34px] items-center justify-center rounded-lg
        border border-transparent transition-colors duration-150 ease-out
        ${
          ariaDisabled
            ? 'cursor-not-allowed text-on-surface-muted/60'
            : 'cursor-pointer text-on-surface-muted hover:bg-primary/[0.06] hover:text-primary'
        }
      `}
    >
      <RailIcon icon={icon} />
    </button>
  </Tooltip>
)

export const IconRail = ({
  settingsIssueNumber,
  onCommand = undefined,
  onSettings = undefined,
  sidebarCollapsed = false,
  onToggleSidebar = undefined,
  sidebarShortcutHint,
}: IconRailProps): ReactElement => {
  const settingsTooltip = `Settings panel coming — see issue #${settingsIssueNumber}`

  const commandPaletteTooltip = `Command Palette (${formatShortcut(
    COMMAND_PALETTE_SHORTCUT_KEYS
  )})`

  return (
    <nav
      data-testid="icon-rail"
      className="
        relative z-[5] flex h-full w-12 flex-col items-center
        bg-surface-container-lowest
        py-2.5
      "
    >
      {/* The placeholder "W" avatar was removed; the rail's top slot hosts the
          sidebar expand toggle, shown only while the sidebar is collapsed.
          Aligned to the in-card toggle's vertical position (see constant). */}
      {sidebarCollapsed && onToggleSidebar && (
        <div style={{ marginTop: RAIL_TOGGLE_TOP_OFFSET_PX }}>
          <SidebarToggle
            collapsed
            onClick={onToggleSidebar}
            size={28}
            variant="inset"
            data-testid="sidebar-toggle-rail"
            shortcutHint={sidebarShortcutHint}
          />
        </div>
      )}

      <div className="flex-1" aria-hidden="true" />

      <div className="flex flex-col gap-1">
        <RailBtn
          icon="search"
          accessibleName="Command Palette"
          tooltipContent={commandPaletteTooltip}
          onClick={onCommand}
        />
        <RailBtn
          icon="settings"
          accessibleName="Settings"
          tooltipContent={settingsTooltip}
          ariaDisabled
          onClick={onSettings}
        />
      </div>
    </nav>
  )
}
