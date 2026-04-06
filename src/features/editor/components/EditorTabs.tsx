import type { ReactElement } from 'react'
import type { EditorTab } from '../types'

interface EditorTabsProps {
  tabs: EditorTab[]
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
}

export const EditorTabs = ({
  tabs,
  onTabClick,
  onTabClose,
}: EditorTabsProps): ReactElement => {
  const handleTabClick = (tabId: string): void => {
    onTabClick(tabId)
  }

  const handleCloseClick = (event: React.MouseEvent, tabId: string): void => {
    event.stopPropagation()
    onTabClose(tabId)
  }

  const handleKeyDown = (event: React.KeyboardEvent, tabId: string): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleTabClick(tabId)
    }
  }

  return (
    <div className="h-10 bg-surface-container-low flex items-center">
      <div role="tablist" className="flex h-full">
        {tabs.map((tab) => {
          const isActive = tab.isActive

          return (
            <div
              key={tab.id}
              data-testid={`editor-tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              onClick={() => handleTabClick(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, tab.id)}
              className={`
                h-full px-4 flex items-center gap-2 cursor-pointer transition-colors
                ${
                  isActive
                    ? 'bg-surface text-on-surface border-t-2 border-primary'
                    : 'text-on-surface-variant/60 hover:bg-surface-variant/20'
                }
              `}
            >
              <span className="material-symbols-outlined text-[16px]">
                {tab.icon}
              </span>
              <span className="text-xs font-medium">
                {tab.fileName}
                {tab.isDirty && <span className="ml-1 text-primary">●</span>}
              </span>
              <button
                onClick={(e) => handleCloseClick(e, tab.id)}
                aria-label={`Close ${tab.fileName}`}
                className="material-symbols-outlined text-[10px] ml-2 hover:bg-surface-variant rounded-full p-0.5 transition-colors"
              >
                close
              </button>
            </div>
          )
        })}
      </div>
      <div className="flex-1 bg-surface-container-low h-full" />
    </div>
  )
}
