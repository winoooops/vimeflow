import { type ReactElement } from 'react'
import {
  BrowserAddressBar,
  type BrowserAddressBarProps,
} from './BrowserAddressBar'
import { BROWSER_IDENTITY } from '../browserIdentity'

export interface BrowserToolbarProps extends BrowserAddressBarProps {
  onOpenExternal: () => void
  canOpenExternal: boolean
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  onBack: () => void
  onForward: () => void
  onReloadOrStop: () => void
}

const NAV_BTN =
  'flex h-[27px] w-[27px] items-center justify-center rounded-lg text-on-surface-muted transition hover:bg-white/[0.05] hover:text-[#4fc8d6] disabled:cursor-default disabled:text-outline-variant disabled:hover:bg-transparent disabled:hover:text-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4fc8d6]/45'

export const BrowserToolbar = ({
  onOpenExternal,
  canOpenExternal,
  canGoBack,
  canGoForward,
  isLoading,
  onBack,
  onForward,
  onReloadOrStop,
  ...address
}: BrowserToolbarProps): ReactElement => {
  const navButtons: readonly {
    key: string
    icon: string
    label: string
    disabled: boolean
    onClick: () => void
  }[] = [
    {
      key: 'back',
      icon: 'arrow_back',
      label: 'back',
      disabled: !canGoBack,
      onClick: onBack,
    },
    {
      key: 'forward',
      icon: 'arrow_forward',
      label: 'forward',
      disabled: !canGoForward,
      onClick: onForward,
    },
    {
      key: 'reload',
      icon: isLoading ? 'close' : 'refresh',
      label: isLoading ? 'stop' : 'reload',
      disabled: false,
      onClick: onReloadOrStop,
    },
  ]

  return (
    <div
      className="relative grid h-[40px] shrink-0 items-center gap-[6px] overflow-hidden bg-surface-container-lowest px-[10px]"
      style={{
        gridTemplateColumns:
          'minmax(min-content,1fr) auto minmax(min-content,1fr)',
      }}
    >
      <div className="flex items-center gap-[6px] justify-self-start">
        {navButtons.map((button) => (
          <button
            key={button.key}
            type="button"
            disabled={button.disabled}
            aria-label={button.label}
            onClick={button.onClick}
            className={NAV_BTN}
          >
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-[17px]"
            >
              {button.icon}
            </span>
          </button>
        ))}
      </div>

      <div className="w-full min-w-0 justify-self-center">
        <BrowserAddressBar {...address} />
      </div>

      <button
        type="button"
        aria-label="open in system browser"
        onClick={onOpenExternal}
        disabled={!canOpenExternal}
        className={`${NAV_BTN} justify-self-end`}
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[17px]"
        >
          open_in_new
        </span>
      </button>

      {isLoading ? (
        <div
          data-testid="browser-load-bar"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden"
        >
          <div
            className="h-full w-2/5 motion-safe:animate-browser-load-bar motion-reduce:w-full motion-reduce:opacity-60"
            style={{
              background: `linear-gradient(90deg, transparent, ${BROWSER_IDENTITY.accent}, transparent)`,
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
