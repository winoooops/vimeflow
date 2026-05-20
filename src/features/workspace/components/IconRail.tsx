import type { ReactElement } from 'react'
import { Tooltip } from '../../../components/Tooltip'
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
  items?: NavigationItem[]
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
  identity = undefined,
}: IconRailProps): ReactElement => {
  const initial = Array.from(identity?.initial ?? 'w')[0] ?? 'w'
  const candidateAccountLabel = identity?.ariaLabel ?? 'Account'

  const accountLabel =
    candidateAccountLabel === '' ? 'Account' : candidateAccountLabel

  const settingsTooltip = `Settings panel coming — see issue #${settingsIssueNumber}`

  return (
    <nav
      data-testid="icon-rail"
      className="
        relative z-[5] flex h-full w-12 flex-col items-center
        bg-surface-container-lowest border-r border-outline-variant/25
        py-2.5
      "
    >
      <Tooltip content={accountLabel} placement="right">
        <div
          role="img"
          aria-label={accountLabel}
          className="
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
          tooltipContent="Command Palette (Ctrl+:)"
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
