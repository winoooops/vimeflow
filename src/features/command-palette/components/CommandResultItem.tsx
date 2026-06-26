import type { ReactElement } from 'react'
import type { Command } from '../types'

interface CommandResultItemProps {
  id: string
  command: Command
  isSelected: boolean
  onSelect: () => void
  onExecute: () => void
}

export const CommandResultItem = ({
  id,
  command,
  isSelected,
  onSelect,
  onExecute,
}: CommandResultItemProps): ReactElement => (
  <div
    id={id}
    role="option"
    aria-selected={isSelected}
    onMouseEnter={onSelect}
    onClick={onExecute}
    className={`
        group px-3 py-2.5 rounded-xl flex items-center gap-3 cursor-pointer transition-all border-l-2
        ${isSelected ? 'bg-primary-container/10 border-primary-container' : 'border-transparent hover:bg-surface-container-highest/50'}
      `}
  >
    {/* Icon - filled if selected, outlined if not */}
    <span
      className={`material-symbols-outlined text-lg ${isSelected ? 'text-primary-container' : 'text-on-surface-variant'}`}
      style={{
        fontVariationSettings: isSelected ? '"FILL" 1' : '"FILL" 0',
      }}
    >
      {command.icon}
    </span>

    {/* Verb - accent mono */}
    <span className="font-mono text-primary-container text-[11.5px] min-w-[7rem] truncate">
      {command.label}
    </span>

    {/* Name - description, fills remaining width */}
    <span className="text-on-surface text-sm flex-1 min-w-0 truncate">
      {command.description}
    </span>

    {/* Keyboard shortcut chips - only when a real accelerator exists */}
    {command.shortcut && command.shortcut.length > 0 && (
      <div className="flex items-center gap-1" data-testid="command-shortcut">
        {command.shortcut.map((key, index) => (
          <span
            key={`${command.id}-kc-${index}`}
            className={`inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded text-[10px] font-semibold font-mono border ${
              isSelected
                ? 'bg-primary-container/20 text-primary-container border-primary-container/40'
                : 'bg-surface-container-highest text-on-surface-variant border-outline-variant/40'
            }`}
          >
            {key}
          </span>
        ))}
      </div>
    )}
  </div>
)
