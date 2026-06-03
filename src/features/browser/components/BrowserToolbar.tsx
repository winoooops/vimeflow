import { type ReactElement } from 'react'
import {
  BrowserAddressBar,
  type BrowserAddressBarProps,
} from './BrowserAddressBar'

export interface BrowserToolbarProps extends BrowserAddressBarProps {
  onOpenExternal: () => void
  canOpenExternal: boolean
}

const NAV_BTN =
  'flex h-[27px] w-[27px] items-center justify-center rounded-lg text-on-surface-muted transition hover:bg-white/[0.05] hover:text-[#4fc8d6] disabled:cursor-default disabled:text-outline-variant disabled:hover:bg-transparent disabled:hover:text-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4fc8d6]/45'

const NAV_BUTTONS: readonly { icon: string; label: string }[] = [
  { icon: 'arrow_back', label: 'back' },
  { icon: 'arrow_forward', label: 'forward' },
  { icon: 'refresh', label: 'reload' },
]

export const BrowserToolbar = ({
  onOpenExternal,
  canOpenExternal,
  ...address
}: BrowserToolbarProps): ReactElement => (
  <div
    className="grid h-[40px] shrink-0 items-center gap-[6px] overflow-hidden bg-surface-container-lowest px-[10px]"
    style={{
      gridTemplateColumns:
        'minmax(min-content,1fr) auto minmax(min-content,1fr)',
    }}
  >
    <div className="flex items-center gap-[6px] justify-self-start">
      {NAV_BUTTONS.map((button) => (
        <button
          key={button.label}
          type="button"
          disabled
          aria-label={button.label}
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
  </div>
)
