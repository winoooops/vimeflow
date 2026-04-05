import { useState } from 'react'
import type { ReactElement } from 'react'
import type { TabName } from './components/layout/TopTabBar'
import ChatView from './features/chat/ChatView'
import FilesView from './features/files/FilesView'
import { CommandPalette } from './features/command-palette/CommandPalette'

const App = (): ReactElement => {
  const [activeTab, setActiveTab] = useState<TabName>('Chat')

  const handleTabChange = (tab: TabName): void => {
    setActiveTab(tab)
  }

  return (
    <>
      {activeTab === 'Files' ? (
        <FilesView onTabChange={handleTabChange} />
      ) : (
        <ChatView onTabChange={handleTabChange} />
      )}
      <CommandPalette />
    </>
  )
}

export default App
