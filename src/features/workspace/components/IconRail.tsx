import { useState, type ReactElement } from 'react'
import type { NavigationItem } from '../types'

export interface IconRailProps {
  items: NavigationItem[]
  settingsItem: NavigationItem
}

export const IconRail = ({
  items,
  settingsItem,
}: IconRailProps): ReactElement => {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  return (
    <div
      className="relative flex h-full w-16 flex-col items-center justify-between bg-surface border-r border-white/5 py-3"
      data-testid="icon-rail"
    >
      {/* Navigation items (top) */}
      <div className="flex w-full flex-col items-center gap-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="relative flex w-full justify-center"
            onMouseEnter={() => setHoveredItem(item.id)}
            onMouseLeave={() => setHoveredItem(null)}
          >
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

            {/* Tooltip on hover */}
            {hoveredItem === item.id && (
              <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-surface-container px-2 py-1 text-xs text-on-surface shadow-lg">
                {item.name}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Settings item (bottom) — plain gear icon */}
      <div
        className="relative flex w-full justify-center"
        onMouseEnter={() => setHoveredItem(settingsItem.id)}
        onMouseLeave={() => setHoveredItem(null)}
      >
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

        {/* Tooltip on hover */}
        {hoveredItem === settingsItem.id && (
          <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-surface-container px-2 py-1 text-xs text-on-surface shadow-lg">
            {settingsItem.name}
          </div>
        )}
      </div>
    </div>
  )
}
