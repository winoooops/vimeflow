import type { ReactElement } from 'react'

export const CommandFooter = (): ReactElement => (
  <div className="bg-surface-container-lowest/50 px-5 py-3 flex items-center justify-between">
    {/* Keyboard shortcuts */}
    <div className="flex items-center gap-4">
      {/* Navigate hint */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="material-symbols-outlined text-sm text-on-surface/60">
            arrow_upward
          </span>
          <span className="material-symbols-outlined text-sm text-on-surface/60">
            arrow_downward
          </span>
        </div>
        <span className="text-sm text-on-surface/60">Navigate</span>
      </div>

      {/* Run hint */}
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-sm text-on-surface/60">
          keyboard_return
        </span>
        <span className="text-sm text-on-surface/60">Run</span>
      </div>
    </div>
  </div>
)
