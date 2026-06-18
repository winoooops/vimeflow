import { type ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
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

// Intentional accent exceptions kept on the IconButton via `className`
// (rounded-lg shape + the browser accent hover/focus/disabled skin) — all
// semantic tokens, so they pass `no-hardcoded-colors`. Geometry/base come from
// the `IconButton` ghost `md` variant.
const NAV_BTN =
  'rounded-lg hover:bg-wash-subtle hover:text-agent-browser-accent disabled:cursor-default disabled:opacity-100 disabled:text-outline-variant disabled:hover:bg-transparent disabled:hover:text-outline-variant focus-visible:ring-2 focus-visible:ring-agent-browser-accent/45'

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
          <IconButton
            key={button.key}
            icon={button.icon}
            label={button.label}
            disabled={button.disabled}
            onClick={button.onClick}
            className={NAV_BTN}
          />
        ))}
      </div>

      <div className="w-full min-w-0 justify-self-center">
        <BrowserAddressBar {...address} />
      </div>

      <IconButton
        icon="open_in_new"
        label="open in system browser"
        onClick={onOpenExternal}
        disabled={!canOpenExternal}
        className={`${NAV_BTN} justify-self-end`}
      />

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
