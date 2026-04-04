import type { ReactElement } from 'react'
import IconRail from '../../components/layout/IconRail'
import { Sidebar } from '../../components/layout/Sidebar'
import type { TabName } from '../../components/layout/TopTabBar'
import { TopTabBar } from '../../components/layout/TopTabBar'
import ContextPanel from '../../components/layout/ContextPanel'
import MessageThread from './components/MessageThread'
import MessageInput from './components/MessageInput'
import { mockMessages, mockConversations } from './data/mockMessages'

interface ChatViewProps {
  onTabChange?: (tab: TabName) => void
}

const ChatView = ({ onTabChange = undefined }: ChatViewProps): ReactElement => (
  <div
    className="h-screen overflow-hidden flex bg-background text-on-surface font-body selection:bg-primary-container/30"
    data-testid="chat-view"
  >
    {/* Fixed left sidebar components */}
    <IconRail />
    <Sidebar conversations={mockConversations} />

    {/* Main content area with margins to account for fixed sidebars */}
    <main
      className="ml-[308px] mr-[280px] flex-1 flex flex-col"
      data-testid="main-content"
    >
      {/* Top navigation bar */}
      <TopTabBar activeTab="Chat" onTabChange={onTabChange} />

      {/* Message area containing thread and input */}
      <div className="flex-1 flex flex-col" data-testid="message-area">
        <MessageThread messages={mockMessages} />
        <MessageInput />
      </div>
    </main>

    {/* Fixed right panel */}
    <ContextPanel />
  </div>
)

export default ChatView
