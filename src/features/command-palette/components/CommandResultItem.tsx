import type { ReactElement } from 'react'
import type { Command } from '../types'

interface CommandResultItemProps {
  id: string
  command: Command
  isSelected: boolean
  onSelect: () => void
}

export const CommandResultItem = ({
  id,
  command,
  isSelected,
  onSelect,
}: CommandResultItemProps): ReactElement => (
  <div
    id={id}
    role="option"
    aria-selected={isSelected}
    onClick={onSelect}
    className={`
        group px-3 py-2.5 rounded-xl flex items-center justify-between cursor-pointer transition-all
        ${isSelected ? 'bg-primary-container/10' : 'hover:bg-surface-container-highest/50'}
      `}
  >
    <div className="flex items-center gap-3">
      {/* Icon - filled if selected, outlined if not */}
      <span
        className={`material-symbols-outlined text-lg ${isSelected ? 'text-primary-container' : 'text-on-surface-variant'}`}
        style={{
          fontVariationSettings: isSelected ? '"FILL" 1' : '"FILL" 0',
        }}
      >
        {command.icon}
      </span>

      {/* Label and description */}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-on-surface">
          {command.label}
        </span>
        {command.description && (
          <span className="text-sm text-on-surface-variant ml-2">
            {command.description}
          </span>
        )}
      </div>
    </div>

    {/* Enter badge - matches design: icon + text */}
    <div
      className={`
          flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container-highest text-[10px] text-on-surface-variant font-bold uppercase
          ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
          transition-opacity
        `}
    >
      <span className="material-symbols-outlined text-[12px]">
        keyboard_return
      </span>
      <span>Enter</span>
    </div>
  </div>
)
