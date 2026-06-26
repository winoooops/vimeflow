import { type ChangeEvent, type ReactElement, useEffect, useRef } from 'react'
import { KeyCap } from './KeyCap'

interface CommandInputProps {
  value: string
  onChange: (value: string) => void
  activeDescendantId?: string
}

export const CommandInput = ({
  value,
  onChange,
  activeDescendantId = undefined,
}: CommandInputProps): ReactElement => {
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange(event.target.value)
  }

  return (
    <div className="flex items-center gap-[10px] px-[16px] py-[14px]">
      {/* Terminal glyph in accent, per the handoff input row */}
      <span className="material-symbols-outlined text-[16px] text-primary-container">
        terminal
      </span>

      {/* Input field - monospace, matching the handoff */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        className="flex-1 bg-transparent border-none outline-none font-mono text-[13.5px] text-on-surface placeholder:text-on-surface-muted"
        placeholder="type a command, : prefix, or search files…"
        role="combobox"
        aria-label="Command palette search"
        aria-expanded
        aria-controls="command-palette-listbox"
        aria-activedescendant={activeDescendantId}
      />

      {/* ESC keycap */}
      <KeyCap size="md">ESC</KeyCap>
    </div>
  )
}
