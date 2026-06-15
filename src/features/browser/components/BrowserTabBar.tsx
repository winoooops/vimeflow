import { type MouseEvent, type ReactElement } from 'react'
import type { BrowserPaneTab } from '../types'
import { BROWSER_IDENTITY } from '../browserIdentity'
import { BrowserTabFavicon } from './BrowserTabFavicon'
import { IconButton } from '@/components/IconButton'

export interface BrowserTabBarProps {
  tabs: BrowserPaneTab[]
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onNewTab: () => void
  onClosePane?: () => void
}

const ICON_BTN =
  'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-on-surface-muted transition hover:bg-wash-subtle hover:text-[var(--color-agent-browser-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-agent-browser-accent)_45%,transparent)]'

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
          'linear-gradient(180deg, color-mix(in srgb, var(--color-agent-browser-accent) 5%, transparent), transparent 70%), var(--color-browser-bar)',
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
          const title = tab.title ?? tab.url

          const handleClose = (event: MouseEvent<HTMLButtonElement>): void => {
            event.stopPropagation()
            onClose(tab.id)
          }

          return (
            <div
              key={tab.id}
              data-testid="browser-tab"
              className={`group flex h-[27px] min-w-[96px] max-w-[210px] flex-1 items-center gap-2 rounded-lg border px-2 transition ${
                tab.active
                  ? 'border-[color-mix(in_srgb,var(--color-on-surface)_10%,transparent)] bg-browser-tab-active shadow-[0_2px_8px_color-mix(in_srgb,var(--color-surface-container-lowest)_40%,transparent)]'
                  : 'border-transparent hover:bg-wash-faint'
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
                <BrowserTabFavicon favicon={tab.favicon} url={tab.url} />
                <span
                  className={`min-w-0 flex-1 truncate text-left font-mono text-[10.5px] ${
                    tab.active ? 'text-on-surface' : 'text-on-surface-muted'
                  }`}
                >
                  {title}
                </span>
              </button>
              {canCloseTabs ? (
                <IconButton
                  icon="close"
                  label={`close browser tab ${title}`}
                  onClick={handleClose}
                  className={`h-4 w-4 rounded-[4px] text-[11px] text-syn-comment hover:bg-wash-soft hover:text-on-surface focus-visible:opacity-100 group-hover:opacity-80 group-focus-within:opacity-80 ${
                    tab.active ? 'opacity-80' : 'opacity-0'
                  }`}
                />
              ) : null}
            </div>
          )
        })}

        <IconButton
          icon="add"
          label="new browser tab"
          onClick={onNewTab}
          className={`${ICON_BTN} text-[15px]`}
        />
      </div>

      {onClosePane ? (
        <>
          <div className="h-[18px] w-px shrink-0 bg-outline-variant/40" />
          <IconButton
            icon="close"
            label="close browser pane"
            onClick={onClosePane}
            className={`${ICON_BTN} text-[15px]`}
          />
        </>
      ) : null}
    </div>
  )
}
