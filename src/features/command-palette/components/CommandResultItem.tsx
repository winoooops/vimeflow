import type { ReactElement } from 'react'
import type { Command } from '../types'

interface CommandResultItemProps {
  command: Command
  isSelected: boolean
  onSelect: () => void
}

export const CommandResultItem = ({
  command,
  isSelected,
  onSelect,
}: CommandResultItemProps): ReactElement => (
  <div
    role="option"
    aria-selected={isSelected}
    onClick={onSelect}
    className={`
        group px-3 py-2.5 rounded-xl flex items-center gap-3 cursor-pointer transition-all
        ${isSelected ? 'bg-primary-container/10 border border-primary-container/10' : 'hover:bg-surface-container-low/30'}
      `}
  >
    {/* Icon - filled if selected, outlined if not */}
    <span
      className={`material-symbols-outlined text-xl ${isSelected ? 'text-primary-container' : 'text-on-surface/60'}`}
      style={{ fontVariationSettings: isSelected ? '"FILL" 1' : '"FILL" 0' }}
    >
      {command.icon}
    </span>

    {/* Label and description */}
    <div className="flex-1 min-w-0">
      <div className="text-on-surface font-medium">{command.label}</div>
      {command.description && (
        <div className="text-on-surface/60 text-sm">{command.description}</div>
      )}
    </div>

    {/* Enter badge - always visible when selected, visible on hover otherwise */}
    <div
      className={`
          bg-surface-container-highest/50 px-2 py-1 rounded text-[10px] font-bold text-on-surface/60 font-mono
          ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
          transition-opacity
        `}
    >
      ↵
    </div>
  </div>
)
