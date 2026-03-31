import type { ReactElement } from 'react'
import IconRail from '../../components/layout/IconRail'
import { Sidebar } from '../../components/layout/Sidebar'
import { TopTabBar } from '../../components/layout/TopTabBar'
import ContextPanel from '../../components/layout/ContextPanel'
import MessageThread from './components/MessageThread'
import MessageInput from './components/MessageInput'
import { mockMessages, mockConversations } from './data/mockMessages'

/**
 * ChatView component - Main page assembly with all layout components and chat content.
 * This component integrates the Icon Rail, Sidebar, Top Tab Bar, Context Panel,
 * Message Thread, and Message Input into a single cohesive chat interface.
 */
const ChatView = (): ReactElement => (
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
      <TopTabBar />

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
