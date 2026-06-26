import type { ReactElement } from 'react'
import type { Command } from '../types'
import { KeyCap } from './KeyCap'

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
    // Keep input focus on click so namespace drilling stays typeable.
    onMouseDown={(event) => event.preventDefault()}
    onClick={onExecute}
    className={`group flex items-center gap-[12px] px-[12px] py-[9px] my-[2px] rounded-[8px] border transition-colors cursor-pointer ${
      isSelected
        ? 'bg-primary-container/10 border-primary-container/25'
        : 'border-transparent hover:bg-surface-container-high/40'
    }`}
  >
    {/* Icon - filled + accent when selected, muted outline otherwise */}
    <span
      className={`material-symbols-outlined text-[15px] shrink-0 ${isSelected ? 'text-primary' : 'text-on-surface-muted'}`}
      style={{ fontVariationSettings: isSelected ? '"FILL" 1' : '"FILL" 0' }}
    >
      {command.icon}
    </span>

    {/* Verb - accent mono, fixed min-width column */}
    <span className="font-mono text-[11.5px] text-primary min-w-[100px] shrink-0 whitespace-nowrap">
      {command.label}
    </span>

    {/* Label - the action name, fills remaining width */}
    <span className="text-[12.5px] text-on-surface flex-1 min-w-0 truncate">
      {command.description}
    </span>

    {/* Hint - dim tertiary detail */}
    {command.hint && (
      <span className="hidden text-[11px] text-on-surface-muted truncate sm:block">
        {command.hint}
      </span>
    )}

    {/* Shortcut chips - only when a real accelerator exists */}
    {command.shortcut && command.shortcut.length > 0 && (
      <div
        className="flex items-center gap-[3px] shrink-0"
        data-testid="command-shortcut"
      >
        {command.shortcut.map((key, index) => (
          <KeyCap key={`${command.id}-kc-${index}`} active={isSelected}>
            {key}
          </KeyCap>
        ))}
      </div>
    )}
  </div>
)
