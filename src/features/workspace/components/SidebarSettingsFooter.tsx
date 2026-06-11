import { type ReactElement } from 'react'
import { Tooltip } from '../../../components/Tooltip'

export interface SidebarSettingsFooterProps {
  /** Open Settings; when omitted the button renders as a disabled stub. */
  onSettings?: () => void
  /** Settings follow-up issue number, surfaced in the disabled tooltip. */
  settingsIssueNumber?: number
}

export const SidebarSettingsFooter = ({
  onSettings = undefined,
  settingsIssueNumber = undefined,
}: SidebarSettingsFooterProps): ReactElement => {
  const disabled = !onSettings

  const label = settingsIssueNumber
    ? `Settings — coming (see issue #${settingsIssueNumber})`
    : 'Settings'

  return (
    <Tooltip content={label} placement="top">
      <button
        type="button"
        aria-label={label}
        aria-disabled={disabled || undefined}
        data-testid="sidebar-settings-footer"
        onClick={() => {
          if (disabled) {
            return
          }

          onSettings()
        }}
        className={`vf-app-no-drag flex h-10 w-full items-center gap-2 rounded-[8px] px-3 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
          disabled
            ? 'text-on-surface-muted'
            : 'text-on-surface-variant hover:bg-white/[0.06] hover:text-on-surface'
        }`}
      >
        <span
          className="material-symbols-outlined text-[17px]"
          aria-hidden="true"
        >
          settings
        </span>
        <span className="min-w-0 truncate">Settings</span>
      </button>
    </Tooltip>
  )
}
