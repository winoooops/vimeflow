import type { ReactElement } from 'react'
import type { ConversationItem } from '../../features/chat/types'

interface SidebarProps {
  conversations: ConversationItem[]
}

export const Sidebar = ({ conversations }: SidebarProps): ReactElement => (
  <aside
    className="w-[260px] h-screen fixed left-[48px] top-0 bg-[#1a1a2a] border-r border-[#4a444f]/15 flex flex-col z-40"
    role="complementary"
    data-testid="sidebar"
  >
    {/* macOS Style Header */}
    <div className="h-14 flex items-center px-4 gap-2" role="banner">
      <div className="flex gap-1.5">
        <div
          className="w-3 h-3 rounded-full bg-[#ff5f56]"
          role="presentation"
        />
        <div
          className="w-3 h-3 rounded-full bg-[#ffbd2e]"
          role="presentation"
        />
        <div
          className="w-3 h-3 rounded-full bg-[#27c93f]"
          role="presentation"
        />
      </div>
    </div>

    {/* Search Bar */}
    <div className="px-4 mb-6" role="search">
      <button
        type="button"
        aria-label="Search sessions"
        className="w-full appearance-none border-none bg-surface-container-highest/50 rounded-lg flex items-center px-3 py-2 gap-2 text-on-surface-variant group focus-within:ring-1 focus-within:ring-primary/40 transition-all"
      >
        <span className="material-symbols-outlined text-sm" aria-hidden="true">
          search
        </span>
        <span className="text-xs font-body flex-1">Search sessions...</span>
        <kbd className="text-[10px] font-label opacity-50 px-1 border border-outline-variant/30 rounded">
          ⌘K
        </kbd>
      </button>
    </div>

    <nav className="flex-1 overflow-y-auto no-scrollbar px-2">
      {/* Category: Recent Chats */}
      <div className="mb-4">
        <div className="px-2 mb-1 flex items-center justify-between group">
          <h2 className="m-0 text-[10px] font-bold tracking-widest text-on-surface-variant uppercase font-headline">
            Recent Chats
          </h2>
          <span
            className="material-symbols-outlined text-xs opacity-0 group-hover:opacity-100 cursor-pointer"
            aria-hidden="true"
          >
            add
          </span>
        </div>

        {/* Active Conversation */}
        {conversations
          .filter((conv) => conv.active)
          .map((conv) => (
            <div
              key={conv.id}
              className="bg-[#1e1e2e] rounded-md px-3 py-3 mb-1 cursor-pointer transition-all duration-200 shadow-sm border border-primary/5"
            >
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary-container/20 flex items-center justify-center text-primary-container shrink-0">
                  <span
                    className="material-symbols-outlined text-lg"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                    aria-hidden="true"
                  >
                    bolt
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-0.5">
                    <span className="text-xs font-semibold text-[#e3e0f7] truncate">
                      {conv.title}
                    </span>
                    <span className="text-[10px] text-on-surface-variant">
                      2m
                    </span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant truncate leading-snug">
                    Agent is analyzing code...
                  </p>
                </div>
              </div>

              {/* Sub-threads UI */}
              {conv.hasSubThreads && (
                <div className="mt-2 ml-11 border-l border-outline-variant/30 pl-3 flex flex-col gap-2">
                  <div className="text-[10px] text-primary-container hover:text-primary transition-colors cursor-pointer flex items-center gap-1.5">
                    <span
                      className="material-symbols-outlined text-[12px]"
                      aria-hidden="true"
                    >
                      subdirectory_arrow_right
                    </span>
                    <span>Sub-thread</span>
                  </div>
                </div>
              )}
            </div>
          ))}

        {/* Inactive Conversations */}
        {conversations
          .filter((conv) => !conv.active)
          .map((conv) => (
            <div
              key={conv.id}
              className="px-3 py-2.5 rounded-md hover:bg-[#1e1e2e]/50 cursor-pointer group transition-all"
            >
              <div className="flex gap-3 items-center">
                <div className="w-8 h-8 rounded-lg bg-surface-container-highest flex items-center justify-center text-on-surface-variant shrink-0 group-hover:bg-surface-bright transition-colors">
                  <span
                    className="material-symbols-outlined text-lg"
                    aria-hidden="true"
                  >
                    chat
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="text-xs text-on-surface-variant group-hover:text-on-surface truncate">
                      {conv.title}
                    </span>
                    <div className="w-1.5 h-1.5 bg-secondary rounded-full" />
                  </div>
                </div>
              </div>
            </div>
          ))}
      </div>

      {/* Category: Active Sessions */}
      <div className="mb-4">
        <div className="px-2 mb-1">
          <h2 className="m-0 text-[10px] font-bold tracking-widest text-on-surface-variant uppercase font-headline">
            Active Sessions
          </h2>
        </div>
        <div className="px-3 py-2 rounded-md hover:bg-[#1e1e2e]/50 cursor-pointer transition-all text-on-surface-variant hover:text-on-surface flex items-center gap-3">
          <span
            className="material-symbols-outlined text-sm"
            aria-hidden="true"
          >
            inventory_2
          </span>
          <span className="text-xs">Frontend Cleanup</span>
        </div>
        <div className="px-3 py-2 rounded-md hover:bg-[#1e1e2e]/50 cursor-pointer transition-all text-on-surface-variant hover:text-on-surface flex items-center gap-3">
          <span
            className="material-symbols-outlined text-sm"
            aria-hidden="true"
          >
            inventory_2
          </span>
          <span className="text-xs">Database Migration</span>
        </div>
      </div>
    </nav>

    {/* Settings */}
    <div className="p-4 mt-auto border-t border-[#4a444f]/10">
      <button
        type="button"
        aria-label="Settings"
        className="w-full appearance-none border-none bg-transparent flex items-center gap-3 px-3 py-2 rounded-md hover:bg-[#1e1e2e]/50 cursor-pointer transition-all text-on-surface-variant"
      >
        <span className="material-symbols-outlined text-sm" aria-hidden="true">
          settings
        </span>
        <span className="text-xs">Settings</span>
      </button>
    </div>
  </aside>
)
