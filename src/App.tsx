import { useState } from 'react'
import type { ReactElement } from 'react'
import type { TabName } from './components/layout/TopTabBar'
import ChatView from './features/chat/ChatView'
import FilesView from './features/files/FilesView'

const App = (): ReactElement => {
  const [activeTab, setActiveTab] = useState<TabName>('Chat')

  const handleTabChange = (tab: TabName): void => {
    setActiveTab(tab)
  }

  switch (activeTab) {
    case 'Files':
      return <FilesView onTabChange={handleTabChange} />
    case 'Chat':
    default:
      return <ChatView onTabChange={handleTabChange} />
  }
}

export default App
