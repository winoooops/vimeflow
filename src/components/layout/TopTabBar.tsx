import type { ReactElement } from 'react'

export const TopTabBar = (): ReactElement => (
  <header
    className="h-14 flex items-center justify-between px-6 bg-[#121221]/90 backdrop-blur-md border-b border-[#4a444f]/15 z-30"
    data-testid="top-tab-bar"
  >
    <nav className="flex items-center h-full">
      <div className="flex h-full items-center gap-2">
        {/* Active tab - Chat */}
        <button className="text-[#e2c7ff] border-b-2 border-[#cba6f7] h-full flex items-center px-4 font-headline text-sm font-semibold transition-all">
          Chat
        </button>
        {/* Inactive tabs */}
        <button className="text-on-surface-variant hover:text-on-surface hover:bg-[#1e1e2e] h-[calc(100%-16px)] my-2 rounded-lg flex items-center px-4 text-sm font-medium transition-all">
          Files
        </button>
        <button className="text-on-surface-variant hover:text-on-surface hover:bg-[#1e1e2e] h-[calc(100%-16px)] my-2 rounded-lg flex items-center px-4 text-sm font-medium transition-all">
          Editor
        </button>
        <button className="text-on-surface-variant hover:text-on-surface hover:bg-[#1e1e2e] h-[calc(100%-16px)] my-2 rounded-lg flex items-center px-4 text-sm font-medium transition-all">
          Diff
        </button>
      </div>
    </nav>
    <div className="flex items-center gap-4">
      {/* Notification bell */}
      <button
        className="text-on-surface-variant hover:text-primary transition-colors"
        aria-label="Notifications"
      >
        <span className="material-symbols-outlined text-xl">notifications</span>
      </button>
      {/* More menu */}
      <button
        className="text-on-surface-variant hover:text-on-surface transition-colors"
        aria-label="More options"
      >
        <span className="material-symbols-outlined text-xl">more_vert</span>
      </button>
    </div>
  </header>
)
