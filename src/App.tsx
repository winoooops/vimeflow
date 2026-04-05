import { useState, useCallback } from 'react'
import type { ReactElement } from 'react'
import type { TabName } from './components/layout/TopTabBar'
import ChatView from './features/chat/ChatView'
import FilesView from './features/files/FilesView'
import { DiffView } from './features/diff/DiffView'
import { CommandPalette } from './features/command-palette/CommandPalette'

const App = (): ReactElement => {
  const [activeTab, setActiveTab] = useState<TabName>('Chat')
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null)

  const handleTabChange = (tab: TabName): void => {
    setActiveTab(tab)
  }

  const handleFileDiffRequest = useCallback((filePath: string): void => {
    setSelectedDiffFile(filePath)
    setActiveTab('Diff')
  }, [])

  const handleClearSelectedDiffFile = useCallback((): void => {
    setSelectedDiffFile(null)
  }, [])

  const renderActiveTab = (): ReactElement => {
    switch (activeTab) {
      case 'Files':
        return (
          <FilesView
            onTabChange={handleTabChange}
            onFileDiffRequest={handleFileDiffRequest}
          />
        )
      case 'Diff':
        return (
          <DiffView
            onTabChange={handleTabChange}
            selectedDiffFile={selectedDiffFile}
            onClearSelectedFile={handleClearSelectedDiffFile}
          />
        )
      case 'Chat':
      default:
        return <ChatView onTabChange={handleTabChange} />
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
