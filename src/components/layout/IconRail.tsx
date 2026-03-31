import type { ReactElement } from 'react'

const IconRail = (): ReactElement => (
  <aside className="w-[48px] h-screen fixed left-0 top-0 flex flex-col items-center py-4 z-50 bg-[#1a1a2a]/80 backdrop-blur-xl shadow-[0px_10px_40px_rgba(0,0,0,0.4)]">
    {/* Brand Logo */}
    <div className="mb-6 flex flex-col gap-1 items-center">
      <span className="text-[#cba6f7] font-black text-xl font-headline">V</span>
    </div>

    {/* Navigation Section */}
    <nav className="flex flex-col gap-4 items-center flex-1">
      {/* Active Project with Left Bar Indicator */}
      <div className="relative group cursor-pointer">
        <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-1 h-8 bg-[#cba6f7] rounded-r-full" />
        <div className="w-9 h-9 rounded-full bg-[#cba6f7]/20 flex items-center justify-center text-[#cba6f7] transition-transform active:scale-90 overflow-hidden">
          <span
            className="material-symbols-outlined"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            terminal
          </span>
        </div>
      </div>

      {/* Inactive Project - Code (with notification badge) */}
      <div className="relative group cursor-pointer hover:bg-[#333344]/50 rounded-full transition-all duration-300 p-1">
        <div className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center text-[#cdc3d1] hover:text-[#e3e0f7] transition-colors">
          <span className="material-symbols-outlined">code</span>
        </div>
        <div className="absolute top-0 right-0 w-2.5 h-2.5 bg-secondary rounded-full border-2 border-surface-container-low" />
      </div>

      {/* Inactive Project - Dashboard */}
      <div className="relative group cursor-pointer hover:bg-[#333344]/50 rounded-full transition-all duration-300 p-1">
        <div className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center text-[#cdc3d1] hover:text-[#e3e0f7] transition-colors">
          <span className="material-symbols-outlined">dashboard</span>
        </div>
      </div>

      {/* Inactive Project - Database */}
      <div className="relative group cursor-pointer hover:bg-[#333344]/50 rounded-full transition-all duration-300 p-1">
        <div className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center text-[#cdc3d1] hover:text-[#e3e0f7] transition-colors">
          <span className="material-symbols-outlined">database</span>
        </div>
      </div>

      {/* Add New Project Button */}
      <div className="relative group cursor-pointer hover:bg-[#333344]/50 rounded-full transition-all duration-300 p-1">
        <div className="w-9 h-9 rounded-full bg-surface-container-highest/40 flex items-center justify-center text-[#cdc3d1] hover:text-[#e3e0f7] transition-colors">
          <span className="material-symbols-outlined">add</span>
        </div>
      </div>
    </nav>

    {/* User Avatar Section (Bottom) */}
    <div className="mt-auto flex flex-col gap-4 items-center">
      <div className="w-8 h-8 rounded-full overflow-hidden border border-outline-variant/30">
        <img
          alt="User Profile"
          className="w-full h-full object-cover"
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuASR_qbpXunxTazw6pajVlQGs34tUxub1dc_lmZhj0MNndZ28hUcsQhVvL_xG7MNz3lXToheqCtD1U372qMA-2BCatq3eLXHXraVr6vC6KQ09SwJywNvOp1f26bi5GCp4cjTza_8bqTZe4P9vQJucGdPL2gvhbRuxOUWhcxEAfXXWmaa-ZqcdtbLO_8MwQnxLEQ_15at85rFp2QZZe2nQWhWGSxdMmj5LtIbM_xFNqZiaqO8dYjoawTnotoFgDWqYuf7EuQ3me5IBA"
        />
      </div>
    </div>
  </aside>
)

export default IconRail
