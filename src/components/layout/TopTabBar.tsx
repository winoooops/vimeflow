import type { ReactElement } from 'react'

export type TabName = 'Chat' | 'Files' | 'Editor' | 'Diff'

interface TopTabBarProps {
  activeTab?: TabName
  onTabChange?: (tab: TabName) => void
}

export const TopTabBar = ({
  activeTab = 'Chat',
  onTabChange = undefined,
}: TopTabBarProps): ReactElement => {
  const tabs: TabName[] = ['Chat', 'Files', 'Editor', 'Diff']

  const getTabClassName = (tab: TabName): string => {
    if (tab === activeTab) {
      return 'text-[#e2c7ff] border-b-2 border-[#cba6f7] h-full flex items-center px-4 font-headline text-sm font-semibold transition-all'
    }

    return 'text-on-surface-variant hover:text-on-surface hover:bg-[#1e1e2e] h-[calc(100%-16px)] my-2 rounded-lg flex items-center px-4 text-sm font-medium transition-all'
  }

  return (
    <header
      className="h-14 flex items-center justify-between px-6 bg-[#121221]/90 backdrop-blur-md border-b border-[#4a444f]/15 z-30"
      data-testid="top-tab-bar"
    >
      <nav className="flex items-center h-full">
        <div className="flex h-full items-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={getTabClassName(tab)}
              aria-current={tab === activeTab ? 'page' : undefined}
              onClick={(): void => onTabChange?.(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </nav>
      <div className="flex items-center gap-4">
        {/* Notification bell */}
        <button
          className="text-on-surface-variant hover:text-primary transition-colors"
          aria-label="Notifications"
        >
          <span
            className="material-symbols-outlined text-xl"
            aria-hidden="true"
          >
            notifications
          </span>
        </button>
        {/* More menu */}
        <button
          className="text-on-surface-variant hover:text-on-surface transition-colors"
          aria-label="More options"
        >
          <span
            className="material-symbols-outlined text-xl"
            aria-hidden="true"
          >
            more_vert
          </span>
        </button>
      </div>
    </header>
  )
}
