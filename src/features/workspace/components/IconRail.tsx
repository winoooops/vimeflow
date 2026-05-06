import type { ReactElement } from 'react'
import { Tooltip } from '../../../components/Tooltip'
import type { NavigationItem } from '../types'

export interface IconRailProps {
  items: NavigationItem[]
  settingsItem: NavigationItem
}

export const IconRail = ({
  items,
  settingsItem,
}: IconRailProps): ReactElement => (
  <div
    className="relative flex h-full w-12 flex-col items-center justify-between bg-surface border-r border-white/5 py-3"
    data-testid="icon-rail"
  >
    <div className="flex w-full flex-col items-center gap-3">
      {items.map((item) => (
        <div key={item.id} className="flex w-full justify-center">
          <Tooltip content={item.name} placement="right">
            <button
              type="button"
              onClick={item.onClick}
              className={`flat-bookmark flex h-12 w-8 items-center justify-center ${item.color}`}
              aria-label={item.name}
            >
              <span className="material-symbols-outlined mb-2 text-lg text-white">
                {item.icon}
              </span>
            </button>
          </Tooltip>
        </div>
      ))}
    </div>

    <div className="flex w-full justify-center">
      <Tooltip content={settingsItem.name} placement="right">
        <button
          type="button"
          onClick={settingsItem.onClick}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-on-surface/50 transition-colors hover:bg-surface-container hover:text-on-surface"
          aria-label={settingsItem.name}
        >
          <span className="material-symbols-outlined text-xl">
            {settingsItem.icon}
          </span>
        </button>
      </Tooltip>
    </div>
  </div>
)
