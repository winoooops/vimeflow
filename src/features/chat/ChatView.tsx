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
  isContextPanelOpen?: boolean
  onToggleContextPanel?: () => void
}

const ChatView = ({
  onTabChange = undefined,
  isContextPanelOpen = true,
  onToggleContextPanel = undefined,
}: ChatViewProps): ReactElement => (
  <div
    className="h-screen overflow-hidden flex bg-background text-on-surface font-body selection:bg-primary-container/30"
    data-testid="chat-view"
  >
    {/* Fixed left sidebar components */}
    <IconRail />
    <Sidebar conversations={mockConversations} />

    {/* Main content area with dynamic margins */}
    <main
      className={`ml-[308px] ${isContextPanelOpen ? 'mr-[280px]' : 'mr-0'} flex-1 flex flex-col transition-all duration-300`}
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
    <ContextPanel isOpen={isContextPanelOpen} onToggle={onToggleContextPanel} />
  </div>
)

export default ChatView
