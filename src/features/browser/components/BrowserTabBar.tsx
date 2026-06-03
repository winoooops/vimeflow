import { type MouseEvent, type ReactElement } from 'react'
import type { BrowserPaneTab } from '../types'
import { BROWSER_IDENTITY } from '../browserIdentity'
import { faviconPlaceholder, type FaviconTone } from '../faviconPlaceholder'

export interface BrowserTabBarProps {
  tabs: BrowserPaneTab[]
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onNewTab: () => void
  onClosePane?: () => void
}

const TONE_CLASS: Record<FaviconTone, string> = {
  cyan: 'text-[#4fc8d6] bg-[rgba(79,200,214,0.12)]',
  mauve: 'text-[#cba6f7] bg-[rgba(203,166,247,0.12)]',
  coral: 'text-[#ff94a5] bg-[rgba(255,148,165,0.12)]',
}

const ICON_BTN =
  'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-on-surface-muted transition hover:bg-white/[0.05] hover:text-[#4fc8d6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4fc8d6]/45'

export const BrowserTabBar = ({
  tabs,
  onActivate,
  onClose,
  onNewTab,
  onClosePane = undefined,
}: BrowserTabBarProps): ReactElement => {
  const canCloseTabs = tabs.length > 1

  return (
    <div
      className="flex h-[38px] shrink-0 items-center gap-[5px] px-2"
      style={{
        background:
          'linear-gradient(180deg, rgba(79,200,214,0.05), transparent 70%), #121226',
      }}
    >
      <span
        className="flex shrink-0 items-center gap-[5px] rounded-[7px] px-2 py-[3px] font-mono text-[10px] font-semibold tracking-wide"
        style={{
          color: BROWSER_IDENTITY.accent,
          background: BROWSER_IDENTITY.accentDim,
          border: `1px solid ${BROWSER_IDENTITY.accentSoft}`,
        }}
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[12px]"
        >
          public
        </span>
        {BROWSER_IDENTITY.short}
      </span>

      <div
        role="tablist"
        aria-label="browser tabs"
        className="flex min-w-0 flex-1 items-center gap-[5px] overflow-x-auto"
      >
        {tabs.map((tab) => {
          const fav = faviconPlaceholder(tab.url)
          const title = tab.title ?? tab.url

          const handleClose = (event: MouseEvent<HTMLButtonElement>): void => {
            event.stopPropagation()
            onClose(tab.id)
          }

          return (
            <div
              key={tab.id}
              className={`group flex h-[27px] min-w-[96px] max-w-[210px] items-center gap-2 rounded-lg border px-2 transition ${
                tab.active
                  ? 'border-white/10 bg-browser-tab-active shadow-[0_2px_8px_rgba(0,0,0,0.4)]'
                  : 'border-transparent hover:bg-white/[0.04]'
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab.active}
                aria-label={`browser tab ${title}`}
                onClick={(): void => onActivate(tab.id)}
                className="flex min-w-0 flex-1 items-center gap-2 focus:outline-none"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] ${TONE_CLASS[fav.tone]}`}
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[10px]"
                  >
                    {fav.glyph}
                  </span>
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-left font-mono text-[10.5px] ${
                    tab.active ? 'text-on-surface' : 'text-on-surface-muted'
                  }`}
                >
                  {title}
                </span>
              </button>
              {canCloseTabs ? (
                <button
                  type="button"
                  aria-label={`close browser tab ${title}`}
                  onClick={handleClose}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-syn-comment transition hover:bg-white/[0.08] hover:text-on-surface focus:outline-none focus-visible:opacity-100 group-hover:opacity-80 group-focus-within:opacity-80 ${
                    tab.active ? 'opacity-80' : 'opacity-0'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[11px]"
                  >
                    close
                  </span>
                </button>
              ) : null}
            </div>
          )
        })}

        <button
          type="button"
          aria-label="new browser tab"
          onClick={onNewTab}
          className={ICON_BTN}
        >
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[15px]"
          >
            add
          </span>
        </button>
      </div>

      {onClosePane ? (
        <>
          <div className="h-[18px] w-px shrink-0 bg-outline-variant/40" />
          <button
            type="button"
            aria-label="close browser pane"
            onClick={onClosePane}
            className={ICON_BTN}
          >
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-[15px]"
            >
              close
            </span>
          </button>
        </>
      ) : null}
    </div>
  )
}
