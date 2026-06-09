import type { ReactElement } from 'react'
import { Tooltip } from '../../../components/Tooltip'
import { formatShortcut } from '../../../lib/formatShortcut'
import { COMMAND_PALETTE_SHORTCUT_KEYS } from '../../command-palette/shortcutConfig'
import type { NavigationItem } from '../types'

export interface IconRailIdentity {
  initial: string
  ariaLabel?: string
}

export interface IconRailProps {
  settingsIssueNumber: number
  onCommand?: () => void
  onSettings?: () => void
  identity?: IconRailIdentity
  /** Reserve the macOS hidden-titlebar traffic-light area. */
  reserveWindowControls?: boolean
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

// Vertical padding that clears the macOS traffic-light buttons.
// Matches trafficLightPosition.y (13) + button diameter (~28) + gap (~11)
// from electron/main.ts.
const MACOS_TRAFFIC_LIGHT_RESERVE_PX = 52

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
        vf-app-no-drag
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
  identity = undefined,
  reserveWindowControls = false,
}: IconRailProps): ReactElement => {
  const initial = Array.from(identity?.initial ?? 'w')[0] ?? 'w'
  const candidateAccountLabel = identity?.ariaLabel ?? 'Account'

  const accountLabel =
    candidateAccountLabel === '' ? 'Account' : candidateAccountLabel

  const settingsTooltip = `Settings panel coming — see issue #${settingsIssueNumber}`

  const commandPaletteTooltip = `Command Palette (${formatShortcut(
    COMMAND_PALETTE_SHORTCUT_KEYS
  )})`

  return (
    <nav
      data-testid="icon-rail"
      className={`
        ${reserveWindowControls ? 'vf-app-drag-region' : ''} relative z-[5] flex h-full ${reserveWindowControls ? 'w-[68px]' : 'w-12'} flex-col items-center
        bg-surface-container-lowest border-r border-outline-variant/25
      `}
      style={{
        paddingTop: reserveWindowControls ? MACOS_TRAFFIC_LIGHT_RESERVE_PX : 10,
        paddingBottom: 10,
      }}
    >
      <Tooltip content={accountLabel} placement="right">
        <div
          role="img"
          aria-label={accountLabel}
          className="
            vf-app-no-drag
            mb-3.5 h-[30px] w-[30px] grid place-items-center
            rounded-full border border-primary/35
            bg-[linear-gradient(135deg,theme(colors.primary-deep),theme(colors.surface-container-low))]
            font-display text-[12px] font-semibold text-primary
            shadow-[0_4px_18px_rgba(203,166,247,0.25)]
          "
        >
          {initial}
        </div>
      </Tooltip>

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
