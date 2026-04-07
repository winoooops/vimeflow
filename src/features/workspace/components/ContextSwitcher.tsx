import type { ReactElement } from 'react'
import type { ContextPanelType } from '../types'

export interface ContextSwitcherProps {
  activeTab: ContextPanelType
  onTabChange: (tab: ContextPanelType) => void
}

interface Tab {
  id: ContextPanelType
  emoji: string
  label: string
}

const tabs: Tab[] = [
  { id: 'files', emoji: '📁', label: 'Files' },
  { id: 'editor', emoji: '📝', label: 'Editor' },
  { id: 'diff', emoji: '±', label: 'Diff' },
]

export const ContextSwitcher = ({
  activeTab,
  onTabChange,
}: ContextSwitcherProps): ReactElement => (
  <div
    className="flex border-b border-surface-container bg-surface-container-low"
    data-testid="context-switcher"
  >
    {tabs.map((tab) => {
      const isActive = tab.id === activeTab

      return (
        <button
          key={tab.id}
          type="button"
          onClick={() => {
            onTabChange(tab.id)
          }}
          className={`
            flex-1 border-b-2 px-3 py-2 font-label text-sm font-medium
            transition-colors
            ${
              isActive
                ? 'border-b-primary text-primary'
                : 'border-b-transparent text-on-surface/60 hover:bg-surface-container/30 hover:text-on-surface'
            }
          `}
          aria-label={tab.label}
        >
          <span className="mr-1">{tab.emoji}</span>
          {tab.label}
        </button>
      )
    })}
  </div>
)
