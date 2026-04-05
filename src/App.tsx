import { useState, useCallback } from 'react'
import type { ReactElement } from 'react'
import type { TabName } from './components/layout/TopTabBar'
import ChatView from './features/chat/ChatView'
import { DiffView } from './features/diff/DiffView'
import { EditorView } from './features/editor/EditorView'
import { CommandPalette } from './features/command-palette/CommandPalette'

const App = (): ReactElement => {
  const [activeTab, setActiveTab] = useState<TabName>('Chat')
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null)
  const [isContextPanelOpen, setIsContextPanelOpen] = useState<boolean>(true)

  const handleTabChange = (tab: TabName): void => {
    setActiveTab(tab)
  }

  const handleToggleContextPanel = useCallback((): void => {
    setIsContextPanelOpen((prev) => !prev)
  }, [])

  const handleFileDiffRequest = useCallback((filePath: string): void => {
    setSelectedDiffFile(filePath)
    setActiveTab('Diff')
  }, [])

  const handleClearSelectedDiffFile = useCallback((): void => {
    setSelectedDiffFile(null)
  }, [])

  const renderActiveTab = (): ReactElement => {
    switch (activeTab) {
      case 'Diff':
        return (
          <DiffView
            onTabChange={handleTabChange}
            selectedDiffFile={selectedDiffFile}
            onClearSelectedFile={handleClearSelectedDiffFile}
            isContextPanelOpen={isContextPanelOpen}
            onToggleContextPanel={handleToggleContextPanel}
          />
        )
      case 'Editor':
        return (
          <EditorView
            onTabChange={handleTabChange}
            onFileDiffRequest={handleFileDiffRequest}
            isContextPanelOpen={isContextPanelOpen}
            onToggleContextPanel={handleToggleContextPanel}
          />
        )
      case 'Chat':
      default:
        return (
          <ChatView
            onTabChange={handleTabChange}
            isContextPanelOpen={isContextPanelOpen}
            onToggleContextPanel={handleToggleContextPanel}
          />
        )
    }
  }

  return (
    <>
      {renderActiveTab()}
      <CommandPalette />
    </>
  )
}

export default App
